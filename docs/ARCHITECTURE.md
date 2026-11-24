# 代码结构

## 三层

```
┌────────────────────────── 浏览器（client.js） ──────────────────────────┐
│ 右栏页签：两个板页签（工作区 / 本会话）+ 面板 UI + 拖拽 + 设置页         │
│   ├─ 读：remote.workspaceFiles.read / search / changes（只读 + 订阅）    │
│   │      私板用同一接口、传绝对路径；search 只用于公板                   │
│   └─ 写：remote.commands.execute('/todo op <json>')                     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ 命令
┌────────────────────────────────▼────── 宿主（index.js） ───────────────┐
│ /todo 命令 → 判定 board → 校验载荷与路径 → applyOpAndWrite               │
│ 板路径解析：公板 planCwd + resolvePlanFile；私板只由会话 id 推导         │
│ 模型工具 todolist（自己构造定义，服务就绪后注册）                        │
│ 运行时技能 dsh-todo-plan（docs/AGENT.md）                                │
│ 通知：把改动作为一条用户消息注入会话（三档 + 合并窗口 + 板名）           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ 读写
┌────────────────────────────────▼──────────── host/plan.js ─────────────┐
│ validatePlan（严格校验）· applyOp（操作集）· repairPlan（自救）          │
│ readPlanFile / writePlanFile（原子写、rev+1、写前 version 比对）         │
└─────────────────────────────────────────────────────────────────────────┘
                                 ▲
                    host/boards.js：$DSH_HOME 解析、会话 id → 私板路径
```

## 两块板

| | 公板 | 私板 |
|---|---|---|
| 文件 | `<工作区>/todolist.json` | `$DSH_HOME/dsh-todo/<会话id>/private.json` |
| 谁决定路径 | 会话工作区（`workingDirectory`）+ 搜索 | 只有会话 id（`host/boards.js`） |
| 面板怎么读 | 相对路径 + `search` 兜底 | 宿主给绝对路径，直接 `read` |
| 面板怎么刷新 | 文件 `changes` 订阅 | `changes` 订阅 + 4 秒兜底重读 |
| 换工作区 | 换了一块板 | 还是那一块 |

**为什么私板放 `$DSH_HOME` 而不是工作区**：私板锚的是会话。会话的工作目录会变（`workingDirectory`、worktree），放工作区就得再记一份「当初建在哪个工作区」的指针，而且会话换到 B 工作区后写私板等于往 A 的目录里写——正是「跨工作区只能读或复制」要避免的。放用户数据目录里，路径只由 id 推导，没有指针、没有跨工作区写。

**为什么私板不用 `search`**：DSH 的工作区文件服务对**文件**的读写权限不限于工作区（`read` / `stat` / `changes`），只有目录列举和搜索是工作区范围的。私板是已知的绝对路径，正好落在允许的那一半。

**为什么还要 4 秒兜底重读**：私板在工作区外，`changes` 可能静默不开（没有错误，只是没有事件）。兜底用 `read`——它不是命令，不会往会话日志里写任何东西；`rev` 没变就不重渲染。

**为什么页签状态推给宿主**：工具需要知道「用户正看着哪块板」才能把「加一条」落到对的地方。宿主记 `Map<sessionId, board>`，只由用户点页签时更新；两块都在又没有这一信息时，工具宁可报错让助手问一句。


## 为什么这么分

**面板不写文件。** 浏览器端没有写工作区的 API，也不该有：所有写入收敛到宿主的一条命令，才有校验、版本冲突检测和统一的错误文本。

**宿主与工具共用 `applyOpAndWrite`。** 面板的 `/todo` 命令和模型的 `todolist` 工具走同一个入口，两边的行为不可能漂移。测试也是对着这个入口打的。

**校验在读和写上双重把关。** 读的时候严格（不认识的行/字段直接报错，面板显示「计划文件有问题」），写的时候再校验一次整份结果（`writePlanFile` 里），所以永远不会写出一个自己都读不回来的文件。唯一的例外是 `repair`：它必须绕过读校验，直接读原始文本。

**工具定义自己构造，不依赖 `@deepseek-ai/dsh-tools`。** 这个包只在 DSH 安装目录里，而插件常以 `link:` 安装到仓库；从仓库解析不到，`import()` 失败后又容易静默吞掉——结果就是工具从来没注册上而没人发现。自己编译参数简写 → JSON Schema 只多几十行，换来零依赖和可测试。

**注册都要能降级。** `tools` / `skills` / `workingDirectory` 都不在 `inject` 的必需列表里（只有 `commands` 是必需的）：拿到就用，拿不到就让出能力，面板与写入通道绝不能一起消失。

## 会话开关

插件不是全局无条件的：每个会话在输入框上方有一个开关（默认关）。

```
composer 开关 ──localStorage──> 浏览器记住状态
      │
      └─ /todo op {"op":{"op":"session","enabled":…}}
                     │
                     ▼
             宿主 sessionFlags: Map<sessionId, bool>
                     │
      ┌──────────────┼───────────────┐
      ▼              ▼               ▼
系统提示段      工具 execute      通知 notifyAgent
(开才注入)     (关就拒绝)        (关就静默)
```

- 系统提示用 `ctx.systemPrompt.section()`，`text` 是**函数**，每次装配都按 `context.agent` 重新求值——所以关掉后下一轮就没有了，也不会在聊天记录里留痕。
- 工具是在 `execute` 里查开关：订阅表不支持按会话隐藏工具，所以只能"在门口拦"。
- 子会话没有 composer，`sessionEnabled` 直接返回 false，工具会提示把改动回报给主对话。
- 开关不写文件、不改 `rev`，和计划数据完全解耦。

## 数据流

### 读

1. 面板先用 `{"op":{"op":"boards"}}` 问宿主两块板的绝对路径与是否存在（页签与空态都靠它）；
2. 公板：`workspaceFiles.read` 读工作区根目录的 `todolist.json`，没有就 `search` 找同名文件取层级最浅的；
3. 私板：直接 `read` 那条绝对路径，不搜索；
4. 对读到的路径开 `changes` 订阅（公板另保留根目录那条），150ms 去抖后重读；私板另有 4 秒兜底重读；
5. 页脚显示板的位置与 `rev`。

### 写

1. 面板发 `/todo op {"path":"…","op":{…}}`（公板）或 `/todo op {"board":"private","op":{…}}`（私板）；
2. 宿主校验：`op` 必须是对象；`board: "private"` 时路径由会话 id 推导（拿不到 id 就拒绝），否则 basename 必须是 `todolist.json` 且路径必须在会话工作区内；
3. `applyOpAndWrite`：读 → 校验 → 应用一个操作 → `rev + 1` → 临时文件 + rename（父目录不存在就先建）；
4. 成功后按 `ui.notify` 通知助手（带板名）；文件变化再触发第 1 步的重读。

### 通知

- `next-turn`：`agent.inject(message)`，下一轮上下文可见，不唤醒；
- `wake`：`agent.followup(message)`，立刻跑一轮；
- `off`：什么都不做；
- 相同描述去重，`ui.notifyWindow`（默认 8 秒）窗口内合并成一条；
- 工具自己的写入不通知（模型不需要告诉自己）。

**消息必须是对象**：`{ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'dsh-todo', … } }`。传字符串会在下次加载会话时被判 corrupt（[ADR-0007](../DECISIONS.md)）。

## 文件地图

| 文件 | 关心什么 |
|---|---|
| `client.js` | 面板的一切：字典、样式、组件、两个页签的壳、拖拽状态机、设置页、`planProblems` |
| `index.js` | 命令、工具、技能、通知、两层路径校验、服务查找（`toolsService` / `skillsService` / `planCwd`） |
| `host/plan.js` | 格式与规则：`validatePlan`、`applyOp`、`repairPlan`、`readPlanFile`、`writePlanFile`、`applyOpAndWrite` |
| `host/boards.js` | 板在哪：`$DSH_HOME` 解析、会话 id 白名单、私板路径推导 |
| `tools/*.mjs` | 五套无依赖测试（含 `board-test.mjs`） |
| `docs/AGENT.md` | 给助手的使用约定（同时注册成技能） |

## 常见的改动位置

| 想改 | 改哪 |
|---|---|
| 面板样式/布局 | `client.js` 的 `STYLE` 与组件 |
| 页签与空态 | `client.js` 的 `TodoBody`（壳）/ `BoardTabs` / `BothEmpty` |
| 新操作 | `host/plan.js` 的 `applyOp` + `index.js` 的 `describeOp`/工具分支 + `SPEC.md` |
| 校验规则 | `host/plan.js` 的 `validatePlan`（读与写都会用）+ `client.js` 的 `planProblems`（提示用） |
| 板放在哪 | `host/boards.js` |
| 通知策略 | `index.js` 的 `notifyAgent` |
| 给助手的约定 | `docs/AGENT.md`（技能内容从这份文件读） |

## 失败模式

| 现象 | 通常原因 |
|---|---|
| 面板空白 | 客户端 factory 抛错（`smoke-client.mjs` 能抓到大部分） |
| 面板正常但点了没反应 | 文件里有不合法行 → 全部写入被拒；面板顶部会有黄色提示 |
| 面板正常但改不动、也没有提示 | 宿主命令没注册（旧版本）或路径校验拒绝（看红条） |
| 私板页签一直空 | `$DSH_HOME` 解析不对（环境变量空/指向别处）、会话 id 不合法，或板确实没建 |
| 助手看不见工具 | 注册失败或 `tools` 服务未就绪；查 `%TEMP%\dsh-todo-tool-status.json` |
| 助手看不到计划内容 | 工作区解析不到（`workingDirectory`）；工具会明确报「拿不到会话工作区」 |
| 助手说「各有一块板」 | 两块都在、用户又没指定，工具按设计要求问一句 |

## 外观与动效怎么落地（0.1.0 起）

- **外观**是计划文件里的两个字段（`ui.style` / `ui.material`），客户端只负责把它们映射成面板根节点上的 `data-style` / `data-material`，样式全部写在插件自带的那张 `<style>` 里（只用 `--dsw-alias-*` token）。宿主侧的校验在 `host/plan.js` 的 `STYLES` 与 `validatePlan`。
- **动效不由挂载触发**。`TodoBody` 用 `useRef` 保存上一份 `id → status`，每次计划变化后比较，只有「变成 completed」的 id 进入 `flashIds`（900ms 后清空），行上渲染 `data-flash="done"`，动画规则只挂在 `[data-flash="done"]` 下——所以换序、进出设置页都不会重放。
- **折叠**用 `grid-template-rows: 0fr ↔ 1fr`（内容留在 DOM 里，`overflow:hidden;min-height:0`），收起时容器带 `inert`，键盘不会聚焦到隐藏行。
- **删除**：`confirmDelete` 先给该行 `data-removing`（0.26s 左移淡出收高），写盘成功或失败后清标记；文件监听随后才把节点从数据里移除。
