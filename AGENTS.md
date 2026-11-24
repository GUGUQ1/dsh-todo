# 协作约定（给任何接手这个仓库的助手）

这份文件是硬约束，改代码前先读。

## 1. 先方案，后实施

- 每一轮开始，先给出**这一轮要做什么、改哪些文件、怎么验收**的方案。
- 用户明确说「确认」「按这个来」「可以开始」之后才动代码。
- 方案里出现新的产品决定（字段、交互、默认值）时，标出来让用户拍板，不自己替他决定。
- 用户没要求的功能不顺手加；发现的顺手改进记进 `DEVLOG.md` 的「候选」，等下一轮方案里提。

## 2. 里程碑节奏

每个里程碑一轮或几轮，顺序：方案 → 实施 → 自检 → 用户验收 → 提交 + tag + 日志。

自检至少包含：

- `node --check` 通过所有 JS 文件（语法）；
- 宿主逻辑有单测（M1 起），`npm test` 通过；
- 真的装进 profile，打开面板截一张图或描述看到的画面；
- 明确写出「没验证到什么」。

## 3. 提交与回滚

- 一个里程碑一个 tag：`v0.0.1-m0`、`v0.0.1-m1`……
- 提交信息：`M<n>: <做了什么>`；正文写验证方式。
- 回滚代码：`git revert <sha>` 或 `git checkout <tag> -- .`。
- 回滚部署：Plugins 页禁用/卸载，或用旧 tag 的目录重新 `install_bundle`。
- 不 force push 已推送的 tag；修正用新 tag。

## 4. 文档纪律

- 每一轮结束更新 `DEVLOG.md`：目标 / 改动 / 验证 / 遗留 / 下轮。
- 影响使用者可见行为的改动，同时更新 `README.md` 与 `CHANGELOG.md`。
- 数据格式任何变化，先改 `SPEC.md` 再改代码，并递增 `version` 字段。
- 每个非显然的取舍写一条 `DECISIONS.md`（现象、选项、选择、原因）。

### 文档地图（写新文档前先看这里）

| 文件 | 读者 | 改它的时机 |
|---|---|---|
| `README.md` / `README.en.md` | 第一次看到项目的人 | 能力、安装方式、限制变化时 |
| `docs/INSTALL.md` | 要装/要卸的人 | 安装路径、profile 结构、回滚方式变化时 |
| `docs/USAGE.md` | 用面板的人 | 交互、快捷键、设置项变化时 |
| `docs/FAQ.md` | 遇到问题的人 | 出现新的「常见误解」或排查步骤时 |
| `docs/DETAIL.md` | 插件详情页/列表里的一句话介绍与快速上手 | 能力、打开方式、数据位置变化时 |
| `docs/AGENT.md` | **用这个插件的助手** | 分工、约定、工具用法变化时 |
| `SPEC.md` | 改格式/写工具的人 | 字段、操作、校验规则变化时 |
| `docs/ARCHITECTURE.md` | 要改代码的人 | 分层、数据流、注册方式变化时 |
| `docs/COMPAT.md` | 换 DSH 版本的人 | 验证过新版本、或依赖服务变化时 |
| `CONTRIBUTING.md` | 外部贡献者 | 测试、约定、提交方式变化时 |
| `SECURITY.md` / `docs/PRIVACY.md` | 关心权限的人 | 读写范围、注入内容变化时 |

**`docs/AGENT.md` 是运行时的**：`index.js` 在插件启动时读它并注册成技能 `dsh-todo-plan`。改这份文档等于改助手的行为，改完要重启 DSH 生效，并在 `tool-test.mjs` 里保持「技能内容来自该文件」的断言。


## 5. DSH 插件红线

来自 DSH 官方插件文档，别越线：

- 不新增 session 事件类型（会让会话无法重新打开）；
- 客户端不 `require` 其他 Harness 客户端包（primitive 一律不得导入，控件自己写）；
- 样式只用 `--dsw-alias-*` 主题 token，不写死颜色（图标/插画除外）；
- 不往 `document.body` 追加东西，不替换 app root；
- 注册一律放在 `ctx.effect` 里，返回清理函数；
- 客户端调宿主只走已有 Remote（`workspaceFiles`、`commands` 等）。

## 6. 安全

- 开发期不提交任何密钥、绝对路径、个人路径；
- 测试数据用仓库里的 `examples/`，不拿真实项目计划文件当测试夹具。

## 6b. 在对话里贴图/贴链接的路径基准

聊天界面把相对路径解析到**会话工作区**（本仓库的上一级 `dsh new sth`），不是仓库目录 `dsh-todo/`。

- 贴仓库里的图要写 `dsh-todo/docs/images/xxx.png`；
- 只写 `docs/images/xxx.png` 会被拼成 `<工作区>/docs/images/xxx.png`，界面上显示「图片无法预览」；
- 仓库文档内部的相对链接（README → `docs/images/...`）仍按文件位置解析，不需要加前缀。

## 7. 会话日志红线（事故换来的）

- `agent.inject(message)` / `agent.followup(message)` **只接受 UserMessage 对象**：`{ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'dsh-todo', … } }`。传字符串不会当场报错，但会在**下一次加载会话**时被判 corrupt，整条会话打不开（2026-11-21 的事故）。
- 任何往会话日志写东西的路径，形状必须对齐 `createUserMessage`（`@deepseek-ai/dsh-llm`）。DSH 写入端宽松、读取端严格。
- 排查用 `node tools/session-check.mjs <session.v4.jsonl.zstd>`（只读，输出 header / 事件数 / seq 连续性 / `inserted` 是否有非法项）。
- 改完这类代码，跑 `npm test` 里的命令测试——它断言了注入的是对象而不是字符串。
