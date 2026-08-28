// Sandbox test for dsh-provider-switch: prove the llm/stream guard is
// fail-closed for MODEL calls, per-provider granular (other providers keep
// working), and document its coverage boundary (native-fetch callers like
// dsh-web-search-deepseek never pass through llm/stream).
//
// Scenarios (fake cordis ctx, no network):
//   1. state endpoint exposes catalog + empty disabled set on boot
//   2. set deepseek-official=disabled persists {disabled:['deepseek-official']}
//   3. model call provider=deepseek-official -> LlmError PROVIDER_DISABLED
//      status 403, upstream next() NEVER called (no adapter dispatch)
//   4. while deepseek disabled: model call provider=or model=*flash* passes
//      through (per-provider granularity, other providers unaffected)
//   5. re-enable -> same call passes again
//   6. structural boundary: plugin listens ONLY on llm/stream -> any caller
//      bypassing ctx.waterfall('llm/stream') (e.g. web search native fetch)
//      is invisible to this guard by design
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { LlmError } from '@deepseek-ai/dsh-llm'

const PLUGIN = process.argv[2]
if (!PLUGIN) { console.error('usage: node psw-test.mjs <path-to-lib\\index.js>'); process.exit(2) }

const mod = await import(pathToFileURL(PLUGIN).href)

// ---- fake settings service ----
const scopes = {}
const persistedWrites = []
const llmPiAiSection = { providers: { 'or': { displayName: 'openrouter' } } }
const settingsService = {
  register(ns, _schema, opts) {
    let value = JSON.parse(JSON.stringify(opts.base))
    const watchers = []
    const scope = {
      get: () => value,
      watch: (fn) => { watchers.push(fn); return () => watchers.splice(watchers.indexOf(fn), 1) },
      replace: async (v) => {
        value = v
        persistedWrites.push(JSON.parse(JSON.stringify(v)))
        for (const w of [...watchers]) w()
      }
    }
    scopes[ns] = scope
    return scope
  },
  // minimal mutate for llm-pi-ai namespace (rename endpoint)
  async mutate(ns, ops) {
    if (ns !== 'llm-pi-ai') throw new Error(`settings namespace "${ns}" is not registered`)
    let section = JSON.parse(JSON.stringify(llmPiAiSection))
    for (const op of ops) {
      if (op.op === 'set') {
        let node = section
        for (let i = 0; i < op.path.length - 1; i++) {
          const k = op.path[i]
          if (typeof node[k] !== 'object' || node[k] === null) node[k] = {}
          node = node[k]
        }
        node[op.path[op.path.length - 1]] = op.value
      } else if (op.op === 'unset') {
        let node = section
        for (let i = 0; i < op.path.length - 1; i++) {
          if (typeof node[op.path[i]] !== 'object') { node = null; break }
          node = node[op.path[i]]
        }
        if (node) delete node[op.path[op.path.length - 1]]
      }
    }
    Object.assign(llmPiAiSection, section)
  }
}

// ---- fake cordis ctx ----
const eventHandlers = {}
const routes = {}
const ctx = {
  webServer: { register: (r) => { if (r.kind === 'prefix') routes[r.path] = r.handler } },
  inject(deps, cb) { if (deps.includes('settings')) cb({ settings: settingsService, effect(fn) { fn() } }) },
  on(event, handler) { (eventHandlers[event] ||= []).push(handler) },
  effect(fn) { fn() },
  get(name) {
    if (name === 'llm') return {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek 官方' }, { id: 'or', name: 'openrouter' }],
      listConfigurableProviders: () => []
    }
    return null
  }
}

mod.apply(ctx)

async function call(route, args) {
  const req = Readable.from([Buffer.from(JSON.stringify(args || {}))])
  req.url = '/api/provider-switch/' + route
  const res = { statusCode: null, body: null, writeHead(s) { this.statusCode = s }, end(b) { this.body = b } }
  await routes['/api/provider-switch'](req, res)
  try { return JSON.parse(res.body) } catch (e) { return { parseError: String(e), raw: res.body } }
}

// simulate one dsh-llm waterfall dispatch: options + upstream generator
async function simulateModelCall(options) {
  let upstreamCalled = false
  const next = async function* () {
    upstreamCalled = true
    yield 'chunk-from-upstream'
  }
  const [handler] = eventHandlers['llm/stream']
  const result = handler(options, next)
  const chunks = []
  try {
    for await (const c of result) chunks.push(c)
    return { ok: true, upstreamCalled, chunks }
  } catch (e) {
    return { ok: false, upstreamCalled, error: e }
  }
}

const results = []
const check = (name, cond) => results.push((cond ? 'PASS ' : 'FAIL ') + name)

// --- 1: boot state ---
const r1 = await call('state')
check('1 ok:' + JSON.stringify(r1).slice(0, 80), r1.ok === true)
check('1 catalog has deepseek-official + or',
  Array.isArray(r1.providers) && r1.providers.some(p => p.id === 'deepseek-official') && r1.providers.some(p => p.id === 'or'))
check('1 disabled empty on boot', Array.isArray(r1.disabled) && r1.disabled.length === 0)
check('1 settings namespace registered', !!scopes['provider-switch'])

// --- 2: disable deepseek-official ---
const r2 = await call('set', { provider: 'deepseek-official', disabled: true })
check('2 ok:' + JSON.stringify(r2), r2.ok === true && Array.isArray(r2.disabled) && r2.disabled.includes('deepseek-official'))
check('2 persisted to settings ns',
  JSON.stringify(persistedWrites.at(-1)) === JSON.stringify({ disabled: ['deepseek-official'] }))

// --- 3: blocked model call, upstream untouched ---
const r3 = await simulateModelCall({ provider: 'deepseek-official', model: 'deepseek-chat', messages: [] })
check('3 upstream next() never called', r3.ok === false && r3.upstreamCalled === false)
check('3 LlmError instance', r3.error instanceof LlmError)
check('3 code=PROVIDER_DISABLED', r3.error?.code === 'PROVIDER_DISABLED')
check('3 failure.status=403', r3.error?.failure?.status === 403)
check('3 message names provider+plugin', String(r3.error?.message || '').includes('deepseek-official'))

// --- 4: flash on ANOTHER provider still callable while deepseek disabled ---
const r4 = await simulateModelCall({ provider: 'or', model: 'google-deepseek-v4-flash-lookalike', messages: [] })
check('4 flash-model call passed through', r4.ok === true && r4.upstreamCalled === true && r4.chunks.includes('chunk-from-upstream'))

// --- 5: re-enable -> passes again ---
const r5a = await call('set', { provider: 'deepseek-official', disabled: false })
check('5 re-enable ok:' + JSON.stringify(r5a), r5a.ok === true && !r5a.disabled.includes('deepseek-official'))
const r5b = await simulateModelCall({ provider: 'deepseek-official', model: 'deepseek-chat', messages: [] })
check('5 deepseek callable again', r5b.ok === true && r5b.upstreamCalled === true)

// --- 6: coverage boundary -- guard is wired ONLY into llm/stream ---
check('6 single llm/stream listener, no other interception surface',
  Object.keys(eventHandlers).length === 1 && eventHandlers['llm/stream'].length === 1)

// --- 7: rename provider -> writes displayName into llm-pi-ai namespace ---
const r7 = await call('rename', { provider: 'or', displayName: '  My Router  ' })
check('7 rename ok:' + JSON.stringify(r7), r7.ok === true && r7.provider === 'or' && r7.displayName === 'My Router')
check('7 displayName persisted to llm-pi-ai section',
  llmPiAiSection.providers['or'].displayName === 'My Router')

// --- 8: rename to empty string -> unsets displayName (reset to provider id) ---
const r8 = await call('rename', { provider: 'or', displayName: '' })
check('8 rename empty (unset) ok:' + JSON.stringify(r8), r8.ok === true && r8.displayName === null)
check('8 displayName unset', !('displayName' in llmPiAiSection.providers['or']))

// --- 9: rename validation ---
const r9a = await call('rename', { provider: '', displayName: 'x' })
check('9 missing provider rejected', r9a.ok === false && r9a.code === 'invalid')
const r9b = await call('rename', { provider: 'or', displayName: '   ' })
check('9 whitespace-only name treated as unset (reset to default)',
  r9b.ok === true && r9b.displayName === null)

// --- 10: rename to unknown namespace returns unavailable, not crash ---
// (fake mutate throws for non-llm-pi-ai; simulate by calling with a provider
//  that triggers the registered-namespace path — already covered by 7-9.
//  Here we verify the endpoint exists and returns JSON for unknown provider.)
const r10 = await call('rename', { provider: 'nonexistent', displayName: 'Foo' })
check('10 rename nonexistent provider still ok (settings accepts arbitrary key)',
  r10.ok === true && r10.displayName === 'Foo')

console.log(results.join('\n'))
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1
process.exit(process.exitCode || 0)
