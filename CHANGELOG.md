# Changelog

本项目遵循语义化版本号；「适配 DSH」列见 README 的兼容性表格。

## v0.6.11 — 2026-10-19

### 新增

- **官方「DeepSeek 账号」行可以启用/禁用了**（provider id `deepseek-account`）。设置 → 模型页该行右侧出现与其他供应商一致的开关；禁用后该渠道的模型从输入框选择器和 `/model` 弹层消失，调用被 Host 守卫拦成 `PROVIDER_DISABLED (403)`。

### 修复

- 账号行开关注入不到。设置页行匹配有两条路径：显示名/id 精确匹配，以及从 `rowActions` 内按钮 `aria-label` 反推 provider id。账号行两条都失效：
  - 官方客户端把该行显示名本地化为「DeepSeek 账号」，而 provider 真实注册名是 `DeepSeek Account`、id 是 `deepseek-account`；
  - 该行的编辑/删除按钮被官方代码显式跳过（`row.entry.provider === "deepseek-account" ? null : …`），`rowActions` 里一个按钮都没有。

### 实现

- `matchProviderInRow` 增加前置判断：行内出现 `span[class*=accountStatus]` 即映射到 `deepseek-account`；`state.providers` 里没有该 id 时合成一个条目（Host 守卫只认 `options.provider` 字符串，不依赖 UI）。
- 拦截与选择器过滤逻辑无需改动——`deepseek-account` 是 `llm` 正常注册的 provider，`disabled` 集合本就是任意 id 数组。

### 注意

- 账号行仍显示「● 已登录」：那是账号状态，与启停状态无关。要彻底移除该渠道请到「账号与余额」登出。
- 不要在当前会话正用着 `deepseek-account` 时禁用它：该会话会直接 403，不会自动回退到其他 provider。

## v0.6.10 — 2026-10-17

- 市场「重新启用」热挂载出来的行能自认领（修 DSH 升级后开关报 unavailable）。
- settings 不可写时降级为内存态，接口返回 `persisted: false`。

## v0.6.9

- 修复流式输出时模型选择弹窗自动消失。
- 弹窗关闭策略与选中判定加固。
- 代码清理与 peer 依赖范围修正。

## v0.6.8

- 弹窗关闭策略重做：不再把 `focusout` 当作「点到外面」，避免会话输出期间弹窗被宿主抢焦点误关。
- 选中判定重做：点分组标题、内边距、滚动条不再被误判为外部点击。

## v0.6.7

- 乐观更新：点击即时本地翻转开关，不等 Host 落盘往返。
- 连点去重：同一供应商同时只允许一个在途 `/set`，只累积最后意图。
- 适配 DSH 0.1.7 settings 新契约。

## v0.6.6

- 切换失败弹 toast 说明原因，并同步回权威值。

## v0.6.5

- 适配 DSH 0.1.7-rc.1，修复模型弹窗变灰 + 卡顿。

## v0.6.2

- 修复弹窗背景半透明。

## v0.5.5

- 代码精简重构。

## v0.4.0

- 初始稳定版：供应商启停开关、模型搜索、供应商重命名。
