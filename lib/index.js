// ============================================================================
// Provider Switch — Host half (static Cordis plugin)  [v0.6.7]
//
// DSH 供应商启停管理插件。职责（Host 侧）：
//   1. 维护「被禁用供应商」集合，持久化在 DSH 的 settings 层：
//      · 0.1.7 起（dsh#677）命名空间由本插件 Config schema 的 volatile 字段
//        派生（profile 行 id = provider-switch），经 settings.update() 写入；
//        读则直接读该 volatile 字段在运行时的引用（loader 在 volatile-only 写入
//        后由 updateVolatile 就地更新它），因此无需缓存/订阅事件；
//      · 0.1.7 之前走 settings.register(NS, SCHEMA) 的旧命名空间。
//      插件本身不创建任何文件/文件夹；legacy 分支在 dispose 时尽力清空命名
//      空间，新分支写入的是插件自己的配置（不能清，也不该清）。
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

// 旧宿主（0.1.7 之前）的 settings 命名空间。0.1.7（dsh#677）删除了
// settings.register()：命名空间改由插件自己的 Config schema 派生，profile
// 行 id（本插件 patch 里是 provider-switch）即命名空间；此时这个字面量只用于
// legacy 分支，不再是新模型的命名空间来源。
const NS = 'provider-switch'
const SCHEMA = z.object({ disabled: z.array(z.string()) })

// 禁用集合的持久化载体（0.1.7+ 契约）：DSH 用 volatile 字段区分「可热写」
// 的用户配置与部署配置，settings.describe()/update() 只认 volatile 路径。
// 旧宿主不需要 volatile()（那是 0.1.7 起才有的元数据），故做存在性判断，
// 同一份 schema 在两条分支下都能用。
const disabledField = z.array(z.string()).default([])
export const Config = z.object({
  disabled: typeof disabledField.volatile === 'function' ? disabledField.volatile() : disabledField
})

export function apply(ctx, config) {
  const webServer = ctx.webServer

  // ---- 禁用集合的权威来源 ----
  // 0.1.7+（dsh#677）：本插件 Config 里的 disabled 声明为 volatile 字段，loader
  // 解析配置时把它包成 cosmokit 的 Volatile 引用；任何 volatile-only 的配置写入
  // （settings 服务的 write() 走 configEditor.edit() → reconcileProfilePatches，
  // 或手改 profile 文档后重载）都由 loader 就地更新这个引用（updateVolatile），
  // 所以它始终是最新值——不需要缓存，也不需要订阅事件。
  // 旧宿主（0.1.7 之前）没有这层包装，配置里就是普通数组，值由
  // settings.register() 返回的作用域承载。
  const isRef = (value) => value !== null && typeof value === 'object' && typeof value.get === 'function'
  const disabledRef = isRef(config && config.disabled) ? config.disabled : null
  const staticDisabled = Array.isArray(config && config.disabled) ? config.disabled : []
  let settingsService = null
  let scope = null // legacy：register() 返回的作用域
  let entryId = null // 0.1.7+：本插件在 loader 里的行 id，即 settings 命名空间

  // 本插件的 profile 行 id（同 dsh-better-sidebar 的 ownEntryId 思路：按包名
  // 找行，优先 fiber 相同的那一行；fiber 尚未挂上时退回唯一一个未禁用的同名行）。
  const ownEntryId = () => {
    let fallback = null
    try {
      for (const entry of ctx.loader.entries()) {
        const options = entry && entry.options
        if (!options || options.name !== name || typeof options.id !== 'string' || options.id === '') continue
        if (entry.fiber === ctx.fiber) return options.id
        if (entry.disabled !== true && fallback === null) fallback = options.id
      }
    } catch (e) {}
    return fallback
  }

  // 当前禁用集合：每次都现读（不缓存），优先级
  //   legacy 作用域 > volatile 引用 > settings.describe() 的本行 value > 静态配置。
  // 引用是主路径；describe() 只作为「引用不可用」时的兜底（注意它只收录 fiber
  // 已完全激活的行，插件激活期间拿不到本行，此时必须回落到静态配置，否则会
  // 在启动到客户端首次拉 state 之间出现一段禁用失效窗口）。
  const list = () => {
    if (scope) {
      try {
        const value = scope.get()
        if (Array.isArray(value && value.disabled)) return value.disabled
      } catch (e) {}
    }
    if (disabledRef) {
      try {
        const value = disabledRef.get()
        if (Array.isArray(value)) return value
      } catch (e) {}
    }
    if (entryId && settingsService) {
      try {
        const row = settingsService.describe().find((candidate) => candidate && candidate.ns === entryId)
        if (row && Array.isArray(row.value && row.value.disabled)) return row.value.disabled
      } catch (e) {}
    }
    return staticDisabled
  }

  ctx.inject(['settings'], (sctx) => {
    settingsService = sctx.settings
    // legacy 分支：0.1.7 之前 settings 服务带 register()
    if (typeof settingsService.register === 'function') {
      scope = settingsService.register(NS, SCHEMA, { base: { disabled: [] } })
      sctx.effect(() => () => {
        // 卸载/热重载时尽力清空命名空间：不留禁用状态残留。进程重启不经过
        // dispose（新进程直接读盘），不影响持久化。
        try { scope.replace({}).catch(() => {}) } catch (e) {}
      }, 'provider-switch: cleanup')
      console.log('[provider-switch] settings namespace ready (legacy register), disabled=' + JSON.stringify(list()))
      return
    }
    // 0.1.7+ 分支：命名空间由 Config schema 派生。此前这里调用已被删除的
    // register()，其 TypeError 被 cordis 吞进 fiber 状态 → 开关能点但写不进去
    // （HTTP 返回 unavailable，客户端静默还原）。
    if (typeof settingsService.update === 'function' && typeof settingsService.describe === 'function') {
      entryId = ownEntryId()
      if (!entryId) {
        console.log('[provider-switch] profile entry id not found; disabled set stays in memory only')
        return
      }
      try { settingsService.configure?.({ auto: false }, ctx.fiber) } catch (e) {}
      console.log('[provider-switch] settings namespace "' + entryId + '" ready, disabled=' + JSON.stringify(list()))
      return
    }
    console.log('[provider-switch] settings service has neither register() nor update(); disabled set stays in memory only')
  })

  // ---- llm/stream waterfall：禁止被禁用供应商的任何模型调用 ----
  // dsh-llm 的 stream() 最终走 ctx.waterfall(this, "llm/stream", ...)；
  // 监听器不调用 next() 即否决整条链（含 adapter 请求）。抛 LlmError 会由
  // agent-loop 的 turn 错误路径原样呈现（error.failure），不触发重试。
  ctx.on('llm/stream', (options, next) => {
    const provider = options && typeof options.provider === 'string' ? options.provider : ''
    if (provider && list().indexOf(provider) >= 0) {
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
  // 不依赖本插件自己的命名空间，所以 needOwn 可省略。
  const ready = (needOwn) => (!settingsService || (needOwn && !scope && !entryId))
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
      return { ok: true, disabled: [...list()].sort(), providers: listProviders() }
    }),

    // ---- 切换某个供应商的启用/禁用 ----
    set: wrap(serial(async (args) => {
      const provider = String((args && args.provider) || '')
      const want = !!(args && args.disabled)
      if (!provider) return { ok: false, code: 'invalid', message: 'provider is required' }
      const fail = ready(true)
      if (fail) return fail
      // 写入前重新读权威值：避免覆盖别处（官方设置页 / 手改 profile 文档）刚
      // 做的改动。
      const next = new Set(list())
      want ? next.add(provider) : next.delete(provider)
      const merged = [...next].sort()
      if (scope) await scope.replace({ disabled: merged })
      else await settingsService.update(entryId, { disabled: merged })
      return { ok: true, disabled: merged }
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