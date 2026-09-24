# DSH Provider Switch（供应商启停 + 模型搜索 + 重命名）

DSH 静态插件（web profile）。三个功能：

1. **供应商启用/禁用**：在「设置 → 模型」页，每个供应商行的「编辑」按钮前有一个「已启用/已禁用」开关。
   - 禁用后：该供应商的**模型从输入框模型选择器中隐藏**（整组过滤）；**会话不会再调用**该供应商的任何模型（`llm/stream` waterfall fail-closed 拦截，调用直接报 `PROVIDER_DISABLED` 错误，不重试）。
   - 新添加的供应商/模型**默认启用**（状态只记录「禁用集合」）。
2. **模型搜索**：输入框模型选择器的模型面板顶部有搜索框，可关键字过滤（匹配模型名、描述、供应商名，不区分大小写）。
3. **供应商重命名**：在「设置 → 模型」页展开供应商编辑卡片后，点击卡片标题（供应商名称）即可内联编辑显示名；Enter 或点击「应用」按钮提交，Esc 或「取消」放弃。重命名写入 `llm-pi-ai` 命名空间的 `providers.<id>.displayName` 字段，settings 事件驱动即时同步。清空名称可重置为默认（显示 provider id）。

## 前置条件

- **dsh web ≥ 0.1.2-alpha.3**（`dsh --version` 查看；0.1.2-alpha.3 重写了客户端 slots 系统，本版基于该新契约适配，旧版本不兼容）
- Node.js ≥ 20
- [pnpm](https://pnpm.io/)（`dsh plugin` 命令通过它管理 profile 依赖，缺了会报 `pnpm not found on PATH`）

## 安装

```bash
dsh plugin --profile web add github:zuojinxin/dsh-provider-switch
```

这种方式**不需要手动编辑任何 profile 文件**——`cordis.patch.yml` 会在安装时由 DSH CLI 自动把 bundle 加进 profile 的 `dsh.profile.bundles`。

安装后重启 `dsh web` 即可生效。

## 验证是否生效

启动日志里出现这一行，说明 Host 半部分已加载（引号里是本插件在 profile 里的行 id，也就是 settings 命名空间）：

```
[provider-switch] settings namespace "provider-switch" ready, disabled=[]
```

然后在「设置 → 模型」页确认每行供应商都出现了「已启用/已禁用」开关。

## 卸载

```bash
dsh plugin --profile web remove dsh-provider-switch
```

插件 dispose 时会尽力把 settings 命名空间重置为空（`replace({})`）；最坏情况 `~/.dsh/settings.yaml` 里残留一个空键（DSH 自家配置文件的几字节，不是插件创建的文件）：

```yaml
provider-switch: {}
```

手动删掉这两行即可彻底清除。**0.1.7 起**（dsh#677）settings 改为「命名空间由插件自己的 Config schema 派生」，禁用集合写在本插件自己那行配置里（profile 的 patch 文档，`~/.dsh/profiles/web/cordis.patch.yml`），卸载时该行一并消失，无需手动清理。

## 行为说明

- **开关点击即时响应（v0.6.7，修复「点了要卡约 1 秒才动」）**：Host 的 `/set` 要经 `settings.update()` 落盘 profile 文档（`configEditor.edit` → `reconcileProfilePatches`），往返约 1 秒；旧版客户端要等这个往返结束、再等一次 `settings/document-updated` 触发的 `state` 拉取才刷新开关，观感就是「点了卡一下」。现在改为**乐观更新**：点击立即本地翻转开关（用一个 `pending` 覆盖表记录进行中的目标值，使等待期间其他事件触发的 `refreshState` 不会把乐观值冲掉），`/set` 返回后对齐权威值；失败则回滚 + toast + 再拉一次权威值兜底。同时**等待期间不再把按钮置为 `disabled`**——旧版那样做会让开关在 1 秒内变成灰色不可选（`.psw-switch:disabled{opacity:.5}`），等于把「卡顿」换成另一种可见症状；现在开关任何时刻都可点。
- **连点不再产生「回声队列」（v0.6.7）**：每个供应商同时只允许**一个在途 `/set`**（`inflight` 表）。连点期间后续点击只更新 `pending` 里的「最后意图」并立即翻转本地开关，**不再各发一个请求**；在途请求返回后，如果最后意图与权威值不一致，才补发**一次**收敛请求。修复前每次点击都发一个请求，Host 侧 `serial` 串行落盘（各约 1s），快速点 10 次就排 10 个——停手后这些请求仍按序执行，开关会自己继续启用/禁用好几秒。现在无论点多快，停止点击后最多只剩一个补发请求，最终状态恒等于最后一次点击的意图。
- **适配 DSH 0.1.7 的 settings 新契约（v0.6.6，修复「开关点击无效」）**：0.1.7（dsh#677）删除了 `settings.register()`——命名空间不再由插件注册，而是**由插件导出的 `Config` schema 派生**，且 profile 里的行 id 就是命名空间；只有被标记 `.volatile()` 的字段才允许热写（`isVolatilePath` 校验）。旧版代码仍调用 `register()`，其 `TypeError` 被 cordis 吞进 fiber 状态（boot 只显示插件 failed、日志里几乎没有线索），导致 `/api/provider-switch/set` 一律返回 `unavailable`，客户端静默还原——表现就是「开关点不动」。修复：
  - Host 导出 `Config = z.object({ disabled: z.array(z.string()).default([]).volatile() })`，禁用集合改由 `settings.update(<本行 id>, { disabled })` 写入；本行 id 按「包名 + fiber 相同」从 loader 里定位（同官方 dsh-better-sidebar 的 `ownEntryId` 思路，fiber 未挂上时退回唯一的未禁用同名行），并 `configure({ auto: false })` 抑制为本插件自动生成设置页。
  - 用 `typeof settings.register === 'function'` 做特性探测，**旧宿主（≤0.1.6）继续走原来的 `register()` 分支**，一份代码两代通用；两者都不可用时降级为「仅内存生效」并在启动日志里说明。
  - 状态刷新新增 `settings/document-updated`（只认自己那行 id 的事件）与 `app-boot/config-reload` 两个订阅，官方设置页改动/手改 profile 文档后即时同步；每次写前重读权威值，避免用陈旧缓存覆盖外部改动。
  - 客户端在切换失败时显示 toast（含服务端原因），不再静默还原——此前失败与「没点到」在界面上完全一样。
- **弹窗背景不透明修复（v0.6.2）**：DSH 0.1.7-rc.1 起 CSS 变量 --dsw-specific-menu 改为半透明（#f8f9fa94，约 58% 不透明度），导致输入框模型选择弹窗背景透出下方文字。将 .psw-menu 与 .psw-groupTitle（sticky 分组标题）的背景从 --dsw-specific-menu 改为不透明的 --dsw-alias-bg-layer-1（亮色 #fff，暗色对应深色），与原生弹窗观感一致。
- **输入框模型选择器数据面复用官方槽位注入链（v0.6.0）**：不再自行另读一份
  `modelDirectories` 目录，而是复用官方 `conversation.input.model` 槽位注册项自己的
  `inject(sessionId)` 结果作为本插件 fork 选择器的数据面。这样输入框选择器与官方
  输入框选择器看到**同一份数据**：任何第三方插件（如 vision-router）在官方数据面
  上做的隐藏/投影设置都被原样保留（/model 弹层与输入框选择器各自独立跟随第三方
  设置——第三方只隐藏某一处的，只影响那一处；两处都隐藏的就都隐藏）。本插件只
  在此基础上叠加自己的启用/禁用过滤，永不覆盖第三方插件的可见性决定。找不到官方
  槽位项或 `inject` 不可用时回退到原始读取，行为与旧版完全一致。实现要点：通过
  `slots.entries()` 排除本插件自身（函数引用对比）后取 priority 最低的注册项——
  即本插件缺席时本会渲染的官方项；取不到则静默降级为不过滤（同旧版）。
- **代码精简重构（v0.5.5，行为不变）**：按 Fowler 坏味道基线清理堆砌——
  - Host：补 `inject` 声明 `llm`（此前靠 `ctx.get('llm')` 侥幸可用）；抽出 `ready()` 消除 `set`/`rename` 重复的「settings 服务未就绪」判断；`set` 的增删集合改三元一行。
  - Client：删除纯转调的 Middle Man `providerFromRow`（直接复用 `matchProviderInRow`）；把 model/effort 两个面板逐字重复的「目录加载失败重试横幅」抽为 `errorBanner` 常量；修正过时的 CSS 注释。
  - `PswModelSelect` 是官方 ModelSelect 的 fork，保持深模块形态（小接口 + 大实现），未改动。
- **移除「当前模型供应商被禁用」警示条（v0.5.4）**：禁用供应商后打开输入框模型菜单，不再显示「当前模型的供应商已被禁用，请选择其他模型」提示（连同 `WarningIcon` 一并移除）。保留的 `psw-warning` 仅用于目录加载失败的提示条。
- **输入框模型菜单禁用过滤生效（v0.5.3）**：alpha.3 客户端上下文按**模块级 `inject` 白名单**放行服务访问，未声明的服务（含 `remote.session` 命名空间）会被 cordis 上下文 `get` 拒绝并抛 `cannot get property "remote.session" without inject`——模型目录服务 `directoryFor()` 内部要访问 `ctx.remote.session`，导致我们的 shadow 菜单注册成功后一渲染就崩、被运行时回退到官方菜单（于是输入框菜单显示全部模型，但 `/model` 弹层走我们包装的 `ui.options` 却正常过滤）。修复：给 client 模块返回对象补上 `inject: ['commandUi','locale','sessions','slots','remote','remote.session']`（与官方 ui-model-selection 一致）。无头浏览器实测：打开输入框菜单，被禁供应商整组消失，全部禁用时显示「没有可用的模型。」。
- **启用/禁用过滤即时生效修复（v0.5.2）**：选择菜单的禁用过滤改为包装「不可变快照」——`applyState` 每次生成新对象引用。此前 `React.useSyncExternalStore` 用 `Object.is` 比较 `getSnapshot()` 返回值，原地改同一对象会被判定「未变」而拒绝重渲染，导致选择菜单一直读到初始空禁用集合，在「设置 → 模型」页启停供应商后模型仍全部显示（alpha.3 下目录 store 不再频繁发变更通知掩盖此问题）。
- **DSH 0.1.2-alpha.3 适配（v0.5.0）**：
  - 移除 `apply()` 里同步的 `ctx.get('slots')` 早期 return（alpha.3 下 slots 服务未就绪时它会让整个 client 模块静默失效，导致开关/搜索/弹层过滤全部失灵）。模型选择器 shadow 继续用 **`priority: -1`** 注册 `conversation.input.model` 席位——alpha.3 的 SlotCore 把 single 席位渲染赢家定义为**最低 priority 胜出**，官方以默认 0 注册，插件必须以**不同** priority 注册才合法（同为 0 会抛「single slot 已有注册」）；`order`/`id` 只对 list/keyed 席位有意义，single 席位传了也无用。
  - v0.5.0 曾误删 `priority` 改用 `order: -1`，导致与官方同 priority 冲突、`slots.register` 抛错使模型座请求按钮整体消失（v0.5.1 修复，恢复 `priority: -1`）。
  - alpha.3「设置 → 模型」页只渲染**已配置供应商**的行（其余走「添加供应商」下拉），行内 DOM 结构（`rowCard`/`rowActions`/`rowName`/`editor*`）保持不变；行匹配新增兜底：行名缺失/未设置 displayName 时，从行操作区按钮 aria-label 精确提取 provider id 匹配。
  - 状态刷新订阅集扩充对齐官方 `ui-settings-models`：除 `settings/document-updated`、`llm/adapters-updated` 外新增 `credentials/reference-updated`。
  - `/model` 弹层过滤在 `commandUi` 就绪后若发现 `model` 贡献尚未注册（贡献方可能更晚注册），改为事件驱动 + 一次性延迟重试，而非一次性放弃。
- **重命名失败提示（v0.4.0）**：重命名失败时错误提示会带上服务端返回的具体原因（如 `llm-pi-ai namespace not registered`），而不是笼统的「重命名失败」。
- **供应商重命名（v0.3.0）**：展开供应商编辑卡片后，卡片标题（`[class*=editorTitle]`）可点击变为内联输入框。Enter 或「应用」按钮提交到 Host 的 `/api/provider-switch/rename` 端点，Host 通过 `settings.mutate('llm-pi-ai', [{op:'set', path:['providers',<id>,'displayName'], value:<新名>}])` 写入官方 settings 命名空间；空名称走 `unset` 重置为 provider id。提交后 settings/document-updated 事件驱动官方模型页重载，新名称即时同步显示。「应用」按钮通过 capture-phase click 拦截：先完成重命名写入，再二次点击放行官方 apply（保存其他字段/关闭卡片）。Esc 或「取消」放弃编辑。同样是 DOM 注入 hack，官方升级改类名时标题回退为不可点击（不影响其他功能）。
- **/model 命令弹层过滤（v0.2.0）**：输入框 `/model` 弹出的命令面板现在同样隐藏被禁用供应商的模型。实现方式：官方 contract 不允许重名 `commandUi.register`（抛错）、`decorate` 只对 host 命令生效，因此包装运行时已注册 `model` 贡献的 `ui.options` 函数（选项 id 形如 `<providerId>/<modelId>`，按前缀过滤；`failure/*` 行保留）。v0.5.0 起加入时序容错：若 `commandUi` 就绪时 `model` 贡献还没注册，改为在 `llm/adapters-updated`/`settings/document-updated` 事件及一次性延迟时重试包装。若 DSH 升级改动 CommandUiRuntime 内部结构，此处静默降级为不过滤，其他功能不受影响；插件卸载时恢复原函数。
- **开关位置**：官方「设置 → 模型」页供应商行（`li[class*=rowCard]`，v0.5.0 起仅已配置供应商渲染为行）的操作区。这是 DOM 注入（MutationObserver + `[class*=...]` 子串匹配），依赖官方页面的 CSS 类名；DSH 升级改动类名时开关会消失（优雅降级，不影响其他功能），届时更新本插件即可。
- **模型选择器**：shadow 官方 `conversation.input.model` 槽（`priority: -1`，alpha.3 SlotCore 规定 single 席位「lowest renders」，与官方默认 priority 0 不冲突且胜出；同时兼容旧版同语义），是官方 ModelSelect 的 fork，保留两级菜单/推理等级/键盘导航/错误重试等全部原功能，增量改动只有：顶部搜索框、禁用组过滤、当前模型供应商被禁用时的警示条。数据面完全复用官方 `modelDirectories` 服务（同一份目录、同一个 `selectModel` RPC）。
- **拦截调用**：`ctx.on("llm/stream", ...)` —— DSH 所有模型调用（会话主循环、会话标题生成、压缩摘要）都必经 `dsh-llm` 的 `llm/stream` waterfall。对禁用供应商不调用 `next()`，返回抛 `LlmError(PROVIDER_DISABLED, status 403)` 的合成流：会话立即收到明确错误，不会重试、不会打到供应商。
- **持久化**：禁用集合写入 DSH **自己的** settings 文档（命名空间 `provider-switch`，0.1.7 起即本插件在 profile 里的行 id；落在 profile 的 patch 文档里，旧宿主落在 `~/.dsh/settings.yaml`），与官方「添加模型」同一套机制。插件本身**不创建任何文件/文件夹**。
- 热重载（HMR）插件代码会触发 dispose 清理，禁用列表会被重置（进程重启不受影响）。

## 文件

- `lib/index.js` — Host 半部分：settings 命名空间注册、`llm/stream` 拦截、`/api/provider-switch/{state,set,rename}` 三个 HTTP 端点。
- `lib/client.js` — Client 半部分：模型选择器 fork（搜索+过滤）、设置页行内开关（DOM 注入）、供应商编辑卡片标题内联重命名（DOM 注入）、样式。
- `cordis.patch.yml` — 安装挂载层。

## 已知限制

- `/model` 弹层宽度随剩余行数自适应（官方 PopupSelectView 按内容收缩，下限 220px）：
  禁用供应商越多、剩余模型越少，弹窗越窄，这是禁用过滤生效的正常显示效果。
- 设置页开关和重命名都是 DOM 注入 hack，官方页面类名变化时开关/重命名不显示（其他功能不受影响）。
- `/model` 弹层过滤依赖 CommandUiRuntime 的内部存储结构（`live.contributions`），DSH 升级若改动该结构会静默降级为不过滤（输入框模型座不受影响）。
- 禁用供应商只拦模型调用，不隐藏「设置 → 模型」页里的供应商行（行仍在，可随时重新启用）。
- 重命名时若同时修改了官方字段（API Key、baseURL 等），重命名写入会使 settings revision 前进，官方 apply 可能收到 `settings-conflict` 错误（官方卡片会提示冲突，再次点击应用即可）。
- 插件只拦 `llm/stream` waterfall。任何绕过该 waterfall 直连供应商的调用方（例如走原生 fetch 的搜索类插件）不在拦截范围内。

## 开发

见 [CONTRIBUTING.md](CONTRIBUTING.md)（本地 junction 安装、版本快照规范、沙箱测试怎么跑）。

## 许可

MIT · 详见 [LICENSE](LICENSE)
