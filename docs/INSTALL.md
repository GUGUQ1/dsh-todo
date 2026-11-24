# 安装、升级、卸载

## 前提

- DeepSeek Harness **Desktop**（在 0.2.2-rc.5 上验证过）。插件用到右栏页签、宿主命令、模型工具与技能注册；这些在标准 profile 里都有。
- 不需要单独装 Node 或 npm：插件跑在 DSH 自带的运行时里。

## 方式一：插件管理页（推荐）

1. 拿到仓库：

   ```bash
   git clone https://github.com/GUGUQ1/dsh-todo.git
   ```

2. 在 DSH 左侧点 **插件** → **添加插件** → 选择上面这个目录。
3. 刷新页面（`Ctrl+R`）。

## 方式二：让助手装

对助手说「把 `<仓库绝对路径>` 这个目录装成插件」，它会执行 `plugin_manager install_bundle`。装完同样要刷新页面。

## 方式三：手动改 profile（开发期）

profile 在 `~/.dsh/profiles/<profile>/`。在 `package.json` 里加一条依赖并把它列进 bundle 列表：

```json
{
  "dependencies": { "dsh-todo": "link:C:/path/to/dsh-todo" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-todo"] } }
}
```

然后在 profile 目录跑 `pnpm install`，重启 DSH。适合改代码时用：`link:` 指到仓库，改 `client.js` 刷新页面就生效。

## 装完怎么确认

三处都出现才算装好：

| 位置 | 应该看到 |
|---|---|
| 右栏「开始」页 | 一张 **项目计划** 卡片（点它打开面板） |
| 输入框上方 | 一个「计划」胶囊（临时入口，同样打开面板） |
| 面板顶部 | 「工作区 / 本会话」两个页签（没有板的那一侧显示「新建」） |
| 模型侧 | 工具列表里有 `todolist`；技能列表里有 `dsh-todo-plan` |

模型侧的注册结果可以查 `%TEMP%\dsh-todo-tool-status.json`：

```json
{"tool":{"ok":true,"name":"todolist","parameters":18,"at":"…"},"prompt":{"ok":true,"name":"dsh-todo:session","at":"…"},"skill":{"ok":true,"name":"dsh-todo-plan","chars":…,"at":"…"}}
```

`ok: false` 或文件里没有对应键，就是这个能力没注册上（见 [FAQ](FAQ.md#助手看不见-todolist-工具)）。

## 升级

- 只改了 `client.js`（面板）：刷新页面即可。
- 改了 `index.js` / `host/`（宿主）：**必须重启 DSH**，宿主代码不会热替换。
- 用 `curl`/Release 包安装的话，重新安装一次再重启。

## 卸载与回滚

- **禁用**：插件页把 `dsh-todo` 关掉（面板与工具立刻消失，数据文件还在）。
- **卸载**：插件页移除 bundle；或手动从 profile 的 `dependencies` 与 `bundles` 里删掉，再 `pnpm install`。
- **回滚到某个版本**：`git checkout <tag> -- .`（例如 `v0.1.0`），需要的话重新安装并重启。

两块板都不会被卸载删掉：

- 公板 `todolist.json` 属于你的工作区；
- 私板在 `$DSH_HOME/dsh-todo/<会话id>/`（默认 `~/.dsh/…`），想清就自己删目录。

## 权限边界

- 插件**不联网**。
- 读：DSH 的只读文件接口（单个文件不限工作区）。
- 写：只有两处——会话工作区内的 `todolist.json`（basename + `realpath` 校验），和 `$DSH_HOME/dsh-todo/` 下由会话 id 推导出的那一个私板文件。
- 面板的每次改动会作为一条用户消息注入会话（三档通知可控，并带上改的是哪块板）。

更多见 [SECURITY.md](../SECURITY.md) 与 [PRIVACY](PRIVACY.md)。
