# 参与开发

## 项目结构

| 路径 | 是什么 |
|---|---|
| `index.js` | 宿主半边：`/todo` 命令、模型工具 `todolist`、给助手的技能、通知注入 |
| `host/plan.js` | 计划文件的模型：校验、操作、`repair`、原子写 |
| `client.js` | 浏览器半边：右栏页签、面板 UI、拖拽、设置页（单文件，无构建） |
| `tools/*.mjs` | 四套测试，纯 Node，不需要 DSH 在跑 |
| `docs/` | 用户文档、给助手的说明、架构与兼容性 |
| `locale/*.json` | 只有插件管理页的元数据（标题/描述）；面板文案在 `client.js` 的 `zh` / `en` 字典里 |

## 本地开发

```bash
node tools/plan-store-test.mjs   # 文件模型：校验、操作、repair、原子写
node tools/command-test.mjs      # 宿主命令、三种通知、创建
node tools/tool-test.mjs         # 模型工具与技能注册
node tools/smoke-client.mjs      # 面板渲染冒烟（假 React + 假 ctx）
```

`npm test` 依次跑这四套。

装进本机 DSH 调试（见 [docs/INSTALL.md](docs/INSTALL.md#方式三手动改-profile开发期)）：用 `link:` 指到仓库。

- 改 `client.js` → 刷新页面（`Ctrl+R`）就生效；
- 改 `index.js` / `host/` → **重启 DSH**，宿主代码不会热替换。

## 加测试的时机

- 改 `host/plan.js`（校验、操作、写盘）→ `plan-store-test.mjs` 加用例；
- 改命令载荷、通知、`repair` 文案 → `command-test.mjs`；
- 改工具参数/返回、技能注册 → `tool-test.mjs`；
- 改面板结构、增删 `data-action` → `smoke-client.mjs`（它断言按钮数量与文案）。

测试全绿 + 至少一次真实页面操作，才认为改完了。

## 代码约定

这些是 DSH 插件的红线，越过会导致会话或面板出问题：

1. **客户端不能 `require` 其他 Harness 客户端包**，控件自己写；
2. **样式只用 `--dsw-alias-*` 主题 token**，不写死颜色；
3. 注册一律放 `ctx.effect` 里并返回清理函数；
4. **不新增 session 事件类型**；往会话注入必须是完整的 UserMessage 对象
   `{ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'dsh-todo', … } }`
   ——传字符串会在**下次加载会话**时报 corrupt（我们踩过，见 DECISIONS ADR-0007）；
5. 面板不写文件：每个操作都走 `/todo op <json>` 命令；
6. 宿主侧的注册（工具、技能）必须能在服务缺失时降级，不能让面板或命令一起失效。

## 提交

- 一个里程碑一个提交 + 一个 tag：提交信息 `M<n>: <做了什么>`，正文写验证方式；
- 影响用户可见行为时同步更新 `CHANGELOG.md` 与相关 `docs/`；
- 非显然的取舍写一条 `DECISIONS.md`；
- 每轮开发记录追加到 `DEVLOG.md`（目标 / 改动 / 验证 / 遗留）。

## 提 PR

- 说明**为什么**要改，而不只是改了什么；
- 贴出跑过的命令与结果（四套测试的输出）；
- 涉及界面时附截图（浅色/深色各一张更好）；
- 没验证到的部分请明说。

## 报 bug

用 bug 模板，尽量带上：

- DSH 版本与系统；
- 面板页脚显示的 `文件 … · rev …`；
- `%TEMP%\dsh-todo-tool-status.json` 的内容（工具/技能是否注册）；
- 面板顶部的红条/黄条文字，或浏览器控制台的第一行报错。

## 许可

提交即同意以 [MIT](LICENSE) 发布。
