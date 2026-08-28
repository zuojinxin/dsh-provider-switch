# 开发指南

## 本地安装（改代码即热生效）

在仓库目录里执行：

```bash
dsh plugin --profile web add .
```

`.` 会被 DSH CLI 改写成当前目录的绝对路径，等价于 `link:<绝对路径>`。DSH 会在 profile 的 `node_modules` 下建 junction 指回本仓库，因此**改 `lib/` 下的文件就是直接改运行中的安装副本**，重启 `dsh web` 后生效。

卸载：

```bash
dsh plugin --profile web remove dsh-provider-switch
```

## 依赖解析（Windows 上必读）

本插件 host 半部分 `import @deepseek-ai/schemastery` 和 `@deepseek-ai/dsh-llm`。Node 的 ESM 解析以入口文件的**真实路径**（junction 解开后）为准，而 `link:` 方式安装时真实路径在仓库目录里，不在任何 `node_modules` 树下，裸导入会直接 `ERR_MODULE_NOT_FOUND`（host 半部分零导入、全部走 `ctx` 注入的插件不会踩这个坑）。

解法：在仓库内建一个到 dsh 安装目录的 junction：

```cmd
mklink /J "node_modules\@deepseek-ai" "%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai"
```

这同时保证两件事：

1. 裸导入可解析；
2. 解析到与运行中 harness **同一个模块实例**——agent-loop 对 `LlmError` 是严格 `instanceof`，拿到不同实例会退化成 UNKNOWN 错误。

`node_modules/` 已被 `.gitignore` 忽略，不会入库。重装 dsh（npm 全局重装）后 junction 目标会失效，重跑一次上面的命令即可。

## 版本与快照规范

1. 动手改代码前先 `git status` 确认工作区干净，不干净先把遗留改动提交掉。
2. 行为有实质变化时（不只是注释）：
   - 提升 `package.json` 的 `version`——小版本 `0.x.0` 表示功能/交互变化，`0.x.y` 表示修复与文档；
   - 更新 `README.md` 的「行为说明」章节；
   - 把改动后的 `lib/index.js`、`lib/client.js`、`README.md`、`package.json` 快照到 `.versions/<新版本号>/`（该目录已被 git 忽略，只作本地回滚用）。
3. 提交信息用中文，格式如 `dsh-provider-switch v0.4：<一句话变更>`。
4. 回滚：`git checkout <commit> -- <path>`，或从 `.versions/<版本>/` 拷回 `lib/`。

## 验证

改完 `lib/*.js` 必须跑：

```bash
node --check lib/index.js && node --check lib/client.js
node test/psw-test.mjs "<绝对路径>/lib/index.js"
```

`test/psw-test.mjs` 是伪造 cordis 环境的沙箱测试，不联网。它覆盖：`llm/stream` 拦截的 fail-closed 语义、按供应商粒度放行、持久化写入、重命名/重置/参数校验，以及「插件只监听 `llm/stream` 一个面」的覆盖边界。全部 PASS 才算完成。

注意：测试顶层 `import { LlmError } from '@deepseek-ai/dsh-llm'`，依赖上一节的 junction，需要在已安装 dsh 的机器上执行。

## 发布

```bash
npm version 0.4.0          # 与 package.json 保持一致并打 tag
git push --follow-tags
npm pack --dry-run          # 核对发布文件清单
npm publish                 # 首次需 npm adduser，建议开启 2FA
```

`npm pack --dry-run` 的文件列表应恰好是 `lib/`、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json`。
