// ============================================================================
// Provider Switch — Host half (static Cordis plugin)  [v0.3.0]
//
// DSH 供应商启停管理插件。职责（Host 侧）：
//   1. 维护「被禁用供应商」集合，持久化在 DSH 自己的 settings 文档里
//      （命名空间 provider-switch，跟随 settings.yaml 落盘——插件本身不创建
//      任何文件/文件夹；dispose 时尽力清空该命名空间，卸载不留残留状态）。
//   2. 通过 llm/stream waterfall 拦截所有模型调用（主循环 / 标题生成 / 压缩
//      摘要均必经 dsh-llm 的 ctx.waterfall("llm/stream", ...)），对禁用
//      供应商不调用 next() 并抛 LlmError(status 403)——fail-closed，会话
//      无法再调用被禁用供应商的任何模型。
//   3. 通过 webServer 提供 HTTP 端点供浏览器半部分使用：
//        POST /api/provider-switch/state  -> { ok, disabled[], providers[] }
//        POST /api/provider-switch/set    -> { provider, disabled } 切换
//        POST /api/provider-switch/rename -> { provider, displayName } 重命名
//
// 客户端半部分（lib/client.js）负责：输入框模型选择器的搜索 + 过滤（shadow
// conversation.input.model 槽），设置 → 模型页每行的启用/禁用开关（DOM 注入），
// 以及供应商编辑卡片标题的内联重命名（DOM 注入，写入 llm-pi-ai 命名空间的
// providers.<id>.displayName 字段）。
//
// 状态模型：「禁用集合」只存被禁用的供应商 id，因此任何新添加/未知的供应商
// 天然处于启用状态（满足「添加模型后默认启用」）。
// ============================================================================

import z from '@deepseek-ai/schemastery'
import { LlmError } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-provider-switch'

export const inject = ['webServer', 'llm']

// settings 命名空间：唯一数据源，落到 DSH 自己的 settings.yaml
const NS = 'provider-switch'
const SCHEMA = z.object({ disabled: z.array(z.string()) })

export function apply(ctx) {
  const webServer = ctx.webServer

  // ---- authoritative in-memory disabled set ----
  // 由 settings 命名空间的 resolved 值驱动（scope.watch），llm/stream 拦截
  // 与 HTTP 端点都只读这个变量，保证单一事实来源。
  let disabled = new Set()
  let settingsService = null
  let scope = null

  ctx.inject(['settings'], (sctx) => {
    settingsService = sctx.settings
    scope = sctx.settings.register(NS, SCHEMA, { base: { disabled: [] } })
    const read = () => {
      try {
        const value = scope.get()
        return new Set(Array.isArray(value && value.disabled) ? value.disabled : [])
      } catch (e) { return new Set() }
    }
    disabled = read()
    const stop = scope.watch(() => { disabled = read() })
    sctx.effect(() => () => {
      stop()
      // 卸载/热重载时尽力清空命名空间：不留禁用状态残留。进程重启不经过
      // dispose（新进程直接读盘），不影响持久化。
      try { scope.replace({}).catch(() => {}) } catch (e) {}
    }, 'provider-switch: cleanup');
    console.log('[provider-switch] settings namespace ready, disabled=' + JSON.stringify([...disabled]))
  })

  // ---- llm/stream waterfall：禁止被禁用供应商的任何模型调用 ----
  // dsh-llm 的 stream() 最终走 ctx.waterfall(this, "llm/stream", ...)；
  // 监听器不调用 next() 即否决整条链（含 adapter 请求）。抛 LlmError 会由
  // agent-loop 的 turn 错误路径原样呈现（error.failure），不触发重试。
  ctx.on('llm/stream', (options, next) => {
    const provider = options && typeof options.provider === 'string' ? options.provider : ''
    if (provider && disabled.has(provider)) {
      return (async function* () {
        throw new LlmError(
          `provider "${provider}" is disabled (dsh-provider-switch)`,
          'PROVIDER_DISABLED',
          { status: 403 }
        )
      })()
    }
    return next()
  }, 'provider-switch: llm guard')

  // ---- provider catalog（llm 服务就绪后才有内容；客户端会在
  // llm/adapters-updated 时重新拉取）----
  // 设置 → 模型页同时渲染「已注册适配器的供应商」(listProviders) 和
  // 「可配置供应商目录」(listConfigurableProviders，如 dsh-vision-router
  // 的「视觉路由（自动识图）」)，两个来源都要进目录才能逐行配开关。
  const listProviders = () => {
    try {
      const llm = ctx.get('llm')
      if (!llm) return []
      const out = []
      const seen = new Set()
      if (typeof llm.listProviders === 'function') {
        for (const p of llm.listProviders()) {
          if (!p || typeof p.id !== 'string' || seen.has(p.id)) continue
          seen.add(p.id)
          out.push({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id })
        }
      }
      if (typeof llm.listConfigurableProviders === 'function') {
        for (const p of llm.listConfigurableProviders()) {
          if (!p || typeof p.provider !== 'string' || seen.has(p.provider)) continue
          seen.add(p.provider)
          out.push({ id: p.provider, name: typeof p.displayName === 'string' ? p.displayName : p.provider })
        }
      }
      return out
    } catch (e) {}
    return []
  }

  const wrap = (fn) => async (args) => {
    try { return await fn(args) }
    catch (e) { return { ok: false, code: 'internal', message: String((e && e.message) || e) } }
  }

  // settings 服务未就绪的统一失败响应；rename 只写 llm-pi-ai 命名空间，
  // 不依赖本插件自己的命名空间 scope，所以 needScope 可省略。
  const ready = (needScope) => (!settingsService || (needScope && !scope))
    ? { ok: false, code: 'unavailable', message: 'settings service not ready yet, please retry' }
    : null

  // 串行化写操作，避免并发切换互相覆盖
  let opTail = Promise.resolve()
  const serial = (fn) => (args) => {
    const run = opTail.then(() => fn(args), () => fn(args))
    opTail = run.then(() => {}, () => {})
    return run
  }

  const handlers = {
    // ---- 当前状态：禁用集合 + 供应商目录 ----
    state: wrap(async () => {
      return { ok: true, disabled: [...disabled].sort(), providers: listProviders() }
    }),

    // ---- 切换某个供应商的启用/禁用 ----
    set: wrap(serial(async (args) => {
      const provider = String((args && args.provider) || '')
      const want = !!(args && args.disabled)
      if (!provider) return { ok: false, code: 'invalid', message: 'provider is required' }
      const fail = ready(true)
      if (fail) return fail
      const next = new Set(disabled)
      want ? next.add(provider) : next.delete(provider)
      const list = [...next].sort()
      await scope.replace({ disabled: list })
      disabled = new Set(list) // watch 回调异步，先同步更新保证即时生效
      return { ok: true, disabled: list }
    })),

    // ---- 重命名供应商（写入 llm-pi-ai 命名空间的 displayName 字段）----
    // displayName 是 pi-ai profile 的可选字段；未设置时 UI 显示 provider id。
    // 空字符串视为「重置为默认」（unset），非空则 set。settings 服务的
    // assertServiceable 校验器会拒绝空 displayName，所以空值必须走 unset。
    rename: wrap(async (args) => {
      const provider = String((args && args.provider) || '')
      const rawName = args && args.displayName
      const displayName = typeof rawName === 'string' ? rawName.trim() : ''
      if (!provider) return { ok: false, code: 'invalid', message: 'provider is required' }
      const fail = ready(false)
      if (fail) return fail
      // llm-pi-ai 命名空间由 dsh-llm-pi-ai 插件注册；未就绪时给出明确错误
      const LLM_NS = 'llm-pi-ai'
      if (typeof settingsService.mutate !== 'function') {
        return { ok: false, code: 'unavailable', message: 'settings service does not support mutate' }
      }
      const ops = displayName
        ? [{ op: 'set', path: ['providers', provider, 'displayName'], value: displayName }]
        : [{ op: 'unset', path: ['providers', provider, 'displayName'] }]
      try {
        await settingsService.mutate(LLM_NS, ops)
      } catch (e) {
        const msg = String((e && e.message) || e)
        // 命名空间未注册（llm-pi-ai 插件未加载）
        if (msg.indexOf('is not registered') >= 0) {
          return { ok: false, code: 'unavailable', message: 'llm-pi-ai namespace not registered' }
        }
        return { ok: false, code: 'rejected', message: msg }
      }
      return { ok: true, provider, displayName: displayName || null }
    })
  }

  async function readJsonBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    if (!text.trim()) return {}
    return JSON.parse(text)
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/api/provider-switch',
    handler: async (req, res) => {
      const path = (req.url || '').split('?')[0]
      const route = path.replace(/^\/api\/provider-switch\/?/, '').split('/')[0]
      try {
        const fn = handlers[route]
        if (!fn) { sendJson(res, 404, { ok: false, error: 'unknown endpoint: ' + route }); return }
        const args = await readJsonBody(req)
        const result = await fn(args || {})
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'internal', message: String((error && error.message) || error) })
      }
    }
  }))
}