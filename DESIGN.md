# 视觉语言

面板的样式参考 [op7418/dsh-guizang-design](https://github.com/op7418/dsh-guizang-design) 的排版规则（瑞士风 + 杂志风的公共部分），只取适合"产品内的工具面板"的那几条。

## 采用的规则

| 规则 | 在面板里的做法 |
|---|---|
| 一个强调色 | 只有「进行中」的环和聚焦描边用 `--dsw-alias-brand-primary`；完成用 success，逾期用 error，其余全是灰阶 |
| section 之间不加线，靠间距呼吸 | 阶段之间 26px 留白，不画分隔线；全面板只有页头下一条 1px 发丝线 |
| 字体三级 | 标题 15/600；条目标题 13/400（进行中 500）；元信息 10–11/400 |
| 元信息用等宽 + 表格数字 | 进度 `01/02`、阶段计数、日期、页脚路径与 `rev` 都用 mono + `tabular-nums` |
| 卡片靠底色而不是边框 | 日期是浅底色块，不是描边胶囊；行 hover 用主题 hover 底色 |
| 微圆角 | 3px（按钮、输入框、行）；不用大圆角卡片 |
| 中文不斜体、不加字距 | 字距只在阶段标签上加 `.07em`（英文大写缩写的观感），正文为 0 |
| 不用装饰性元素 | 阶段编号 `01` 是唯一的"版式装饰"，颜色压到 30% 不抢内容 |

## 没有照搬的

- 正文 17px、行长 36em —— 那是阅读页的规格，右栏面板需要更高密度，这里是 13px。
- 报头、花饰、章节大号数字、图片 hero —— 工具面板不需要。
- 深色/浅色由宿主主题决定，面板不写死色值，也不自带主题切换。

## 用户反馈后的两处偏离（2026-11-21）

- **每个阶段一个色相**：阶段按位置取一个固定色相（212 蓝 / 265 紫 / 330 粉 / 24 橙 / 152 青 / 46 琥珀），用于左侧 3px 竖条、编号、标题栏 8% 底色和进行中行的底色。色相不是直接用 `hsl()`，而是 `color-mix(hsl(h 68% 48%) 72%, label-primary)`：浅色主题下混合深色文字、深色主题下混合浅色文字，两种主题都有对比度。
- **可读性**：条目标题 13.5px、子项 12.5px、元信息 11px；能见文字从 `tertiary` 提到 `secondary`；去掉原来靠 `opacity` 压暗的写法。
- **层次**：标题 16/650，阶段标题 12/650 并改用 `label-primary`，阶段头有底色和左边条，和外层灰阶内容拉开。

## 密度与界限（2026-11-21 第二次反馈后）

- 阶段间距 26 → 18px，行内边距 5px，整体行高 1.55；右栏是工具面板，不是阅读页。
- 列表内部允许 1px 行分隔线（原规则只禁"section 之间"的线）。

## 颜色来源

全部来自宿主 token（`--dsw-alias-*`）：`bg-base`、`bg-layer-1/2`、`label-primary/secondary/tertiary`、`border-l1/l2/l3`、`interactive-bg-hover`、`brand-primary`、`state-success/warn/error-*`。凡是 token 改名，外观会退化但不会崩。

## 刻度（2026-11-22 统一）

之前是"每处单独合理、整体略散"（8 种圆角、9 档字号）。现在收紧成三套刻度，新样式只能从这里取：

| 刻度 | 取值 | 用在哪 |
|---|---|---|
| 圆角 | **8** 卡片/浮条 · **6** 按钮/输入/标签 · **3** 链接 / 抓手 · 50% 圆点 | — |
| 字号 | **16** 面板标题 · **13.5** 条目 · **12.5** 子项/阶段标题 · **11** 按钮/元信息 · **10** 编号/极小标签 | 只允许这五档 |
| 间距 | 4 的倍数（4/8/12/16） | padding / margin |
| 阴影 | 只有两处：卡片（材质开启时）与拖动确认条；其余一律不用 | — |

## 四种外观（设置页可选，存 `ui.style`）

| | `paper` | `calm` | `vivid`（灵动，默认） | `md3`（Material Design 3） |
|---|---|---|---|---|
| 阶段标题底 | 阶段色相 14% | 透明 | 阶段色相 24% | 阶段色相 16% + 胶囊计数/编号 |
| 卡片 | 墨色 3% + 发丝环 | 同左 | 白底 + 色相 38% 描边 | `16px` 大圆角色调容器 + 柔光投影 |
| 左侧导轨 | 无 | 无 | 4px 阶段色相 | 进行中行带 `4px` 胶囊竖条 |
| 气质 | 有纸的层次 | 只靠发丝线 | 彩色、有活力 | M3 Tonal Surface、胶囊按钮与圆角行状态层 |

## 动效（2026-11-22，第二轮）

全部在 `prefers-reduced-motion: reduce` 下关闭：

1. **勾选完成**：圆环先 `scale(.4)→1.1→1` 弹出，勾线再用 `stroke-dashoffset 12→0` 画出来（延迟 110ms），同时外圈扩散一个 1.5px 成功色 ping；行上叠一层 38% 成功色，0.75 秒淡出（`z-index:-1` + 行 `isolation:isolate`，不盖文字）。勾完的图标按 status 加 key，每次状态变化都会重挂载，动画必然重放。删除线也一起「画」：标题是 `inline-block`（宽度贴合文字），删除线用 `background-size` 从 0% 长到 100%（2px，子项 1px），所以是一笔划过去，而不是瞬间出现。
2. **折叠/展开**：阶段与子项内容不再卸载，而是放进 `grid-template-rows: 0fr ↔ 1fr` 的容器（内容 `overflow:hidden;min-height:0`），收起和展开**双向**都有 0.24s 高度动画；收起时给容器 `inert`，键盘不会聚焦到看不见的行。
3. **拖动**：被拖的行降到 40% 透明并轻微缩小；落位后其它行做 **FLIP**——渲染后量一次每行的 	op，与上一帧比，先把位置差用 	ranslateY 抵回去，再在 0.22s 内回到 0，所以重排是「让位」而不是「跳过去」。跨阶段移动也在内（按 data-item 找行，不局限于一个阶段）。
4. **删除**：确认删除时该行立刻带 `data-removing`，0.26s 内左移、淡出并把 `max-height` 收到 0；等文件落盘后节点才真正消失（写失败则 400ms 后清标记，行留下）。

做法参考：`grid-template-rows` 折叠是 CSS-Tricks 的 auto-height 手风琴（[CSS Grid Can Do Auto Height Transitions](https://css-tricks.com/css-grid-can-do-auto-height-transitions/)）与 [ariakit 的 animated disclosure](https://github.com/ariakit/ariakit/blob/9ac234b3290c4204889dba0acea25a6505811159/examples/disclosure-animated/readme.md)；勾选用的是「底色先填、勾线随后 draw」的配方（[transitions-dev 的 checkbox check](https://github.com/skillmds/skillmd/blob/0bcefc62f7295a9cad8220dfd8701c4415904c95/plugins/docs-writing/skills/transitions-dev/25-checkbox-check.md)）。

## 高级材质（`ui.material`，默认开）

关掉只留纯色块，为性能让路。开启时是三件事：

1. 卡片**极浅纵向渐变**（顶部 2.5% `label-primary` 混底）+ **内高光** 1px；
2. **分层投影**：1px 贴地 + 一层大范围柔光（负 spread，不糊边）；
3. 拖动确认条用**毛玻璃**（`backdrop-filter: blur(10px) saturate(1.4)` + 半透明底）。

## 「进行中」的信号（2026-11-22 改）

阶段色相只负责**阶段标识**。进行中不再借用阶段色，统一用 **`state-warn-primary`（琥珀）**：行左侧 3px 竖条、状态圆环、行底色 9%、阶段提示条的小圆点；标题加粗但不改字色——红色/琥珀都够醒目，改字色会吵。

## 例外：md3 的固定强调紫（2026-11-24，接受）

`md3` 外观为了做出 Material 3 的色调体系，写死了两个颜色：`hsl(265 …)` 作为强调紫（计数胶囊、按钮、选中项）以及胶囊文字的 `#ffffff`。这与"只用 `--dsw-alias-*` token"的约定相冲突，属于**有意接受的例外**，理由与限制：

- 阶段本身已经用 `hsl(var(--dsh-todo-hue))` 做色相标识，md3 的强调紫与之同属"界面语义色"，不是随主题浮动的装饰；
- 深色主题下这个紫会被 `color-mix` 与 `bg-base` 混合，实测对比度正常；但如果以后 DSH 换了默认强调色，md3 不会跟着变；
- 其他三档外观仍然严格只用 token。想彻底消除例外时，把两处 `hsl(265 …)` 换成 `color-mix(brand-primary …)` 即可。
