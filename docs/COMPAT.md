# 兼容性

## 已验证

| 项 | 版本 / 平台 | 怎么验证的 |
|---|---|---|
| DSH Desktop | **0.2.2-rc.5**，Windows 11 | 面板、命令、工具、技能、通知都在真实会话里跑过 |
| 模型工具 | `todolist`，12 个参数 | 真实子对话：8 步写入全成功；5 条非法调用全部被拦且文件零改动 |
| 运行时技能 | `dsh-todo-plan` | 注册成功（`%TEMP%\dsh-todo-tool-status.json`） |
| 计划格式 | `version: 1` | 文件模型测试 33 例 |
| 插件版本 | `0.1.0`（tag `v0.1.0`） | 三种外观、材质开关、勾选/折叠/拖拽/删除动效、按会话开关 |

## 未验证

- macOS / Linux 上的 DSH（代码只用 `node:` 内置模块，理论上没问题；CI 在这两个系统上跑的是四套无 DSH 测试）；
- DSH 0.2.2-rc.5 之外的版本；
- Web 版 DSH（右栏与文件 Remote 的行为可能不同）。

## 依赖的宿主能力

| 服务 | 必需 | 缺失时的表现 |
|---|---|---|
| `commands` | ✅ | 插件不激活（`inject` 里声明了） |
| `tools` | 否 | 面板与 `/todo` 命令照常；模型工具不注册（状态文件记 `deferred`） |
| `skills` | 否 | 面板与命令照常；技能不注册 |
| `workingDirectory` | 否 | 工具解析工作区失败会明确报错；面板不受影响 |

客户端只用公开的右栏接口：`sidebarRightTabs.register`、`sidebarRight.openTab`、`slots.register`、`locale`、`remote.workspaceFiles`、`remote.commands`。不 import 任何 Harness 客户端包。

## 升级 DSH 后怎么自查

1. `npm test` 四套是否仍全绿（它们不依赖 DSH）；
2. 刷新页面：右栏「开始」页仍有「项目计划」卡片，点开面板能显示数据；
3. 点一下圆点：面板底部 `rev` 是否 +1；
4. 对助手说「读一下计划」：`todolist` 是否可用（不可用查 `%TEMP%\dsh-todo-tool-status.json`）；
5. 助手改一条：面板是否自动刷新。

任何一步失败，看 [FAQ](FAQ.md) 对应条目；接口变动通常表现为第 2 或第 4 步失败。
