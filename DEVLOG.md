# 开发日志

每条记：目标 / 改动 / 验证 / 遗留 / 下轮。按轮追加，不删旧条目。

## 2026-11-21 · M0 脚手架

**目标**：把 bundle 立起来，右栏出现一个能打开的「计划」页签，证明安装链路通。

**改动**
- `package.json`：`dsh.bundle.patch` + `dsh.client`（`platform: web`, `immediately`, 依赖 `dsh-client-ui-sidebar-right`）。
- `cordis.patch.yml`：插入一行 `dsh-todo`。
- `index.js`：宿主端空壳（M1 起接文件存储）。
- `client.js`：注册页签类型 `todo` + 页面 body 槽 `sidebar.right.pane.tab`，示例数据渲染；额外注册一个输入框下方的「计划」按钮用于验证。
- `locale/{zh,en}.json`、`icon.svg`、`docs/DETAIL.md`、`docs/preview.svg`。
- 仓库文档：`README.md`、`AGENTS.md`、`SPEC.md`、`DECISIONS.md`、本文件、`CHANGELOG.md`、`LICENSE`。

**验证**
- `node --check` 通过 `index.js` / `client.js`；三个 JSON 解析通过。
- `npm test`（`tools/smoke-client.mjs`）通过。
- `plugin_manager install_bundle` 返回 `application: applied`；profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 都已有 `dsh-todo`，`node_modules/dsh-todo` 指向仓库。
- **页面实测（2026-11-21）**：刷新后右栏出现「计划」页签，点击后右侧正确出现面板；宽度、位置、留白正常，配色跟随主题。临时入口按钮落在输入框**下方**（`conversation.composer.dock` 的实际位置）。暗色主题下的对比度未单独看。

**遗留**
- 客户端多文件构建（esbuild）未接入，现在是手写单文件。
- 关闭页签后如何再次打开：目前靠输入框按钮或右栏引导页。

**下轮（M1+M2）**：真实 `todolist.json` 的校验、读写与只读面板。

## 2026-11-21 · M1 + M2 数据层与只读面板

**目标**：面板显示真实的 `todolist.json`，文件一变就自己刷新。

**改动**
- `todolist.json`（仓库根）：这个插件的开发计划，作为第一份真实数据。
- `host/plan.js`：`validatePlan`（严格：未知字段、重复 id、悬空依赖、依赖成环）、`applyOp`（status/toggle/rename/due/note/add/addChild/remove/move/addGroup/settings/open）、`dueState`、`readPlanFile`、`writePlanFile`（临时文件 + rename，`rev` 递增，写前比对 `version`）。
- `client.js`：`remote.workspaceFiles.read` 读 + `changes` 订阅（150ms 去抖）；真实数据渲染（分组、子项、进度、逾期/今天、待前序、隐藏已完成）；缺文件/坏 JSON/无会话三种状态；`__DSH_TODO_TEST__` 下暴露 `buildUi` 与 `normalizePlan` 给冒烟检查。
- `tools/plan-store-test.mjs`：17 个用例（校验、操作、成环、原子写、stale 拒绝、缺失/坏 JSON）。
- `tools/smoke-client.mjs`：改为渲染真实数据结构，覆盖 ready / 隐藏已完成 / 缺失 / 非法四条路径。

**验证**
- `node --check client.js`、`node --check host/plan.js` 通过。
- `node tools/plan-store-test.mjs` → 17 passed。
- `node tools/smoke-client.mjs` → OK。
- 注意：这台机器的 `cmd` 解析不到 `node`，所以 `npm test` 会报 `'node' is not recognized`；直接跑 `node tools/…` 正常。脚本本身没改，换台机器应该就能用。
- **未验证**：页面里 `changes` 流是否真的按预期推送（`$stream` 的用法抄自 `ui-sidebar-files`，没在跑起来的页面里看过刷新）；`read` 传 `{}` 作为 range 是否被接受。这两点要靠页面实测。

**遗留**
- 隐藏已完成目前只是面板内临时开关，点击不落盘（M3 接 `settings` 操作）。
- 页签关闭后没有「重新打开」的快捷入口，仍靠输入框下方的临时按钮。

**候选（下轮方案里提）**
- 悬浮打开：`openTab(kind, { destination: 'float' })` / `float(tabId)` 都能用；用户要的是「默认右上、可自由拖、拖到窗口边缘吸附」。前两条是 dockkit 自带，第三条（边缘吸附）在 kit 的文档里没有提到，需要实测或另想办法。

**下轮（M3）**：面板写入 —— 勾选、行内改名、增删、上移下移，走 `/todo op <json>` 命令 → `host/plan.js` → 原子落盘。

## 2026-11-21 · M2 修复：计划文件解析

**现象**：重开页签是「还没有计划」空态。

**诊断**：面板按 `sessionId` 读工作区文件，而「工作区」是**会话创建时**的目录，仍然是 `dsh new sth`。我用 `working_directory` 切到 `dsh-todo` 只改了本会话里命令的 cwd，没有改会话头里的工作区根，所以 `todolist.json` 在工作区里是「不存在」而不是「读失败」。

**改动**
- `client.js`：读取改为三步解析 —— 记住的路径 → 根目录 `todolist.json` → `workspaceFiles.search` 找到的**层级最浅**的同名文件；找到后对它开 `changes` 订阅，同时保留根目录那条订阅（以后把文件移到根目录也能发现）。面板页脚显示实际读到的相对路径。
- `pickPlanPath` 暴露给冒烟检查，新增 4 条断言。
- `SPEC.md` / `DECISIONS.md`（ADR-0006）记录解析顺序与代价。

**验证**：`node --check client.js`、17 个模型用例、冒烟检查全过。页面实测（2026-11-21）：刷新并重开页签后，面板显示「dsh-todo 开发」，完成 7/14，M0–M5 六个阶段各自计数正确，子项缩进、待前序提示、12-01 截止日期、页脚 `文件 dsh-todo/todolist.json · rev 4` 都对。**M2 关闭。**

**遗留（M5 打磨时看）**：顶部「隐藏已完成」和「完成 7/14」两行占了两行高度，可以把开关挪到页脚或做成图标；阶段标题与计数挤在一行，窄面板下会更紧。

## 2026-11-21 · M3 面板写入

**目标**：面板里能改，全部写入走一条宿主命令落到文件。

**改动**
- `index.js`：注册 `/todo` 命令 —— 解析 `op <json>`、只接受 basename 为 `todolist.json`、路径必须在会话工作区内（能拿到 `session.cwd` 时）、交给 `applyOpAndWrite`，返回 `已保存 rev N` 或错误文本。
- `host/plan.js`：新增 `applyOpAndWrite`（读 → 校验 → 应用 → 原子写，带版本比对）和 `reorder` 操作。
- `client.js`：状态点循环、双击改名、加事项/子项、删除两段确认、上下移动、日期输入、隐藏已完成落盘；保存中禁用、失败显示错误条；内联样式块让行操作只在 hover/focus 时出现。
- `tools/command-test.mjs`：命令层 8 个场景（成功、坏 JSON、缺 verb、错文件、越界路径、未知操作、缺 path）。
- `tools/plan-store-test.mjs`：加 reorder 与 `applyOpAndWrite`（含坏文件不覆盖），共 20 个用例。
- `tools/smoke-client.mjs`：面板渲染改成 `{state, view, handlers}`，断言状态点、删除、添加控件都在且点击会回调。

**验证**
- `node --check` 三个文件通过。
- `node tools/plan-store-test.mjs` → 20 passed；`node tools/command-test.mjs` → OK；`node tools/smoke-client.mjs` → OK。
- **未验证**：页面里的真实点击（命令是否注册进宿主、`commands.execute` 的返回形状、`agent.session.cwd` 是否存在）。宿主侧代码改了，可能需要重启 DSH 才生效。

**下轮（M4）**：助手工具 + 变更通知（模式可选）+ 明确要求时自动打开面板。

## 2026-11-21 · M3 修复：命令载荷多套了一层

**现象**：页面里点圆点，命令返回 `不认识的操作 "[object Object]"`。

**诊断**：面板发的是 `{ path, op: { op: "status", … } }`，宿主却把**整个 payload** 当成操作对象传给 `applyOp` —— 于是 `op.op` 是一个对象，落到 default 分支。

**改动**
- `index.js`：取 `payload.op` 作为操作；平铺形式（操作字段与 `path` 同级）仍然接受；都不满足时给出明确报错。
- `client.js`：先发嵌套形式；若宿主回报「不认识的操作」，自动改发平铺形式再试一次 —— 这样旧宿主也能用，避免为了这处改动再重启一次 DSH。
- `tools/command-test.mjs`：改为嵌套形式为主，补平铺兼容与缺 `op` 对象两个场景。
- `SPEC.md`：写入通道的载荷改成嵌套写法，并注明平铺形式为兼容。

**验证**：20 个模型用例、命令层、冒烟检查全过。

## 2026-11-21 · M3 打磨：不让写入命令刷屏

**现象**：每点一次面板，对话里就多一行 `todo · 已保存 rev N`。

**原因**：命令生命周期的 `command/run` / `command/done` 会被 Chat 渲染成节点行，这是命令面的设计（真人执行的动作留痕）。插件侧没有「静默执行」的参数。

**改法**：`conversation.chat.commandview` 是按命令名 key 的槽位，注册一个 key 为 `todo` 的组件返回 `null`，只吃掉自己这条命令的行，其它命令不受影响。报错改由面板内的错误条承担。

**验证**：冒烟检查断言了该槽位注册（key 为 `todo`、渲染为带标记的折叠元素）。页面实测：连点十下对话不再被抬升，说明 `[class*="flowItem"]:has(…)` 命中了宿主样式。**M3 关闭。**

## 2026-11-21 · M4 界面与交互

**目标**：把面板的观感和操作打磨到位（助手联动顺延到 M5）。

**改动**
- 顶部合并一行：标题（单行截断）+ `完成 x/y` + 「隐藏已完成」图标按钮；去掉原来的第二行。
- 阶段标题改成可点击折叠的按钮（chevron + 标题 + 模式 + 计数），折叠只记在面板内存里，不写文件；空阶段显示一行提示。
- 日期：无日期时不再常驻日期控件，只在 hover 时出现「设日期」图标，点开才是原生日期输入；有日期的标签点一下即清除。
- 新增「添加阶段」行；计划文件缺失时，空态里给「创建计划」按钮。
- 行可聚焦：Enter/空格循环状态、F2 改名、Delete/退格 删除（两段确认照旧）；hover/focus 背景与聚焦描边。
- 新增 `create` 操作与 `createPlanFile`（存在则拒绝，不覆盖）；命令在缺 `path` 且操作为 `create` 时用会话工作区根拼路径。
- 冒烟检查补：折叠、添加阶段、设/清日期、创建计划按钮；命令测试补：创建成功、二次创建被拒。

**验证**
- `node --check` 三个文件通过；模型用例 20 个、命令层、冒烟全过。
- **未验证**：页面里的实际观感（顶部一行是否挤、折叠手感、键盘路径、深色对比度）。需要人眼过一遍。

**下轮（M5）**：助手工具 + 用户改动通知 + 明确要求时自动打开面板。

## 2026-11-21 · 视觉重做

**背景**：用户认为面板整体美感不够，指定参考 op7418/dsh-guizang-design。

**做法**：把这个 skill 克隆下来读了 `references/design-rules.md` 与 `themes.md`，按"瑞士风"的公共规则重写样式，写进 `DESIGN.md`：
- 全面板只剩页头下一条发丝线，section 之间 26px 留白、不画线；
- 一个强调色（进行中环、聚焦描边），其余全部灰阶；
- 三级字体 + 元信息等宽表格数字（进度 `01/02`、日期、`rev`）；
- 状态控件从 9px 圆点换成 16px 的"环 / 环+实心 / 实心勾"；
- 阶段头加 `01` 编号与折叠箭头，作为唯一的版式装饰；
- 空态改成居中图标 + 标题 + 说明 + 按钮；
- 行操作仍在 hover/focus 出现，键位不变。

**验证**：语法、20 个模型用例、命令层、冒烟全过（冒烟断言里进度文案改成 `完成 01/02`）。页面观感待用户确认。

**下轮**：按反馈微调间距/字重；之后接助手工具。

## 2026-11-21 · M5 助手联动、设置页、进行中/下一步

**目标**：助手能读写计划并知道面板改动；面板有独立设置页；顶部标出「正在做哪部分、下一步是哪部分」，并且能随时改下一步。

**改动**
- `host/plan.js`：`ui.notify`（三档，默认 next-turn）与 `ui.next`（事项 id 或 null）进校验与输出；新增 `next` 操作；`settings` 接受 `notify`。
- `index.js`：`todolist` 工具（read / add / addChild / status / rename / due / remove / move / reorder / settings / next / open / create），工具与命令共用 `applyOpAndWrite`；命令写入后按 `ui.notify` 通知（inject / followup / 静默，900ms 合并、摘要由 `describeOp` 生成）；工具注册用动态 import，拿不到 `@deepseek-ai/dsh-tools` 时安静跳过，面板不受影响。
- `client.js`：顶部「进行中 / 下一步」两行标识；`resolveNext`（显式 `ui.next` 优先，否则第一个未被前序挡住的 pending）；行内 hover 的靶心按钮设为/取消下一步；下一步行有 `下一步` 标签；标题右侧滑块图标进入设置页（三档通知方式，写入 `ui.notify`）；输入框下方的「计划」按钮兼任 `openRequest` 监听，计数跳变时自动开页签。
- 测试：`tool-test.mjs` 新增；命令层补三档通知断言；模型用例补 notify/next 校验；冒烟检查补设置页、焦点块、设为下一步。

**验证**：四套测试全过（21 模型 + 命令 + 工具 + 冒烟）。页面截图确认焦点块与「下一步」标签正常；**设置页没能用自动化点开**（盲点坐标误开了别的页签），只用冒烟渲染证明了它，需人眼确认。

**遗留**
- 设置页目前只有通知方式；计划文件路径、去重时长等还没进去。
- 自动打开的监听挂在输入框按钮上，如果这个座位在某些布局下不挂载，自动打开会失效。

## 2026-11-21 · 修复行操作失灵 + 卡片内提示 + 拖拽排序

**现象**：刷新到 M5 后，勾选、删除、上下移动都点不动。

**诊断与改动**
- 直接原因是宿主插件在 `apply` 里先 `await registerTool(ctx)` 才注册命令；工具那段一旦不返回，命令就永远不注册，面板的每一次写都失败。改成**先注册命令，再 fire-and-forget 注册工具**，工具失败不影响写入。
- 「进行中 / 下一步」从面板顶部挪进各自阶段卡片（标题下的浅色条），顶部不再有独立块。
- 拖拽：行设置 `draggable`，同阶段内拖动会显示插入线；松手后不写文件，而是在顶部出现确认条，点确认才 `reorder`，**6 秒不确认自动撤回**（定时器丢弃 pending 顺序，列表弹回）。
- 冒烟检查补了含 pending 的样例，断言焦点条与下一步标签。

**验证**：四套测试全过。**页面侧未能亲自点验**（我的盲点坐标把窗口点乱了，误开了预览页签），需要用户刷新确认行操作恢复。

## 2026-11-21 · 事故：会话被通知写成 corrupt

**现象**：重启 DSH 后，本会话无法加载；在别的会话里 `@` 它也会让那一轮直接失败，报 `SessionFormatError: agent/inbox/spliced requires message objects`。

**根因**：`notifyAgent` 把字符串交给 `agent.inject(text)` / `agent.followup(text)`。这两个 API 要的是 `UserMessage` 对象。DSH 写入时不校验，事件照常进日志；**加载时**才校验 `inserted` 必须是消息对象，于是一行非法数据让整条日志判 corrupt。

**修复**
- `index.js`：新增 `noticeMessage(text)`，生成 `{ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'dsh-todo', form: 'notice', summary: text } }`（等价于 `createUserMessage`），`inject`/`followup` 一律传它。
- `tools/command-test.mjs`：断言收到的是对象、字段齐全、文本在 `content[0].text`；这正好是之前缺的那条约束。
- `DECISIONS.md` ADR-0007、`SPEC.md` 记录规则。

**教训**：纯 JS 插件绕过了 TS 类型；凡是往会话日志里写的东西，形状必须按 `createUserMessage` 的产物来。写入端宽松、读取端严格，这类错误只在下次加载时爆。

**遗留**：用户已卸载插件，仓库代码修好但未重装；那次写坏的会话日志由另一个会话在修（截断/重建分帧），与本插件无关。

## 2026-11-22 · 交互二轮：拖拽跨阶段、阶段拖动、通知合并

**需求**：下一步标签不够醒目且和行操作重合；去掉上下移动只留拖拽；大块（阶段）也能拖；支持跨阶段拖事项；确认条放到被拖位置旁边，而不是面板顶部；上下文注入的行太多。

**改动**
- 行操作去掉 ↑ ↓；`下一步` 改为品牌色实心标签并移到标题**前**，不再与右浮层按钮重叠。
- 拖拽统一：`dragStart/dragOver/drop` 带 `kind`（item / group / stage）；事项可跨阶段落位（`reorder` 带目标 `groupId`），阶段标题可整块拖（新操作 `reorderGroups`）。
- 确认条改成渲染在**被拖到的卡片底部**（阶段拖动时落在移动后的那张卡里），6 秒自动撤回不变。
- 通知合并：新增 `ui.notifyWindow`（秒，默认 8，1..600，设置页可改），窗口内连续改动合成一条；相同描述去重；`hideCompleted` 这类显示改动不再产生通知。
- 文档：SPEC 更新拖拽/窗口规则；DECISIONS 补 ADR-0007（已在事故轮）；冒烟与模型用例补断言。

**验证**：`node --check` 通过；模型用例 23、命令层、工具、冒烟全过。

**遗留**：上下文注入行**无法隐藏**（是 DSH 自己的 context 行渲染，第三方插件没有对应槽位），只能靠合并窗口减少条数；默认 8 秒，可在设置页调大。

## 2026-11-22 · 交互三轮：拖动抓手、折叠时的提示、按钮文案

**反馈**：折叠大块时「下一步」看不到；行操作点完一直显示；改状态又没反应了；移动确认条上出现「删除」。

**改动**
- **根因**：上一轮把整行设成 `draggable`，点圆点时的轻微移动会被当成拖拽手势，click 被吃掉 → 状态改不动。现在只有行左侧的六点**抓手**可拖（悬停出现），行本身不可拖；阶段拖动同样只从标题里的抓手开始。
- 行操作只在 `:hover` / `:focus-visible` 时出现，去掉 `:focus-within`（它会让点击后的行一直亮着）；`.dsh-todo-stage-focus` 从可折叠区移出，折叠后仍显示「进行中 / 下一步」。
- 移动确认按钮原来复用删除的文案 `panel.confirm='删除'`，新增 `panel.confirmMove='确认'`、`panel.cancelMove='取消'`。

**验证**：语法、模型 23、命令、工具、冒烟全过。页面行为需用户刷新后确认（尤其是圆点点击恢复）。

## 2026-11-22 · 修复「点了没反应」+ 子项折叠 + 常显提示

**反馈**：圆点点了完全没反应；拖动排序的提示条不见了；删除删不掉；子事项无法折叠；「正在做的」提示找不到了。

**排查（有据）**：会话日志里连点圆点产生了 5 条 `command/run`，每条都紧跟着
`command/done kind:"error" text:"invalid-plan: items[21].title 必须是非空字符串"`。
计划文件第 22 项是 `{"id":"t44ff56","groupId":"m6","order":7,"status":"completed"}`——**没有 `title`**，
是上一轮我手写 JSON 记计划时漏掉的（`git log -S t44ff56` 指向 1586a65）。写入校验整份文件，所以一处坏行让所有写入被整体拒绝。
子项折叠是**从没做过**的功能；「进行中 / 下一步」是上一轮按「展开时不要重复」改成只在折叠时显示的，展开就没了；确认条渲染在卡片最底部，长列表里在视野外。

**改动**
- 数据：删掉空项 `t44ff56`，文件恢复合法（不用重启，面板 watch 到就会重读）。
- `host/plan.js`：新增 `repairPlan`（缺 id/重复/缺标题/非对象的事项与阶段移除；status 回退 pending；孤儿 groupId 变未分组；after 去掉悬空、自指、重复、成环；未知字段丢弃；ui.next 悬空清空；ui 未知键保留）与 `repairPlanFile`；`applyOpAndWrite` 对 `{"op":"repair"}` 在校验之前走原始文件通道。JSON 语法坏了拒绝自动修。
- `index.js`：`describeOp` 认识 `repair`；命令成功文案带上移除清单。
- `client.js`：`planProblems`（与宿主同源的必填/未知字段检查）→ 面板顶部常驻「计划文件有问题…」+「移除坏项」按钮；子事项折叠（父行左侧三角，折叠后 `+N`，`localStorage` 记住）；「进行中 / 下一步」始终显示、去掉行内「下一步」标签（同时删掉对应的样式与 `nextTag` 用法）；确认条移到面板底部 `position:sticky` 的固定条，文案写明「把「A」移到「B」之后」，跨阶段时补一句「并放进阶段「X」」。
- 测试：模型用例 24 → 31（修复/写回/合法文件不动/坏 JSON 拒绝/repair 后恢复可写）；冒烟补折叠、确认条、坏文件提示、`planProblems` 四组断言。
- 文档：SPEC 补「坏文件的自救」一节与操作表；CHANGELOG、本文件、DECISIONS ADR-0008/0009。

**验证**
- `node --check` 通过 `client.js` / `index.js` / `host/plan.js`；`node tools/plan-store-test.mjs` 31 passed；命令层 OK；工具 OK；冒烟 OK。
- 真实文件用宿主自己的 `readPlanFile` 读回：`OK rev=135 items=21`（修复前是 `invalid-plan: items[21].title`）。
- **未验证**：页面里的实际点击（需要刷新后由你点一次）；宿主是旧版时 `repair` 按钮会报「不认识的操作」，要重启 DSH 才有。

**遗留**
- 一次点击有时会落两条命令（日志里出现过 150ms 间隔的重复 run），暂未查到来源，等页面实测再定。
- 设置页仍只有通知方式与合并窗口，计划文件路径未做。

## 2026-11-22 · 状态分工与行尾合并（M6.7）

**反馈**：删除按钮和设日期按钮会重叠；「拖动排序提示条」其实是拖动时的插入横线，现在没有；最右侧「下一步」按钮和左侧循环点击冲突，建议左侧只留完成/未完成；接着确认：**进行中和下一步都交给助手**，面板只勾完成。

**改动**
- **状态分工**（SPEC 新增一节）：面板左圆点两态（`pending` ↔ `completed`），点击提示改成「标记为完成 / 标记为未完成」，`aria-pressed` 跟着走；行内「设为下一步 / 取消下一步」按钮删除，对应的 `setNext` 处理器、`panel.setNext/clearNext/nextHint/nextTag` 词条一并移除。
- **宿主**：`status` / `toggle` 把事项置为 `completed` 时，若它正是 `ui.next` 则清空指针；`remove` 删除的若是 `ui.next` 也清空；`next` 拒绝指向已完成事项（提示先改回未完成）。
- **进行中可多项**：阶段提示条列出第一项 + `+N`；`ui.next` 单独一行，但若它已在「进行中」里就不再重复。`waiting`（待前序）改成只在 `pending` 时计算。
- **行尾合并**：`.dsh-todo-tail` 里按 `[日期标签] [设日期] [加子项] [删除]` 顺序排，`.dsh-todo-actions` 从 `position:absolute` 改为 flow + `opacity/pointer-events` 控制显隐（`focus-within` 也显形）。两套绝对定位层叠在一起是这次重叠的根因；顺带修好了「有日期的行，日期标签被不可见浮层挡住点不动」。
- **插入线**：`.dsh-todo-items` 的 `onDragOver` 以前会覆盖行上刚设的目标（事件冒泡），现在看到 `event.defaultPrevented` 就跳过；行上的线补了左端小圆点；新增 `.dsh-todo-insert`，拖到阶段空白处时画在最后一行下方（空阶段画在空态位置）。
- 测试：模型用例 32（新增「完成/删除 next 时清空、next 不能指向已完成」）；冒烟新增「没有 next 控件」「每行只有一层操作层」「插入线能画」「末尾插入线」「进行中多项 +N」「进行中不再显示待前序」四组断言。
- 文档：SPEC 状态分工与新提示条规则、README、CHANGELOG、DECISIONS ADR-0010/0011。

**验证**
- `node --check` 通过；模型 32 passed；命令层、工具、冒烟全过。
- 静态渲染 + 无头 Edge 截图（浅色/深色各一份）：行尾四个按钮一行排开不重叠；拖到行上画出线；拖到空白处画追加线；进行中/下一步各一行不重复；`待前序` 只出现在未开始的行。

**未验证**：真实拖动的手感（插入线是否随鼠标即时刷新、`dragover` 频率下会不会闪）需要页面上拖一次才能确认。

**遗留**
- 行尾常驻约 90px，长标题比以前更早截断（用户已确认接受）。
- 一次点击偶尔落两条命令，仍未复现。

## 2026-11-22 · 子对话实测：`todolist` 工具根本没注册上（M6.8）

**做法**：重启 DSH 后新建两个真实子对话。A（临时工作区，`%TEMP%\dsh-todo-subtest`）按 8 步走完 read → status → next → add → addChild → status completed → read；B（真实工作区）只允许 `read`。

**结果**：两个子对话都拿不到工具，8 次调用全是 `Error: unknown tool "todolist"`。B 还确认了计划文件本身是好的（7 阶段 / 20 项 / rev 148）。
临时工作区的计划文件在测试后仍是 `rev 1`、两个事项都 `pending`——说明 `todolist` 的写入一次都没发生过，之前的"工具可用"从未被真实验证。

**根因（两处叠加）**
1. `registerTool` 里 `await import('@deepseek-ai/dsh-tools')` 失败时 `catch { return }` 直接静默返回。这个包只存在于 DSH 安装目录，而本插件是 `link:` 到仓库的——从仓库解析不到（用 Electron 运行时验证过：从 profile、从 `dsh-drawai`、从仓库三种 base 都 `MODULE_NOT_FOUND`）。
2. 即使拿到 `defineTool`，`ctx.tools` 在 apply 阶段也可能还没 ACTIVE；原来 `try { ctx.tools.register(...) } catch {}` 把这种失败一起吞掉了。

**改法**
- 不再依赖 SDK：新增 `buildToolDefinition`（把参数简写编译成 JSON Schema）+ `checkArgs`（required/enum/类型/未知参数），手写 registry 需要的定义；`output.schema` 与 `render` 一并构造。
- 注册改成分两步：`toolsService(ctx)` 同时试 `ctx.get('tools')` 与 `ctx.tools`（两个都取不到就返回 undefined，不抛）；拿不到就 `ctx.inject(['tools'], …)` 等服务就绪后补注册——面板和命令绝不因为工具而失效。
- 每次注册结果写进 `%TEMP%\dsh-todo-tool-status.json`（`ok` / `deferred` / `error` + 时间），失败同时 `console.error`。静默失败这条路由这次就堵住了。
- 参数校验提前到 execute 入口：`action` 写错会直接说"必须是 read / add / …"，而不是落到 handler 里报"不认识的操作"。
- 测试：`tools/tool-test.mjs` 改用真实 builder，断言 JSON Schema 形状（`required: ['action']`、`output.schema.required=['text']`、`additionalProperties:false`）以及三种参数错误。

**验证**：`node --check` 通过；模型 32 passed；命令层、工具、冒烟全过。**真实注册要再重启一次 DSH 才能看到**（宿主代码变更）。

**教训**：`catch {}` 包住的注册路径等于没有注册；凡是"模型看不见"的东西，必须留一条能被外部读到的证据。

## 2026-11-22 · 工具第二次实测：`session.cwd` 不是工作区来源（M6.9）

**结果**：重启后工具终于注册上了（`%TEMP%\dsh-todo-tool-status.json` → `{"ok":true,"parameters":12}`，我自己的工具列表里也出现了 `todolist`），但**调用**仍然全失败：

```
Error: 拿不到会话工作区，读不到计划
```

子对话里 8 步全挂，主会话里我自己调 `read` 也是同一句。文件系统是好的（子对话用 glob 找到过 todolist.json，`rev 1`、两条 `pending` 未被改动）。

**根因**：`exec.agent.session.cwd` 在工具上下文里是空的。查内置工具（`dsh-tool-fs/src/session-cwd.ts`、`dsh-tool-bash`）后确认正确做法是**走 `workingDirectory` 服务**：

```ts
const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
```

这个服务跟随 `cd`、还能在项目目录消失时回退，`session.cwd` 只是历史遗留字段。

**改法**
- `workingDirectoryService(ctx)`：先 `ctx.get('workingDirectory')` 再 `ctx.workingDirectory`，取不到返回 undefined 不抛。
- `planCwd(ctx, exec)`：`ensure(agent, signal)` → `get(session)` → `session.cwd` → `session.header.cwd`，逐级兜底；每级失败都吞掉继续。
- 工具里两处（`withPlan`、`create`）都改用它；失败时的错误文本带上「workingDirectory 服务有无 + session 字段名」，下次不必再猜。
- 测试：`tools/tool-test.mjs` 改成三种来源各一条——服务路径（agent 无 session）、`session.cwd` 兜底、全都没有时报错。

**验证**：模型 32 passed、命令、工具、冒烟全过。真实调用仍需再重启一次（宿主代码）。

**教训**：判断"工作区"要用 `workingDirectory` 服务，不要读 `session.cwd`；错误信息里要带上下文，否则只能靠重启试。

## 2026-11-22 · 工具第三次实测：全通（M6.9.1）

重启后 `todolist` 终于可用（`%TEMP%\dsh-todo-tool-status.json` → `{"ok":true,"parameters":12}`，主会话里 `read` 直接读到真实计划 rev 148）。

**正向（子对话 A，临时工作区）**：8 步全成功 —— read → status s1=in_progress（rev 2）→ next s1（rev 3）→ add（rev 4，新项 td22923）→ addChild（rev 5，子项 t52aad7）→ read → status s1=completed（rev 6）→ read。第 8 步 `s1` 为 completed，`← 下一步` 已消失（完成时自动清空的规则在真实宿主里生效），新增事项与子项都在。
独立复核文件：`rev 6`、`ui.next null`、s1 completed 带子项 t52aad7、s2/td22923 pending —— 与子对话报告一致；真实工作区计划未被改动（仍是 rev 148）。

**负向（子对话 B，同一临时工作区）**：5 条应当失败的调用全部失败、零意外成功、文件零改动（两次复核都是 rev 6）：
- `next` 指向已完成事项 → 「已完成，先把它改回未完成再设为下一步」；
- `status` 指向不存在的 id → 「找不到事项 "ghost"」；
- `add` 空标题 → 「title 不能为空」；
- 不存在的 action → `invalid arguments: action 必须是 read / add / …`；
- 多余参数 → `invalid arguments: 不认识的参数 bogus`。

**补测**：把子对话提到没覆盖的两条（`addChild` 空标题、`status` 非法枚举）加进 `tools/tool-test.mjs`。

**面板→助手**：这次之前几轮的通知已经证明（勾选、删除都会到我这里）。
**助手→面板**：本会话用工具写了一次真实计划（`next m3b`，语义不变，rev 148 → 149），面板应当跟随文件 watch 自动刷新到 rev 149。

**教训**：三次实测才走到"真的能用"——每次都只差一层：注册（import + 服务时序）、工作区（`session.cwd` 不可靠，要用 `workingDirectory.ensure`）。子对话测试比主会话自测可靠得多，因为主会话的隐式上下文掩盖了缺字段。

## 2026-11-22 · 开源文档齐备（M6.10）

**背景**：用户问「有没有写给 AI 看的使用文档」，盘点后发现只有工具 description 与面向改代码者的 `AGENTS.md`，没有任何面向「用这个插件的助手」的说明；同时 GitHub 开源所需的一整套文档也缺。

**新增**
- 发布门槛：重写 `README.md`（截图、分工、功能、安装、兼容性、权限隐私、已知限制、文档索引）、新增 `README.en.md`、`.gitattributes`（LF + 图片二进制）、`docs/images/` 七张截图（浅/深色面板、行尾按钮、两种拖动插入线、折叠子项、坏文件提示）、`package.json` 补 `homepage`/`bugs`/`keywords` 并把 `host` 加进 `files`（之前打包会漏掉 `host/plan.js`）。
- 给助手：`docs/AGENT.md`（分工、时机、状态语义、写什么、出错怎么办、工具速查），并在 `index.js` 里随插件启动读入、注册成运行时技能 `dsh-todo-plan`；`skills` 服务缺失时降级不影响面板。
- 使用者：`docs/INSTALL.md`、`docs/USAGE.md`、`docs/FAQ.md`。
- 贡献者：`CONTRIBUTING.md`、`.github/workflows/test.yml`（ubuntu+windows × node 20/22 跑 `npm test`）、`.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml`、`.github/PULL_REQUEST_TEMPLATE.md`。
- 合规与解释：`SECURITY.md`、`docs/PRIVACY.md`、`CODE_OF_CONDUCT.md`、`docs/ARCHITECTURE.md`、`docs/COMPAT.md`。
- 更新：`docs/DETAIL.md`（之前还写着「M0 示例数据」）、`locale/{zh,en}.json` 的描述、`AGENTS.md` 加文档地图、`SPEC.md` 加技能一节、`CHANGELOG.md` 改成 Keep a Changelog 结构（Added/Changed/Fixed）。

**顺带修的问题**
- `package.json` 的 `files` 漏了 `host`，打包发布时会缺 `host/plan.js`（本地 `link:` 安装看不出来）。
- 注册状态文件改成 `{tool:{…}, skill:{…}}` 两段式，`%TEMP%\dsh-todo-tool-status.json` 现在能同时说明工具与技能。

**验证**
- 四套测试全绿；新增技能断言（注册出的 name/source/whenToUse/正文来自 `docs/AGENT.md`、服务缺失时不崩）。
- 七张截图用当前 `client.js` + 真实计划数据渲染，无头 Edge 出图，逐张看过（插入线、行尾四个按钮、折叠 `+N`、坏文件提示都在）。
- **未验证**：GitHub Actions 尚未真跑过（本地只验证了四套脚本在 Windows 上通过）；`README.en.md` 的英文措辞未与人校。

**遗留**：技能要下次重启 DSH 才会出现在技能目录里。

## 2026-11-22 · 按会话的开关（M6.11）

**需求**：输入框里加一个开关，直接决定这个会话要不要用这个插件；开的时候才把 skill/说明注入助手，关掉就停止注入；子对话是一次性的，不需要单独的开关，要改计划就回报主对话。

**实现**
- **客户端**：输入框上方的胶囊拆成「计划（点开面板）」+「开关（role=switch）」；状态按会话存在 `localStorage`（`dsh-todo:session:<id>`），挂载时把值推给宿主。开关样式单独放 `CHIP_STYLE`——胶囊在 composer 里，面板的样式表并不在那棵树上（第一版就踩了：按钮没样式）。
- **宿主**：`sessionFlags: Map<sessionId, bool>`，默认 **关**；新增 `setSessionEnabled` / `sessionEnabled` / `isSubagent`。三处消费：
  1. `ctx.systemPrompt.section({ name:'dsh-todo:session', order:2360, text: context => 开 ? SESSION_PROMPT : '' })` —— 每次装配重新求值，关掉下一轮就没；
  2. 工具 `execute` 开头查开关，关着直接抛「本会话没有启用计划面板」；子会话抛「这是子对话……回报给主对话」；
  3. `notifyAgent` 关着时直接返回。
- **命令**：`{"op":{"op":"session","enabled":true|false}}` 不需要 `path`、不碰文件、不改 `rev`。
- **子会话**：`header.origin === 'subagent' || header.parentSession` → 一律 false，不继承父会话（用户明确说子对话是一次性的）。
- **面板**：`view.enabled === false` 时顶部一条黄色提示「本会话没有启用计划面板：…」，面板本身仍可查看与编辑。
- 诊断文件 `%TEMP%\dsh-todo-tool-status.json` 现在有三段：`tool` / `skill` / `prompt`。

**验证**
- 四套测试全绿；新增用例：开关命令（无 path 也能切）、系统提示段随开关变空/变有、子会话永远没有段、关闭的会话收不到通知、工具在关闭/子会话两种情况下分别报对错误、冒烟里开关渲染与面板横幅。
- 用无头 Edge 渲染核对了三种状态：开关关、开关开、以及面板的未启用提示条。
- **未验证**：真实页面里点开关的效果（要刷新页面确认），以及真实子会话里工具被拒时的文案。

**遗留**：`dsh-todo-plan` 技能仍在全局目录里（API 不支持按会话隐藏），只是关着时系统提示不再引导它。

## 2026-11-22 · 行尾按钮改为「需要时占位」（M6.11.1）

**反馈**：窄一点的面板里，行尾为了让按钮有位置，标题被提前截断，右边却空着一大片。

**原因**：上一轮把两层浮层合并时，为了让「悬停不跳动」，选择了常驻占位（`opacity:0` 但仍然占宽度）。代价就是窄面板下的空白。

**改动**：`.dsh-todo-actions` 改成 `display:none`，只在 `:hover` / `:focus-visible` / `:focus-within` 时变 `flex`。不悬停时行尾不占宽度，标题吃满；悬停时按钮进来、标题重新截断一次（这个跳动是取舍，比常驻空白更可接受）。

**验证**：300px 宽的面板渲染对比（不悬停 / 强制显示按钮）确认——不悬停时标题用满整行，悬停时才让位。四套测试通过（冒烟里「每行只有一个操作层」的断言仍然成立）。

**遗留**：悬停瞬间的截断跳动是否可接受，需要你实际用一下；嫌跳就去掉 `focus-within` 之外的过渡（目前没有过渡）。

## 2026-11-22 · 美学：两套外观 + 高级材质 + 琥珀色进行中（M6.12）

**需求**：A（收敛）和 C（纸感）都做成设置项让用户选；高级材质单独开关（省性能）；「进行中」要更醒目（最终选琥珀色，而不是红）。

**改动**
- **刻度统一**（先盘点出来的硬问题：8 种圆角、9 档字号、14 组 padding）：圆角只留 8 / 6 / 3，字号只留 16 / 13.5 / 12.5 / 11 / 10，间距取 4 的倍数；阶段卡片的 1px 边框与硬投影去掉，改成底色 + 极浅渐变 + 柔光。
- **两种外观**（`ui.style`，默认 `paper`）：`paper` 阶段标题带 8% 色相底；`calm` 阶段标题透明、只留发丝线。都在设置页「外观」里选，存进计划文件。
- **高级材质**（`ui.material`，默认开）：卡片顶部 2.5% 纵向渐变 + 1px 内高光 + 分层投影；拖动确认条毛玻璃（`backdrop-filter`）。关掉退化成纯色块。
- **进行中的信号**：不再借用阶段色，统一 `state-warn-primary`（琥珀）——行左侧 3px 竖条、状态圆环、9% 底色、阶段提示条圆点；标题只加粗不改字色。
- 设置页结构：`外观`（两张风格卡）→ `高级材质`（开关行，标签左、开关右）→ `通知方式`（三张卡 + 合并窗口）。
- 顺带修：`normalizePlan` 没读 `ui.notifyWindow`（设置里总显示 8）；`.dsh-todo-switch` 之前只在 composer 的样式表里，设置页的开关是裸按钮（现在抽成 `SWITCH_STYLE` 两边共用）。

**验证**
- 四套测试：plan-store 33（新增外观默认值/非法值/修复用例）、命令、工具、冒烟（外观两张卡 + 材质开关 + `data-style`/`data-material` 落在面板根上）。
- 浅色三组截图对比：`paper` / `calm` / `paper-flat`（材质关），设置页一张；窄宽 300px 一张。README 的截图全部按新外观重出。
- **未验证**：真实页面里的 `backdrop-filter` 观感与滚动性能（无头截图看不出）；深色主题只按 token 推断，没有逐张目检。

**遗留**：`.dsh-todo-focus`（旧顶部提示块）已无引用但样式还在；`row-actions.png` 只在文档里出现，README 未引用。

## 2026-11-22 · 真实主题下重做视觉 + 空阶段文案（M6.12.1）

**反馈**：纸感像纯白、高级材质完全看不出来、进行中不够醒目且和阶段色混在一起、已完成划横线太淡；另外隐藏已完成时，一个全部做完的阶段显示成「这个阶段还没有事项」。

**根因（关键）**：读了 `dsh-client-ui-theme/src/styles/design-platform.css` 才发现，浅色主题里 `--dsw-alias-bg-base`、`bg-layer-1`、`bg-layer-2` **都是同一个 `#ffffff`**。我之前用自己的"近白 / 白"两色做预览，看着有层次，真机上却没有任何底色差 —— 卡片、纸感、材质全是白上白。

**改法**
- 卡片不再依赖底色差：3% `label-primary` 墨色调 + `box-shadow 0 0 0 1px border-l1` 发丝环；材质开启时 6% 顶部渐变 + 10% 内高光 + 两层投影（贴地 + 大范围柔光）。
- 纸感阶段头 8% → **14%** 色相，收敛仍为透明。
- 进行中：底色 9% → **20%**（hover 26%），竖条 3px → **4px**，标题用 `state-warn-label` 上色，圆环保持琥珀。
- 已完成：文字从 tertiary 提到 secondary，删除线改 `currentColor` + 1.5px（子项 1px）。
- 隐藏已完成的空阶段：`view.hide` 进 Stage，`total > 0` 时显示「这个阶段的 N 项都已完成（已隐藏）」，真正空的才说"还没有事项"。
- 预览脚本改用**真实主题 token**（直接从设计平台 CSS 抄的浅色/深色值），以后截图不会再和真机脱节。

**验证**：四套测试（冒烟新增"全部做完的阶段"文案断言）；用真实 token 重出全部截图（浅色/深色/收敛/材质关/设置页/隐藏完成/窄宽）。

**遗留**：深色主题下材质的投影几乎不可见（深底上黑影本就不明显），只靠内高光，实际观感待真机确认。

## 2026-11-22 · 灵动主题 + 动效 + 浅色材质（M6.13）

**反馈**：深色下反而看得到投影和高光，浅色很不明显；浅色整体太灰太克制；要一个鲜艳/灵动的主题；勾选、拖动、折叠要动效。

**改动**
- **新主题 `vivid`**：阶段标题 24% 色相、卡片左侧 4px 导轨、卡片描边用 38% 色相；正文保持白底，避免彩色底把文字压灰（第一版整卡 8% 色相，截图里字全发虚，已改）。
- **浅色材质**：投影从 7%/55%（-18 spread）提到 10%/34%（-12 spread）+ 1px 10%；同一个 `label-primary` 在深色主题是浅色，自然显示成高光。
- **进行中**：底色 20%、hover 26%、4px 竖条、标题 `state-warn-label`。
- **动效**：完成（图标弹 + 成功色淡出）、折叠展开（容器淡入下滑）、拖动（40% 透明 + 过渡）；`@media (prefers-reduced-motion: no-preference)` 全包。
- **预览脚本**：加 `*{animation:none}` 覆写，截图不再拍到动画中间帧（之前整屏发白就是这个原因）。

**验证**：四套测试通过（plan-store 33，含 vivid 用例；冒烟改成三种外观 + 材质开关）；重出浅色/深色/灵动/收敛/设置页截图。

## 2026-11-22 · 灵动设为默认 + 折叠双向动画 + 更强的勾选（M6.14）

**反馈**：默认主题用灵动；大块（阶段）的收起/展开没有效果；勾选完成的动效要更强。

**改动**
- 默认外观 `paper` → **`vivid`**：宿主 `validatePlan` / `repairPlan` / `emptyPlan` 与客户端 `normalizePlan`、两个 `data-style` 兜底、设置页的选中态都改了。
- 折叠：内容不再卸载，改为 `grid-template-rows: 0fr ↔ 1fr`（内容 `overflow:hidden;min-height:0`），阶段与子项列表**双向** 0.24s 高度动画；收起时给容器 `inert`，Tab 不会进入隐藏行。做法取自 CSS-Tricks 的 auto-height 手风琴与 ariakit 的 animated disclosure。
- 勾选：圆环 `scale(.4)→1.1→1` 弹出 → 勾线 `stroke-dashoffset 12→0`（延迟 110ms）→ 外圈 1.5px 成功色 ping；行内成功色从 26% 提到 38%、0.6s 延到 0.75s。配方参考 transitions-dev 的 checkbox-check（先填底、再画勾）。
- 测试：`folded` 的断言从"子节点不存在"改成"容器 `data-open` 不存在"（节点现在保留），plan-store 的默认值断言改成 `vivid`。

**验证**：四套测试通过；重出灵动截图确认新容器没有布局回归。
**未验证**：动画观感只能在真机看；`inert` 在旧 WebView 不生效时，隐藏行仍可能被 Tab 到（Chromium 现代版本均支持）。

## 2026-11-22 · 勾选动效不再重播（M6.14.1）

**反馈**：换序、进出设置页时，已完成的勾选动效会再播一遍。

**原因**：动画挂的是"节点挂载"——换序时 React 重建了行、设置页回来时整棵树重挂载，`.dsh-todo-dot-icon` 的 animation 就跟着重跑。

**改法**：动画改由状态比对驱动。`TodoBody` 用 `useRef` 存上一份 `id → status`，每次 plan 变化后比较；只有"之前不是 completed、现在是 completed"的 id 会进入 `flashIds`，900ms 后清空。行上渲染 `data-flash="done"`，所有动画规则收进 `.dsh-todo-row[data-flash="done"] ...`，不再是全局 `animation`。

**验证**：冒烟新增两条断言——普通渲染 `data-flash` 数量为 0；传入 `flashIds: ['b']` 时只有 `b` 这一行带 `data-flash`。四套测试通过。

## 2026-11-22 · 删除线绘制 + 删除动效（M6.15）

**反馈**：完成除了对号，删除线也要动效；删除也要动效。

**改动**
- 删除线：标题改成 `display:inline-block;max-width:100%`（宽度贴合文字，线不会跑到行尾），删除线不再用 `text-decoration`（不可动画），改成 `background-image: linear-gradient(...)` + `background-size` 从 `0%`→`100%` 画出；厚度用 `--dsh-todo-strike-h` 变量区分（条目 2px、子项 1px），颜色改用 `label-primary`（原来 `currentColor` 太淡）。
- 删除：`confirmDelete` 先 `setRemoving(id)`，行/块带 `data-removing="1"`，0.26s 左移淡出并收 `max-height:0`；写盘成功/失败后清标记（失败时行还在，不会凭空消失）。
- 排查过程：先在整页截图里以为线没画出来，1:1 裁剪后确认其实存在，只是 1.5px + `currentColor` 在面板缩放下看不见——所以这次把厚度和颜色都提上去了。
- 预览脚本加了 `*{animation:none!important}`，截图看到的是动画结束态。

**验证**：四套测试通过（冒烟新增 `data-removing` 断言：只有被删那一行带标记）；`docs/images/strike-closeup.png` 是 1:1 裁剪，能看到线贴着文字。
**未验证**：删除动画与文件监听的先后（写盘很快时动画可能被截断一半，只能真机看观感）。

## 2026-11-22 · 发布准备 v0.1.0

**这一轮**：把前面 15 个里程碑的文档收口，准备推到 GitHub。

**改动**
- `package.json` 版本 `0.0.1` → **`0.1.0`**。
- `CHANGELOG.md`：标题改成 `[0.1.0] - 2026-11-22`，加"这一版的重点"；删掉被后续推翻的旧条目（26% 成功色、3px 竖条、1.5px 删除线、纸感为默认），避免读者看到互相矛盾的描述。
- `README.md` / `README.en.md`：主图换成灵动；新增"三种外观""动效"两条能力说明与两张图（设置页、删除线特写）；进行中改成 4px/20% 的当前数值。
- `docs/USAGE.md`：外观段补灵动；新增「动效」表（勾选/折叠/拖动/删除 + 只在真实状态变化时播放 + reduced-motion）。
- `docs/FAQ.md`：新增 4 条——面板看着很平、动效没有、文件写着 paper 所以还是纸感、保存位置。
- `docs/ARCHITECTURE.md`：新增「外观与动效怎么落地」，写清 `data-style`/`data-material`、`flashIds` 比对、`0fr/1fr` 折叠、`data-removing`。
- `docs/COMPAT.md`：测试例数 32 → 33，补插件版本行；`docs/INSTALL.md` 回滚示例改成 `v0.1.0`。
- `SPEC.md`：`ui.style` 枚举补 `vivid`，默认值改成 `vivid`。
- `DECISIONS.md`：新增 ADR-0015…0018（默认灵动、动效按状态变化、折叠用 grid、删除线用 background-size）。

**自检**
- 四套测试全绿（plan-store 33 / command / tool / smoke）。
- 文档内 16 处图片引用全部存在（脚本核对），无绝对路径。
- 没验证到的：GitHub 上渲染效果（相对路径在网页里的行为）、英文版的措辞是否地道。

## 2026-11-22 · 拖动排序 FLIP + 已知限制补 Linux/macOS（M6.16）

**反馈**：拖动排序没有 FLIP 动画，要做完；Linux/macOS 未实测这一条写进「已知限制」。

**改动**
- `useRowFlip(rootRef)`：`useLayoutEffect` 里用 `querySelectorAll('[data-item]')` 量每行的 `getBoundingClientRect().top`，与上一帧比较；差值 ≥1px 且不是首帧、不是 `prefers-reduced-motion` 时，先把 `translateY(差值)` 写进内联样式（并 `void offsetHeight` 强制生效），下一帧改成 `transition: transform .22s` + 清空 `transform`，让行自己「走」回去。
- 因为按 `data-item` 全局查询，跨阶段移动也能动画（行在新阶段里重新出现时，位置差照样被抵消）。
- 面板根节点挂 `ref`；设置页不参与（它不渲染行）。
- 冒烟测试的假 React 补了 `useLayoutEffect` 空实现。

**验证**：`node --check`、四套测试全绿。**未验证**：真机观感（无头截图看不到过渡过程），以及快速连续拖动时会不会与上一段过渡打架。

## 2026-11-22 · 去掉行为准则（发布收尾）

**判断**：`CODE_OF_CONDUCT.md` 对个人插件是纯仪式感——不是许可、不是硬性要求，也没有被任何文档引用；GitHub 只是把它当"社区文件"展示。删掉后 Community Standards 会提示未配置，不影响 issue/PR/Release。
**动作**：删除该文件；README/CONTRIBUTING 本来就没链接它，无需改引用。

## 2026-11-22 · 安全、核心缺陷、并发与文档交叉验证修复

**目标**：核验并补全 S1、F1–F10、C1–C10、D1–D4 修复，同时消除交叉验证中发现的并发版本检查回退（C6）、`add`/`move`/`reorderGroups` 序号重号（F8）与工具参数/面板输入/FLIP/文档同步问题。

**改动**
- `host/plan.js`：`applyOp` 新增 `renumberStage`，`add` / `move`（含跨阶段源与目标）与 `reorderGroups` 统一保持唯一连续 `1..N` 序号；`readPlanFile`（最多 2 次读）与 `repairPlanFile` 改为读前读后双 `stat`，不一致时用 `'stale'` 哨兵阻断 `writePlanFile` 盲覆，保留不汇报 `stat` 后端的 `undefined` 语义。
- `index.js`：收紧 `checkArgs` 仅对 `groupId`/`due`/`note` 及 `next`/`addGroup` 的 `id` 放行 `null`，避免 `status`/`rename`/`remove`/`move` 等误传 `id: null` 绕过参数类型报错；参数描述补充 `"" / null`。
- `client.js`：`SettingsScreen` 增加 `lastCommittedRef` 防止 `Enter` 后紧接着 `onBlur` 重复提交相同的 `notifyWindow`；`useRowFlip` 引入 `layoutKey`（页面/隐藏已完成/阶段与子项折叠），仅布局变化时刷新行坐标而不误播 FLIP 动画。
- 文档与测试：同步 `README.en.md`（修断行）、`SPEC.md`（`planCwd` + `realpath` 边界、`groupId` 未分组规则、工具表）、`CHANGELOG.md`、`DEVLOG.md`；在 `tools/plan-store-test.mjs`、`tools/command-test.mjs`、`tools/tool-test.mjs` 中补齐对应单测。

**验证**
- `node --check index.js`、`node --check host/plan.js`、`node --check client.js` 通过。
- `npm test` 四套测试全绿（`plan-store tests: 35 passed`、`command tests`、`session switch test`、`tool tests`、`skill test`、`client smoke check`）。
- `npm pack --dry-run` 包含 `assets/icon-180.png`、`host/plan.js`、`index.js`、`client.js`（共 33 个文件）。

**待真机确认**：DSH Desktop 真机环境下 `planCwd` 在 `/todo` 命令层的实际工作区解析、F3 合并窗口输入 `30`、F4/F5/F9 跨阶段与未分组拖拽手感及插入线、F7 连点队列、D2 `48px` 子项缩进（如需附新截图可重出 `docs/images/`）、C2/C7 通知取消与停用清理。

## 2026-11-22 · 0.1.1：新增 Material Design 3 主题与复验遗留项收口

**目标**：按复验报告收口遗留问题（`command-test` 联接清理 `ENOTEMPTY`、`24px` 抓手、独立 `.dsh-todo-insert` 行级插入条、版本升至 `0.1.1`），并新增 Google Material Design 3（`md3`）主题。

**改动**
- `tools/command-test.mjs`：先删工作区内 `escape` 目录联接再删 `outsideDir`，并为 `rm` 增加 `maxRetries: 3, retryDelay: 50`，消除 Windows 悬空联接导致的 `ENOTEMPTY`。
- `client.js`：抓手与首列宽从 `20px` 提至 `24px`；移除行级 `inset box-shadow`，改为在 `ItemRow` 渲染绝对定位的 `.dsh-todo-insert[data-pos="before|after"]` 浮层条（零布局位移）；新增 `md3`（Material Design 3）主题样式、中英文文案、设置页卡片与 `normalizePlan` 支持。
- `host/plan.js`、`index.js`、`package.json`、`SPEC.md`、`DESIGN.md`、`docs/AGENT.md`、`docs/COMPAT.md`、`CHANGELOG.md`：`STYLES` 与工具 `style` 枚举补充 `'md3'`，版本升为 `0.1.1`。
- `tools/plan-store-test.mjs`、`tools/tool-test.mjs`、`tools/smoke-client.mjs`：补充 `md3` 主题与行级 `.dsh-todo-insert` 渲染断言。

**验证**：见本轮 `node --check` 与 `npm test` 输出；真机仍待用户在 DSH 中切换 `Material Design` 主题及试拖确认。

## 2026-11-24 · 合并 PR #1（v0.1.1）+ review 补充

**PR #1**（Echora，`feat/v0.1.1-md3`）：安全加固（basename / planCwd fail-closed / realpath）、工具补齐（addGroup、note、reorderGroups、add 的 groupId/order/after/due/note、style 枚举修正）、repair 不再静默丢字段、读写前后双 stat + stale 哨兵、客户端写队列与合并窗口输入框修复、跨阶段拖拽预览、MD3 外观。

**合并方式**：squash 成 `ef2ce10`（作者保留 Echora）——本来也只有 1 个提交。

**我补的两处**：`cancelPendingForSession` 改成按 Session id 命中（原来拿 id 比对象，永远不中）；`useRowFlip` 的 `orderKey` 去掉 `pendingMove.ids`（确认后原本会播两段 FLIP）。另在 `DESIGN.md` 记下 md3 固定强调紫的例外，README/USAGE 补第四档外观与截图。

**验证**：合并前在独立 worktree 跑过他的分支（35/35）；合并后在本机跑四套全绿；试合并无冲突；md3 深浅两版截图都看过。

## 2026-11-24 · 介绍口径：白板而不是任务管理器

**反馈**：相关介绍（包括 GitHub 上的）应该强调这个面板更像是给 agent 和用户共用的一块记事板/白板，用来提醒双方当前处在哪个阶段。

**改动**：README 中英首段各加一段定位说明；`docs/USAGE.md` 开头加一句；`docs/AGENT.md` 新增「先记住它是什么」——明确"看到未完成事项不等于要现在做"；`package.json` 的 description 与 GitHub 仓库描述一并改成 shared plan board 口径。

**注意**：`docs/AGENT.md` 是注册成技能 `dsh-todo-plan` 的运行时文档，**改完要重启 DSH** 才会进入助手的技能内容。
