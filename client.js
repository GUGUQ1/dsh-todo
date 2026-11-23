/**
 * Browser half of the dsh-todo bundle.
 *
 * Registers the right-Sidebar tab type `todo` and its body, plus a temporary
 * composer chip that opens the tab. The body reads `<workspace>/todolist.json`
 * through the Host's read-only workspace-file Remote, follows it with a change
 * watch, and writes through one Host command (`/todo op <json>`) so both the
 * panel and (next milestone) the model share a single write path.
 *
 * The visual language follows the editorial/Swiss rules the design skill sets
 * out: one accent, no borders between sections, spacing instead of rules, three
 * type tiers with tabular monospace for meta, and no decorative colour.
 */
window.__ModuleLoader__.load({
  id: 'dsh-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Copy namespace of this plugin. */
    const NS = 'todoPanel'
    /** The tab kind this plugin owns; it is also what `openTab` names. */
    const KIND = 'todo'
    /** This implementation's identity in the tab system, and the body's slot key. */
    const ID = 'dsh-todo'
    /** The plan file, relative to the session's workspace root. */
    const PLAN_FILE = 'todolist.json'
    /** A change event rarely arrives alone; coalesce bursts before re-reading. */
    const REFRESH_DELAY_MS = 150

    const zh = {
      'type.label': '计划',
      'guide.title': '项目计划',
      'guide.description': '按阶段跟踪待办、先后依赖与截止日期',
      'chip.open': '计划',
      'chip.hint': '打开项目计划面板',
      'chip.switchAria': '本会话是否使用项目计划面板',
      'chip.on': '本会话已启用计划面板（点开关停用）',
      'chip.off': '本会话未启用计划面板（点开关启用）',
      'panel.offline': '本会话没有启用计划面板：助手读不到这份计划，也改不了它；这里的改动同样不会通知它。在输入框上方的「计划」开关里打开即可。',
      'panel.title': '项目计划',
      'panel.untitled': '未命名计划',
      'panel.done': '完成',
      'panel.loading': '正在读取计划…',
      'panel.stage': '阶段',
      'panel.file': '文件',
      'panel.hideCompleted': '隐藏已完成',
      'panel.showCompleted': '显示已完成',
      'panel.addItem': '添加事项',
      'panel.addChild': '添加子项',
      'panel.addStage': '添加阶段',
      'panel.create': '创建计划',
      'panel.creating': '正在创建…',
      'panel.emptyStage': '这个阶段还没有事项',
      'panel.stageDone': '这个阶段的 {n} 项都已完成（已隐藏）',
      'panel.delete': '删除',
      'panel.confirm': '删除',
      'panel.confirmMove': '确认',
      'panel.cancelMove': '取消',
      'panel.cancel': '取消',
      'panel.up': '上移',
      'panel.down': '下移',
      'panel.setDue': '设截止日期',
      'panel.clearDue': '清除截止日期',
      'panel.name': '事项名称',
      'panel.inProgress': '进行中',
      'panel.markDone': '标记为完成',
      'panel.markPending': '标记为未完成',
      'panel.next': '下一步',
      'panel.none': '—',
      'panel.settings': '设置',
      'panel.back': '返回计划',
      'panel.notify': '通知方式',
      'panel.appearance': '外观',
      'panel.style.paper': '纸感',
      'panel.style.paper.desc': '阶段标题带一层淡色相底，卡片有纸的层次（渐变、柔光）。',
      'panel.style.calm': '收敛',
      'panel.style.calm.desc': '阶段标题不染色，只留一条发丝线；最干净的一种。',
      'panel.style.vivid': '灵动',
      'panel.style.vivid.desc': '阶段色更饱满，卡片左侧一条彩色导轨，进行中更抢眼，配轻微动效。',
      'panel.style.md3': 'Material Design',
      'panel.style.md3.desc': '',
      'panel.material': '高级材质',
      'panel.material.desc': '渐变、分层投影、毛玻璃与内高光。关掉只有纯色块，最省性能。',
      'panel.notify.nextTurn': '下一轮携带',
      'panel.notify.nextTurn.desc': '不打断你，我下一轮说话时才看到这次改动。',
      'panel.notify.wake': '立即通知',
      'panel.notify.wake.desc': '马上唤醒我一轮来同步（会消耗 token，不建议连续点击时用）。',
      'panel.notify.off': '不通知',
      'panel.notify.off.desc': '面板照常保存，只是不告诉我。',
      'panel.notify.hint': '这里改的是「面板里的改动怎么告诉助手」，保存在计划文件的 ui.notify 里。',
      'panel.notifyWindow': '合并窗口',
      'panel.seconds': '秒',
      'panel.notifyWindow.desc': '窗口内的连续改动会合成一条通知，减少对话里的记录条数。',
      'panel.moveAsk': '顺序已调整，确认保存？（6 秒后自动撤回）',
      'panel.dragHint': '拖动调整顺序',
      'panel.foldChildren': '折叠子项',
      'panel.unfoldChildren': '展开子项',
      'move.group': '把阶段「{title}」移到第 {at} 位',
      'move.after': '把「{a}」移到「{b}」之后',
      'move.before': '把「{a}」移到「{b}」之前',
      'move.last': '把「{a}」移到这一段的末尾',
      'move.intoStage': '，并放进阶段「{stage}」',
      'problem.broken': '计划文件有问题，改动会被拒绝',
      'problem.repair': '移除坏项',
      'mode.sequence': '依次',
      'mode.parallel': '并行',
      'mode.free': '无顺序',
      'status.pending': '待办',
      'status.inProgress': '进行中',
      'status.completed': '已完成',
      'due.today': '今天',
      'due.overdue': '逾期',
      'blocked': '待前序',
      'empty.title': '还没有计划',
      'empty.body': '在对话里说「给我建一个计划」，或者自己在这个工作区里创建 todolist.json。',
      'error.title': '计划文件读不出来',
      'error.invalid': '文件内容不符合格式',
      'error.save': '没有保存成功',
      'noWorkspace': '这个标签页没有关联的会话，读不到工作区文件。',
    }

    const en = {
      'type.label': 'Plan',
      'guide.title': 'Project plan',
      'guide.description': 'Track todos, dependencies and due dates by stage',
      'chip.open': 'Plan',
      'chip.hint': 'Open the project plan panel',
      'chip.switchAria': 'Whether this conversation uses the project plan panel',
      'chip.on': 'The plan panel is on for this conversation (click to switch off)',
      'chip.off': 'The plan panel is off for this conversation (click to switch on)',
      'panel.offline': 'The plan panel is off for this conversation: the agent cannot read or change this plan, and edits here are not reported to it. Switch it on in the Plan toggle above the composer.',
      'panel.title': 'Project plan',
      'panel.untitled': 'Untitled plan',
      'panel.done': 'Done',
      'panel.loading': 'Reading the plan…',
      'panel.stage': 'Stage',
      'panel.file': 'File',
      'panel.hideCompleted': 'Hide completed',
      'panel.showCompleted': 'Show completed',
      'panel.addItem': 'Add item',
      'panel.addChild': 'Add child',
      'panel.addStage': 'Add stage',
      'panel.create': 'Create plan',
      'panel.creating': 'Creating…',
      'panel.emptyStage': 'This stage has no items yet',
      'panel.stageDone': 'All {n} items in this stage are done (hidden)',
      'panel.delete': 'Delete',
      'panel.confirm': 'Delete',
      'panel.confirmMove': 'Keep',
      'panel.cancelMove': 'Cancel',
      'panel.cancel': 'Cancel',
      'panel.up': 'Move up',
      'panel.down': 'Move down',
      'panel.setDue': 'Set a due date',
      'panel.clearDue': 'Clear the due date',
      'panel.name': 'Item name',
      'panel.inProgress': 'In progress',
      'panel.markDone': 'Mark as done',
      'panel.markPending': 'Mark as not done',
      'panel.next': 'Next',
      'panel.none': '—',
      'panel.settings': 'Settings',
      'panel.back': 'Back to plan',
      'panel.notify': 'How to tell the agent',
      'panel.appearance': 'Appearance',
      'panel.style.paper': 'Paper',
      'panel.style.paper.desc': 'Stage headers carry their hue; cards get a subtle paper grain of gradient and light.',
      'panel.style.calm': 'Calm',
      'panel.style.calm.desc': 'Stage headers stay plain with one hairline; the quietest look.',
      'panel.style.vivid': 'Vivid',
      'panel.style.vivid.desc': 'Fuller stage colours, a coloured rail down each card, a louder active row, plus small motion.',
      'panel.style.md3': 'Material Design',
      'panel.style.md3.desc': '',
      'panel.material': 'Advanced materials',
      'panel.material.desc': 'Gradients, layered shadows, frosted glass and an inner highlight. Off is flat and cheapest to render.',
      'panel.notify.nextTurn': 'Next turn',
      'panel.notify.nextTurn.desc': 'No interruption; I see the change on my next turn.',
      'panel.notify.wake': 'Wake me now',
      'panel.notify.wake.desc': 'Wake the agent for one turn right away (costs tokens; poor fit for rapid clicks).',
      'panel.notify.off': 'Do not notify',
      'panel.notify.off.desc': 'The panel still saves; the agent is simply not told.',
      'panel.notify.hint': 'This setting decides how panel edits reach the agent; it lives in the plan file as ui.notify.',
      'panel.notifyWindow': 'Merge window',
      'panel.seconds': 's',
      'panel.notifyWindow.desc': 'Edits inside the window merge into one notice, so the transcript keeps fewer rows.',
      'panel.moveAsk': 'Order changed — keep it? (reverts in 6s)',
      'panel.dragHint': 'Drag to reorder',
      'panel.foldChildren': 'Fold children',
      'panel.unfoldChildren': 'Unfold children',
      'move.group': 'Move stage "{title}" to position {at}',
      'move.after': 'Move "{a}" after "{b}"',
      'move.before': 'Move "{a}" before "{b}"',
      'move.last': 'Move "{a}" to the end of its stage',
      'move.intoStage': ', into stage "{stage}"',
      'problem.broken': 'The plan file has problems, so edits are refused',
      'problem.repair': 'Drop the broken rows',
      'mode.sequence': 'In order',
      'mode.parallel': 'Parallel',
      'mode.free': 'Unordered',
      'status.pending': 'Pending',
      'status.inProgress': 'In progress',
      'status.completed': 'Completed',
      'due.today': 'Today',
      'due.overdue': 'Overdue',
      'blocked': 'Waiting on earlier items',
      'empty.title': 'No plan yet',
      'empty.body': 'Ask in the conversation to create one, or add todolist.json to this workspace.',
      'error.title': 'The plan file cannot be read',
      'error.invalid': 'The file does not match the format',
      'error.save': 'Not saved',
      'noWorkspace': 'This tab has no Session, so workspace files cannot be read.',
    }

    /** Statuses the panel renders; anything else falls back to `pending`. */
    const STATUSES = ['pending', 'in_progress', 'completed']

    /** Group modes, in the same order the Host accepts them. */
    const MODES = ['sequence', 'parallel', 'free']

    /** Keys the Host accepts at each level; a stray one blocks every write. */
    const TOP_KEYS = ['version', 'rev', 'title', 'ui', 'groups', 'items']
    const GROUP_KEYS = ['id', 'title', 'mode', 'order']
    const ITEM_KEYS = ['id', 'groupId', 'order', 'title', 'status', 'after', 'due', 'note', 'children']
    const CHILD_KEYS = ['id', 'title', 'status']

    /** Where folded-child ids are remembered, keyed by plan file. */
    const FOLD_PREFIX = 'dsh-todo:fold:'

    /** The switch control, shared by the composer chip and the settings page. */
    const SWITCH_STYLE = `
.dsh-todo-switch{position:relative;width:28px;height:16px;padding:0;border-radius:8px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);transition:background .12s ease}
.dsh-todo-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-todo-switch-knob{position:absolute;top:1px;left:1px;width:12px;height:12px;border-radius:50%;
  background:var(--dsw-alias-label-secondary);transition:transform .12s ease,background .12s ease}
.dsh-todo-switch[aria-checked="true"] .dsh-todo-switch-knob{transform:translateX(12px);
  background:var(--dsw-alias-label-primary-inverted)}
`

    /** One stylesheet for the panel: stage cards, one hue per stage, legible type. */
    const STYLE = `
.dsh-todo{height:100%;overflow:auto;padding:12px 10px 16px;box-sizing:border-box;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font-size:13.5px;line-height:1.55;-webkit-font-smoothing:antialiased}
.dsh-todo *{box-sizing:border-box}
.dsh-todo-mono{font-family:ui-monospace,'SF Mono',SFMono-Regular,'Cascadia Mono',Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums}
.dsh-todo-head{display:flex;align-items:baseline;gap:10px;padding:0 4px 10px}
.dsh-todo-title{font-size:16px;font-weight:650;line-height:1.3;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-todo-count{margin-left:auto;font-size:11px;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);
  white-space:nowrap}
.dsh-todo-stage{position:relative;margin-top:12px;border-radius:8px;overflow:hidden;
  /* The shipped theme gives bg-base and bg-layer-1 the same colour, so a card
     cannot lean on that difference: it carries its own tint and a hairline ring. */
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--dsw-alias-bg-base));
  box-shadow:0 0 0 1px var(--dsw-alias-border-l1);
  --dsh-todo-accent:color-mix(in srgb,
  hsl(var(--dsh-todo-hue,212) 68% 48%) 72%,var(--dsw-alias-label-primary))}
.dsh-todo-stage:first-of-type{margin-top:8px}
/* paper: the stage label carries the stage hue; calm: it is plain ink on a hairline. */
[data-style="paper"] .dsh-todo-stage-head{background:color-mix(in srgb,var(--dsh-todo-accent) 14%,transparent)}
[data-style="calm"] .dsh-todo-stage-head{background:transparent}
/* material: a sheet of paper, not a flat block. label-primary is dark in the
   light theme and light in the dark one, so the same rules give a shadow in one
   and a glow in the other — which is exactly what each theme can show. */
[data-material="on"] .dsh-todo-stage{
  background-image:linear-gradient(180deg,
    color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent) 0%,
    transparent 58%);
  box-shadow:0 0 0 1px var(--dsw-alias-border-l2),
    inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent),
    0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent),
    0 12px 26px -12px color-mix(in srgb,var(--dsw-alias-label-primary) 34%,transparent)}
/* vivid: the hue owns the header, the rail and the ring — the body stays on the
   page colour so text keeps full contrast on a colourful card. */
[data-style="vivid"] .dsh-todo-stage{
  background:var(--dsw-alias-bg-base);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-todo-accent) 38%,transparent)}
[data-style="vivid"] .dsh-todo-stage::before{content:'';position:absolute;left:0;top:0;bottom:0;
  width:4px;background:var(--dsh-todo-accent);z-index:1}
[data-style="vivid"] .dsh-todo-stage-head{background:color-mix(in srgb,var(--dsh-todo-accent) 24%,transparent)}
[data-style="vivid"] .dsh-todo-index{font-size:11.5px;font-weight:700}
[data-style="vivid"] .dsh-todo-stage-count{font-weight:600}
[data-style="vivid"] .dsh-todo-stage-focus{background:color-mix(in srgb,var(--dsh-todo-accent) 10%,transparent)}
.dsh-todo-stage-head{display:flex;align-items:center;gap:7px;width:100%;padding:8px 10px;
  border:0;border-bottom:1px solid var(--dsw-alias-border-l1);
  font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.dsh-todo-chevron{display:inline-flex;color:var(--dsw-alias-label-secondary);opacity:.8}
.dsh-todo-index{font-size:10.5px;font-weight:600;color:var(--dsh-todo-accent)}
.dsh-todo-kicker{font-size:12px;font-weight:650;letter-spacing:.04em;line-height:1.45;
  color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-todo-mode{font-size:10px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-todo-stage-count{margin-left:auto;font-size:10.5px;font-weight:500;
  color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-todo-stage-head[data-state="done"] .dsh-todo-stage-count{color:var(--dsw-alias-state-success-primary)}
.dsh-todo-item-block+.dsh-todo-item-block{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-todo-row{position:relative;display:grid;grid-template-columns:24px 16px minmax(0,1fr) auto;gap:8px;
  align-items:start;padding:7px 10px;outline:none;isolation:isolate}
.dsh-todo-row[data-child]{grid-template-columns:16px minmax(0,1fr) auto;padding-left:48px}
.dsh-todo-grip{display:flex;align-items:center;justify-content:center;width:24px;height:22px;
  color:var(--dsw-alias-label-tertiary);opacity:.3;cursor:grab;border-radius:3px}
.dsh-todo-grip:active{cursor:grabbing}
.dsh-todo-row:hover .dsh-todo-grip,.dsh-todo-row:focus-visible .dsh-todo-grip{opacity:.85}
.dsh-todo-grip.is-visible{opacity:.5}
.dsh-todo-stage-head:hover .dsh-todo-grip.is-visible{opacity:.85}
.dsh-todo-row:hover{background:var(--dsw-alias-interactive-bg-hover);--dsh-todo-row-bg:var(--dsw-alias-interactive-bg-hover)}
.dsh-todo-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
/* "In progress" is an active signal, not a stage property: one amber mark that
   reads the same in every stage. */
.dsh-todo-row[data-progress]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 20%,transparent)}
.dsh-todo-row[data-progress]::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;
  background:var(--dsw-alias-state-warn-primary)}
.dsh-todo-row[data-progress]:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 26%,transparent)}
/* The strike is a background line on a text-hugging box: it can be drawn by
   animating its width, and it never runs past the end of the title. */
.dsh-todo-item{display:inline-block;max-width:100%;vertical-align:top;font-size:13.5px;line-height:1.55;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background-repeat:no-repeat;
  background-position:0 56%;background-size:0% 2px;--dsh-todo-strike-h:2px}
.dsh-todo-item[data-done]{color:var(--dsw-alias-label-secondary);opacity:.9;
  background-image:linear-gradient(var(--dsw-alias-label-primary),var(--dsw-alias-label-primary));
  background-size:100% 2px}
.dsh-todo-item[data-progress]{font-weight:600;color:var(--dsw-alias-state-warn-label)}
.dsh-todo-child{display:inline-block;max-width:100%;vertical-align:top;font-size:12.5px;line-height:1.5;
  color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  background-repeat:no-repeat;background-position:0 56%;background-size:0% 1px;--dsh-todo-strike-h:1px}
.dsh-todo-child[data-done]{color:var(--dsw-alias-label-tertiary);
  background-image:linear-gradient(var(--dsw-alias-label-primary),var(--dsw-alias-label-primary));
  background-size:100% 1px}
.dsh-todo-wait{font-size:10.5px;letter-spacing:.02em;line-height:1.5;
  color:var(--dsw-alias-state-warn-primary)}
.dsh-todo-chip{font-family:inherit;font-size:11px;line-height:19px;padding:0 8px;border:0;border-radius:6px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.dsh-todo-offline{display:flex;gap:7px;align-items:flex-start;margin:8px 2px 0;padding:8px 10px;border-radius:10px;
  font-size:11.5px;line-height:1.55;color:var(--dsw-alias-state-warn-label);
  background:var(--dsw-alias-state-warn-tertiary);border:1px solid var(--dsw-alias-state-warn-primary)}
.dsh-todo-offline-mark{flex:0 0 auto;width:14px;height:14px;border-radius:50%;text-align:center;line-height:14px;
  font-size:10px;font-weight:700;background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary-inverted)}
.dsh-todo-offline-text{flex:1 1 auto;min-width:0}
.dsh-todo-chip[data-tone="warn"]{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.dsh-todo-chip[data-tone="danger"]{background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}
.dsh-todo-chip:hover{color:var(--dsw-alias-label-primary)}
.dsh-todo-tail{display:flex;align-items:center;justify-content:flex-end;gap:2px;min-width:0}
/* Hidden means zero width: a narrow panel must not reserve space for buttons
   that are not on screen, which used to truncate the title for nothing. */
.dsh-todo-actions{display:none;align-items:center;gap:1px}
.dsh-todo-row:hover .dsh-todo-actions,.dsh-todo-row:focus-visible .dsh-todo-actions,
.dsh-todo-row:focus-within .dsh-todo-actions{display:flex}
.dsh-todo-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;
  border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-todo-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-todo-btn:disabled{opacity:.35;cursor:default}
.dsh-todo-dot{display:inline-flex;align-items:center;justify-content:center;width:16px;height:22px;padding:0;
  border:0;background:transparent;cursor:pointer;border-radius:6px}
.dsh-todo-dot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-todo-dot>svg{display:block}
.dsh-todo-dot:hover{opacity:.75}
.dsh-todo-link{font:inherit;font-size:11.5px;line-height:20px;padding:2px 6px;border:0;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-todo-link:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-todo-date{font:inherit;font-size:11px;padding:1px 6px;border:0;border-radius:6px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-todo-input{font:inherit;font-size:13.5px;line-height:1.5;width:100%;padding:3px 7px;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:6px;outline:none}
.dsh-todo-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsh-todo-add{margin:4px 10px 7px 48px}
.dsh-todo-foot{margin:22px 4px 0;font-size:11px;letter-spacing:.02em;
  color:var(--dsw-alias-label-tertiary)}
.dsh-todo-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;padding:32px 22px;text-align:center;background:var(--dsw-alias-bg-base)}
.dsh-todo-empty-icon{color:var(--dsw-alias-border-l3)}
.dsh-todo-empty-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-todo-empty-body{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);max-width:260px}
.dsh-todo-action-button{font:inherit;font-size:12.5px;line-height:26px;padding:2px 16px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-todo-action-button:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-todo-action-button:disabled{opacity:.5;cursor:default}
.dsh-todo-stage-focus{padding:5px 10px 6px;border-bottom:1px solid var(--dsw-alias-border-l2);
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
.dsh-todo-movebar{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:8px;
  margin:12px 0 0;padding:8px 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);
  box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
[data-material="on"] .dsh-todo-movebar{
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,transparent);
  backdrop-filter:blur(10px) saturate(1.4);
  box-shadow:inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent),
    0 12px 28px -14px color-mix(in srgb,var(--dsw-alias-label-primary) 45%,transparent)}
.dsh-todo-movebar-text{flex:1 1 auto;min-width:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-todo-movebar .dsh-todo-action-button,.dsh-todo-movebar .dsh-todo-link,
.dsh-todo-problem .dsh-todo-action-button{flex:0 0 auto;white-space:nowrap}
.dsh-todo-stage[data-group-drop="before"]{box-shadow:0 -2px 0 var(--dsw-alias-brand-primary)}
.dsh-todo-stage[data-group-drop="after"]{box-shadow:0 2px 0 var(--dsw-alias-brand-primary)}
.dsh-todo-setting-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 2px 4px}
.dsh-todo-setting-unit{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-todo-row[data-dragging]{opacity:.45}
.dsh-todo-insert{position:relative;height:3px;margin:4px 10px;border-radius:2px;
  background:var(--dsh-todo-accent,var(--dsw-alias-brand-primary));pointer-events:none}
.dsh-todo-insert::before{content:'';position:absolute;left:-4px;top:-2px;width:7px;height:7px;
  border-radius:50%;background:inherit}
.dsh-todo-insert[data-pos]{position:absolute;left:10px;right:10px;margin:0;z-index:3}
.dsh-todo-insert[data-pos="before"]{top:-1.5px}
.dsh-todo-insert[data-pos="after"]{bottom:-1.5px}
/* Motion: short and skipped entirely when the OS asks for less motion. */
@keyframes dsh-todo-ring{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
@keyframes dsh-todo-tick{0%{stroke-dashoffset:12}100%{stroke-dashoffset:0}}
@keyframes dsh-todo-ping{0%{transform:scale(.75);opacity:.6}100%{transform:scale(1.9);opacity:0}}
@keyframes dsh-todo-pop{0%{transform:scale(.55);opacity:.3}60%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}
@keyframes dsh-todo-wash{0%{opacity:.7}100%{opacity:0}}
@keyframes dsh-todo-fold{0%{opacity:0;transform:translateY(-4px)}100%{opacity:1;transform:none}}
/* Collapsing a stage or a child list animates its own height: the content stays
   mounted inside a 0fr/1fr grid row (the standard auto-height accordion), and is
   made inert while closed so keyboard focus cannot land in an invisible row. */
.dsh-todo-collapse{display:grid;grid-template-rows:0fr;transition:grid-template-rows .24s cubic-bezier(.4,0,.2,1)}
.dsh-todo-collapse[data-open]{grid-template-rows:1fr}
.dsh-todo-collapse-inner{overflow:hidden;min-height:0}
/* A check that is earned: the circle pops in, then the tick draws itself. */
.dsh-todo-check-ring{transform-origin:7px 7px}
.dsh-todo-check-tick{stroke-dasharray:12;stroke-dashoffset:0}
.dsh-todo-dot-icon{position:relative;display:inline-flex}
.dsh-todo-dot-icon::after{content:'';position:absolute;inset:-3px;border-radius:50%;opacity:0;
  border:1.5px solid var(--dsw-alias-state-success-primary)}
.dsh-todo-fx{position:absolute;inset:0;pointer-events:none;opacity:0;border-radius:2px;z-index:-1}
.dsh-todo-fx[data-kind="completed"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,transparent)}
@keyframes dsh-todo-strike{0%{background-size:0% var(--dsh-todo-strike-h)}
  100%{background-size:100% var(--dsh-todo-strike-h)}}
@keyframes dsh-todo-out{0%{opacity:1;max-height:140px;transform:none}
  55%{opacity:.35;transform:translateX(-10px)}
  100%{opacity:0;max-height:0;transform:translateX(-16px)}}
.dsh-todo-item-block[data-removing="1"]{overflow:hidden;animation:dsh-todo-out .26s ease-in forwards}
@media (prefers-reduced-motion: no-preference){
  /* Only a real transition into "completed" flashes: the row carries
     data-flash for ~0.9s, so reorders and page switches stay quiet. */
  .dsh-todo-row[data-flash="done"] .dsh-todo-dot-icon{animation:dsh-todo-pop .34s cubic-bezier(.2,.9,.3,1.25)}
  .dsh-todo-row[data-flash="done"] .dsh-todo-check-ring{animation:dsh-todo-ring .36s cubic-bezier(.2,.9,.3,1.35) both}
  .dsh-todo-row[data-flash="done"] .dsh-todo-check-tick{animation:dsh-todo-tick .22s ease-out .11s both}
  .dsh-todo-row[data-flash="done"] .dsh-todo-dot-icon::after{animation:dsh-todo-ping .55s ease-out .04s}
  .dsh-todo-row[data-flash="done"] .dsh-todo-fx[data-kind="completed"]{animation:dsh-todo-wash .75s ease-out forwards}
  .dsh-todo-row[data-flash="done"] .dsh-todo-item[data-done],
  .dsh-todo-row[data-flash="done"] .dsh-todo-child[data-done]{animation:dsh-todo-strike .34s ease-out .08s both}
  .dsh-todo-stage-focus,.dsh-todo-insert{animation:dsh-todo-fold .2s ease-out}
  .dsh-todo-row{transition:background-color .16s ease,box-shadow .16s ease,opacity .16s ease}
  .dsh-todo-row[data-dragging]{opacity:.4;transform:scale(.995)}
  .dsh-todo-stage-head{transition:background-color .16s ease}
}
.dsh-todo-error{margin:10px 2px 0;padding:7px 9px;border-radius:8px;font-size:11.5px;line-height:1.5;
  color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-secondary)}
.dsh-todo-focus{margin:10px 0 2px;padding:8px 10px;border-radius:10px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.dsh-todo-focus-row{display:flex;align-items:baseline;gap:8px;min-width:0;padding:1px 0}
.dsh-todo-focus-label{flex:0 0 44px;font-size:10px;letter-spacing:.04em;
  color:var(--dsw-alias-label-tertiary)}
.dsh-todo-focus-text{flex:1 1 auto;min-width:0;font-size:12.5px;line-height:1.5;
  color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-todo-focus-dot{display:inline-block;width:6px;height:6px;border-radius:50%;
  background:var(--dsw-alias-state-warn-primary);margin-right:6px;vertical-align:1px}
.dsh-todo-focus-more{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dsh-todo-subfold{display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 2px;
  border:0;border-radius:4px;background:transparent;font:inherit;font-size:11px;line-height:18px;
  color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap}
.dsh-todo-subfold:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-todo-subcount{font-size:10px;letter-spacing:.02em}
.dsh-todo-problem{margin:8px 2px 0;padding:8px 10px;border-radius:10px;display:flex;
  align-items:flex-start;gap:8px;font-size:11.5px;line-height:1.55;
  color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary);
  border:1px solid var(--dsw-alias-state-warn-primary)}
.dsh-todo-problem-text{flex:1 1 auto;min-width:0}
.dsh-todo-setting{margin-top:14px}
.dsh-todo-setting-title{font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);
  margin-bottom:8px;white-space:nowrap}
.dsh-todo-choice{display:block;width:100%;text-align:left;font:inherit;cursor:pointer;
  padding:8px 10px;margin-bottom:8px;border-radius:10px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-primary)}
.dsh-todo-choice[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}
.dsh-todo-choice-head{display:flex;align-items:baseline;gap:6px}
.dsh-todo-choice-title{font-size:12.5px;font-weight:600}
.dsh-todo-choice-mark{margin-left:auto;font-size:9px;color:var(--dsw-alias-brand-primary)}
.dsh-todo-choice-desc{display:block;margin-top:3px;font-size:11px;line-height:1.6;
  color:var(--dsw-alias-label-secondary)}
.dsh-todo-setting-hint{margin:10px 2px 0;font-size:11px;line-height:1.6;
  color:var(--dsw-alias-label-tertiary)}
/* md3: Google Material Design 3 — pastel tonal stage containers, white rounded item
   cards, M3 lavender pills, warm amber active cards, and child guide line. */
.dsh-todo[data-style="md3"]{
  --dsh-todo-m3-primary:color-mix(in srgb,hsl(265 62% 50%) 80%,var(--dsw-alias-label-primary));
  --dsh-todo-m3-lavender:color-mix(in srgb,hsl(265 72% 62%) 18%,var(--dsw-alias-bg-base));
  background:color-mix(in srgb,hsl(265 72% 62%) 3%,var(--dsw-alias-bg-base));
  padding:12px 10px 18px}
[data-style="md3"] .dsh-todo-count{
  padding:3px 10px;border-radius:999px;font-weight:600;
  background:var(--dsh-todo-m3-lavender);color:var(--dsh-todo-m3-primary)}
[data-style="md3"] .dsh-todo-stage{
  --dsh-todo-m3-tone:hsl(var(--dsh-todo-hue,212) 82% 52%);
  --dsh-todo-m3-ink:color-mix(in srgb,hsl(var(--dsh-todo-hue,212) 78% 45%) 82%,var(--dsw-alias-label-primary));
  margin-top:14px;border-radius:22px;padding-bottom:2px;
  background:color-mix(in srgb,var(--dsh-todo-m3-tone) 10%,var(--dsw-alias-bg-base));
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 22%,transparent)}
[data-style="md3"][data-material="on"] .dsh-todo-stage{
  background-image:none;
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 24%,transparent),
    0 2px 6px -2px color-mix(in srgb,var(--dsh-todo-m3-tone) 18%,transparent)}
[data-style="md3"] .dsh-todo-stage-head{
  padding:11px 12px 9px;border-bottom:0;
  background:color-mix(in srgb,var(--dsh-todo-m3-tone) 4%,transparent)}
[data-style="md3"] .dsh-todo-index{
  font-size:12.5px;font-weight:700;color:var(--dsh-todo-m3-ink)}
[data-style="md3"] .dsh-todo-kicker{font-size:13px;font-weight:650;letter-spacing:.01em}
[data-style="md3"] .dsh-todo-mode{
  padding:1px 8px;border-radius:999px;font-size:10px;font-weight:500;
  color:var(--dsh-todo-m3-ink);
  background:color-mix(in srgb,var(--dsh-todo-m3-tone) 12%,var(--dsw-alias-bg-base));
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 22%,transparent)}
[data-style="md3"] .dsh-todo-stage-count{
  padding:2px 9px;border-radius:999px;font-weight:600;
  background:var(--dsw-alias-bg-base);color:var(--dsh-todo-m3-ink);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 20%,transparent)}
[data-style="md3"] .dsh-todo-stage-head[data-state="done"] .dsh-todo-stage-count{
  color:var(--dsw-alias-state-success-primary);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,transparent)}
[data-style="md3"] .dsh-todo-stage-focus{
  display:flex;flex-direction:column;gap:6px;padding:0 10px 6px;border-bottom:0;background:transparent}
[data-style="md3"] .dsh-todo-focus-row{
  align-items:center;gap:8px;padding:7px 10px;border-radius:14px}
[data-style="md3"] .dsh-todo-focus-row[data-focus-kind="next"]{
  background:color-mix(in srgb,var(--dsh-todo-m3-tone) 16%,var(--dsw-alias-bg-base));
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 24%,transparent)}
[data-style="md3"] .dsh-todo-focus-row[data-focus-kind="next"] .dsh-todo-focus-label{
  flex:0 0 auto;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:0;
  background:var(--dsh-todo-m3-tone);color:#ffffff}
[data-style="md3"] .dsh-todo-focus-row[data-focus-kind="active"]{
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,var(--dsw-alias-bg-base));
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}
[data-style="md3"] .dsh-todo-focus-row[data-focus-kind="active"] .dsh-todo-focus-label{
  flex:0 0 auto;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:0;
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,var(--dsw-alias-bg-base));
  color:var(--dsw-alias-state-warn-label)}
[data-style="md3"] .dsh-todo-focus-row[data-focus-kind="active"] .dsh-todo-focus-dot{margin-right:0}
[data-style="md3"] .dsh-todo-item-block+.dsh-todo-item-block{border-top:0}
[data-style="md3"] .dsh-todo-row{
  margin:6px 10px;padding:9px 10px;border-radius:14px;background:var(--dsw-alias-bg-base);
  box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent),
    0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 10%,transparent)}
[data-style="md3"] .dsh-todo-row:hover{
  background:color-mix(in srgb,var(--dsh-todo-m3-tone) 5%,var(--dsw-alias-bg-base))}
[data-style="md3"] .dsh-todo-row[data-progress]{
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,var(--dsw-alias-bg-base));
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 48%,transparent)}
[data-style="md3"] .dsh-todo-row[data-progress]::before{display:none}
[data-style="md3"] .dsh-todo-children .dsh-todo-collapse-inner{
  margin:0 10px 4px 36px;padding-left:12px;
  border-left:2px solid color-mix(in srgb,var(--dsh-todo-m3-tone) 42%,transparent)}
[data-style="md3"] .dsh-todo-row[data-child]{
  margin:4px 0;padding:7px 10px;border-radius:12px;
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 18%,transparent)}
[data-style="md3"] .dsh-todo-chip{
  padding:1px 9px;border-radius:999px;font-weight:600;
  background:var(--dsh-todo-m3-lavender);color:var(--dsh-todo-m3-primary)}
[data-style="md3"] .dsh-todo-chip[data-tone="warn"]{
  background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
[data-style="md3"] .dsh-todo-chip[data-tone="danger"]{
  background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}
[data-style="md3"] .dsh-todo-date,[data-style="md3"] .dsh-todo-btn,
[data-style="md3"] .dsh-todo-link{border-radius:999px}
[data-style="md3"] .dsh-todo-empty-stage{
  margin:6px 10px;padding:12px !important;border-radius:14px;text-align:center;
  background:var(--dsw-alias-bg-base);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-todo-m3-tone) 10%,transparent)}
[data-style="md3"] .dsh-todo-add{margin:6px 10px 10px}
[data-style="md3"] .dsh-todo-add>.dsh-todo-link{
  display:block;width:100%;text-align:center;padding:6px 12px;border-radius:14px;font-weight:500;
  color:var(--dsh-todo-m3-ink);
  background:color-mix(in srgb,var(--dsw-alias-bg-base) 75%,transparent);
  border:1.5px dashed color-mix(in srgb,var(--dsh-todo-m3-tone) 34%,transparent)}
[data-style="md3"] .dsh-todo-add>.dsh-todo-link:hover{
  background:var(--dsw-alias-bg-base);border-color:var(--dsh-todo-m3-tone)}
[data-style="md3"] .dsh-todo-add-stage{margin-top:14px !important;display:flex;justify-content:flex-end}
[data-style="md3"] .dsh-todo-add-stage>.dsh-todo-link{
  padding:7px 16px;border-radius:16px;font-size:12.5px;font-weight:600;
  background:var(--dsh-todo-m3-lavender);color:var(--dsh-todo-m3-primary);
  box-shadow:0 2px 8px -2px color-mix(in srgb,var(--dsh-todo-m3-primary) 26%,transparent)}
[data-style="md3"] .dsh-todo-input{border-radius:12px;padding:5px 11px}
[data-style="md3"] .dsh-todo-action-button{
  border-radius:999px;border:0;padding:3px 18px;font-weight:600;
  background:var(--dsh-todo-m3-lavender);color:var(--dsh-todo-m3-primary)}
[data-style="md3"] .dsh-todo-action-button:hover{
  background:color-mix(in srgb,hsl(265 72% 62%) 26%,var(--dsw-alias-bg-base))}
[data-style="md3"] .dsh-todo-choice{
  border-radius:16px;padding:10px 14px;
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--dsw-alias-bg-base))}
[data-style="md3"] .dsh-todo-choice[aria-pressed="true"]{
  background:var(--dsh-todo-m3-lavender);
  box-shadow:0 0 0 1px var(--dsh-todo-m3-primary);border-color:transparent}
[data-style="md3"] .dsh-todo-movebar,[data-style="md3"] .dsh-todo-offline,
[data-style="md3"] .dsh-todo-problem{border-radius:18px}
${SWITCH_STYLE}
`

    /**
     * Collapse this plugin's own command rows. The row's text is already absent
     * (the commandview renders only a marker); what still takes space is the
     * wrapper div and the flow item around it, so hide both by the marker.
     * Class-name fragments are matched loosely on purpose: they are hashed by
     * the host's CSS-module build, and a miss simply leaves today's behaviour.
     */
    const QUIET_STYLE = '[data-dsh-todo-quiet]{display:none!important}'
      + '[class*="flowItem"]:has([data-dsh-todo-quiet]){display:none!important}'
      + '[class*="callRow"]:has([data-dsh-todo-quiet]){display:none!important}'

    /**
     * The composer widget lives outside the panel, so it carries its own sheet:
     * the panel's stylesheet only ships with the panel.
     */
    const CHIP_STYLE = `
.dsh-todo-chipwrap{display:inline-flex;align-items:center;gap:6px}
.dsh-todo-chip-open{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;line-height:20px;
  color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l2);
  border-radius:4px;padding:1px 7px;cursor:pointer}
.dsh-todo-chip-open:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
${SWITCH_STYLE}
`

    /** Guide glyph: a checklist drawn in `currentColor`. */
    function TodoGlyph(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        {
          viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': true, style: { display: 'block' },
        },
        h('rect', { x: 3, y: 4.25, width: 3, height: 3, rx: 0.8, fill: 'currentColor', opacity: 0.9 }),
        h('rect', { x: 7.75, y: 4.9, width: 9, height: 1.7, rx: 0.85, fill: 'currentColor', opacity: 0.55 }),
        h('path', {
          d: 'M3.4 10.4l1.6 1.6 2.5-2.6',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('rect', { x: 7.75, y: 10.1, width: 9, height: 1.7, rx: 0.85, fill: 'currentColor', opacity: 0.35 }),
        h('rect', { x: 3, y: 15, width: 3, height: 3, rx: 0.8, fill: 'currentColor', opacity: 0.2 }),
        h('rect', { x: 7.75, y: 15.65, width: 6, height: 1.7, rx: 0.85, fill: 'currentColor', opacity: 0.2 }),
      )
    }

    /**
     * Read what the panel can show from a parsed file. The Host validates
     * strictly before writing; the panel only needs to survive a hand-edited
     * file, so it tolerates missing optional fields.
     * @param parsed - parsed JSON.
     * @returns `{ ok: true, plan }` or `{ ok: false, message }`.
     */
    /**
     * Problems that make the Host refuse every write. A write validates the whole
     * file, so one bad row turns every control silent; the panel names the row up
     * front instead. Only the checks it can describe precisely are mirrored — an
     * unknown-key complaint still arrives through the command's error text.
     * @param parsed - the file's parsed JSON.
     * @returns one short message per problem.
     */
    function planProblems(parsed) {
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return ['根节点不是对象']
      const problems = []
      const stray = (value, allowed, at) => {
        if (value === null || typeof value !== 'object') return
        for (const key of Object.keys(value)) {
          if (!allowed.includes(key)) problems.push(`${at} 有不认识的字段「${key}」`)
        }
      }
      stray(parsed, TOP_KEYS, '文件')
      if (parsed.version !== 1) problems.push('version 必须是 1')
      if (!Number.isInteger(parsed.rev) || parsed.rev < 0) problems.push('rev 必须是非负整数')

      const groups = Array.isArray(parsed.groups) ? parsed.groups : []
      if (!Array.isArray(parsed.groups)) problems.push('groups 必须是数组')
      const groupIds = new Set()
      groups.forEach((group, index) => {
        const at = `阶段 ${index + 1}`
        if (group === null || typeof group !== 'object' || Array.isArray(group)) { problems.push(`${at} 不是对象`); return }
        stray(group, GROUP_KEYS, at)
        const id = typeof group.id === 'string' ? group.id.trim() : ''
        if (id === '') problems.push(`${at} 缺 id`)
        else if (groupIds.has(id)) problems.push(`${at} 的 id 重复（${id}）`)
        else groupIds.add(id)
        if (typeof group.title !== 'string' || group.title.trim() === '') problems.push(`${at} 缺标题`)
        if (group.mode !== undefined && !MODES.includes(group.mode)) problems.push(`${at} 的 mode 不合法`)
        if (group.order !== undefined && !Number.isInteger(group.order)) problems.push(`${at} 的 order 不是整数`)
      })

      const items = Array.isArray(parsed.items) ? parsed.items : []
      if (!Array.isArray(parsed.items)) problems.push('items 必须是数组')
      const itemIds = new Set()
      items.forEach((item, index) => {
        const at = `第 ${index + 1} 项`
        if (item === null || typeof item !== 'object' || Array.isArray(item)) { problems.push(`${at} 不是对象`); return }
        stray(item, ITEM_KEYS, at)
        const id = typeof item.id === 'string' ? item.id.trim() : ''
        if (id === '') problems.push(`${at} 缺 id`)
        else if (itemIds.has(id)) problems.push(`${at} 的 id 重复（${id}）`)
        else itemIds.add(id)
        if (typeof item.title !== 'string' || item.title.trim() === '') problems.push(`${at} 缺标题`)
        if (!STATUSES.includes(item.status)) problems.push(`${at} 的状态不合法`)
        if (typeof item.groupId === 'string' && !groupIds.has(item.groupId)) {
          problems.push(`${at} 的阶段「${item.groupId}」不存在`)
        }
        if (item.due !== undefined && typeof item.due !== 'string') problems.push(`${at} 的截止日期不是字符串`)
        if (!Array.isArray(item.children)) return
        item.children.forEach((child, childIndex) => {
          const childAt = `${at} 的第 ${childIndex + 1} 个子项`
          if (child === null || typeof child !== 'object' || Array.isArray(child)) { problems.push(`${childAt} 不是对象`); return }
          stray(child, CHILD_KEYS, childAt)
          if (typeof child.id !== 'string' || child.id.trim() === '') problems.push(`${childAt} 缺 id`)
          if (typeof child.title !== 'string' || child.title.trim() === '') problems.push(`${childAt} 缺标题`)
          if (!STATUSES.includes(child.status)) problems.push(`${childAt} 的状态不合法`)
        })
      })
      return problems
    }

    /**
     * Fill `{name}` placeholders in a dictionary string.
     * @param template - dictionary text.
     * @param params - replacement values.
     * @returns the filled text.
     */
    function fill(template, params) {
      return template.replace(/\{(\w+)\}/g, (whole, key) => (params[key] === undefined ? whole : String(params[key])))
    }

    /**
     * Read the folded child ids remembered for one plan file.
     * @param path - workspace-relative plan path.
     * @returns the ids; empty when storage is unavailable or unreadable.
     */
    function readFolded(path) {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(FOLD_PREFIX + path) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []
      } catch {
        return []
      }
    }

    /**
     * Remember the folded child ids for one plan file.
     * @param path - workspace-relative plan path.
     * @param ids - folded item ids.
     */
    function writeFolded(path, ids) {
      try {
        window.localStorage.setItem(FOLD_PREFIX + path, JSON.stringify(ids))
      } catch {
        // Private mode or a full quota: folding just stops persisting.
      }
    }

    /** Where the per-Session switch is remembered (default: off). */
    const SESSION_KEY = 'dsh-todo:session:'

    /** In-memory mirror so the composer chip and the panel agree immediately. */
    const sessionSwitch = { values: new Map(), listeners: new Set() }

    /**
     * Read the switch for one Session.
     * @param sessionId - the Session id.
     * @returns whether the plugin is on; a missing Session is off.
     */
    function getSessionSwitch(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      if (sessionSwitch.values.has(sessionId)) return sessionSwitch.values.get(sessionId)
      let value = false
      try {
        value = window.localStorage.getItem(SESSION_KEY + sessionId) === '1'
      } catch {
        value = false
      }
      sessionSwitch.values.set(sessionId, value)
      return value
    }

    /**
     * Set and remember the switch for one Session, telling every listener.
     * The Host is told separately (it needs the command path to do it).
     * @param sessionId - the Session id.
     * @param value - whether the plugin is on.
     */
    function setSessionSwitch(sessionId, value) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      sessionSwitch.values.set(sessionId, value === true)
      try {
        window.localStorage.setItem(SESSION_KEY + sessionId, value === true ? '1' : '0')
      } catch {
        // Storage unavailable: the switch works for this page load only.
      }
      for (const listener of sessionSwitch.listeners) listener(value === true, sessionId)
    }

    /**
     * Follow switch changes.
     * @param listener - called with the new value.
     * @returns the unsubscribe function.
     */
    function subscribeSessionSwitch(listener) {
      sessionSwitch.listeners.add(listener)
      return () => { sessionSwitch.listeners.delete(listener) }
    }

    function normalizePlan(parsed) {
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, message: '根节点必须是对象' }
      }
      if (parsed.version !== 1) return { ok: false, message: `version 必须是 1（读到的 ${String(parsed.version)}）` }
      if (!Array.isArray(parsed.items) || !Array.isArray(parsed.groups)) {
        return { ok: false, message: 'groups 与 items 必须是数组' }
      }
      const groups = parsed.groups.map((group, index) => ({
        id: String(group?.id ?? `g${index}`),
        title: String(group?.title ?? ''),
        mode: ['sequence', 'parallel', 'free'].includes(group?.mode) ? group.mode : 'free',
        order: Number.isInteger(group?.order) ? group.order : index + 1,
      }))
      const items = parsed.items.map((item, index) => ({
        id: String(item?.id ?? `i${index}`),
        groupId: item?.groupId === undefined ? undefined : String(item.groupId),
        order: Number.isInteger(item?.order) ? item.order : index + 1,
        title: String(item?.title ?? ''),
        status: STATUSES.includes(item?.status) ? item.status : 'pending',
        after: Array.isArray(item?.after) ? item.after.map(String) : undefined,
        due: typeof item?.due === 'string' ? item.due : undefined,
        note: typeof item?.note === 'string' ? item.note : undefined,
        children: Array.isArray(item?.children)
          ? item.children.map((child, childIndex) => ({
            id: String(child?.id ?? `c${childIndex}`),
            title: String(child?.title ?? ''),
            status: STATUSES.includes(child?.status) ? child.status : 'pending',
          }))
          : [],
      }))
      return {
        ok: true,
        plan: {
          rev: Number.isInteger(parsed.rev) ? parsed.rev : 0,
          title: typeof parsed.title === 'string' ? parsed.title : '',
          hideCompleted: parsed.ui?.hideCompleted === true,
          openRequest: Number.isInteger(parsed.ui?.openRequest) ? parsed.ui.openRequest : 0,
          notify: ['next-turn', 'wake', 'off'].includes(parsed.ui?.notify) ? parsed.ui.notify : 'next-turn',
          notifyWindow: Number.isInteger(parsed.ui?.notifyWindow) ? parsed.ui.notifyWindow : 8,
          style: ['paper', 'calm', 'vivid', 'md3'].includes(parsed.ui?.style) ? parsed.ui.style : 'vivid',
          material: typeof parsed.ui?.material === 'boolean' ? parsed.ui.material : true,
          next: typeof parsed.ui?.next === 'string' ? parsed.ui.next : null,
          groups, items,
        },
      }
    }

    /**
     * Choose which `todolist.json` a search found. The shallowest file wins, so
     * a plan at the workspace root beats one nested in a project folder.
     * @param matches - the Host's search matches.
     * @returns the workspace-relative path, or undefined when none matched.
     */
    function pickPlanPath(matches) {
      const candidates = matches
        .filter(match => match.type === 'file' && (match.path === PLAN_FILE || match.path.endsWith('/' + PLAN_FILE)))
        .sort((left, right) => {
          const depth = left.path.split('/').length - right.path.split('/').length
          return depth !== 0 ? depth : left.path.length - right.path.length
        })
      return candidates.length === 0 ? undefined : candidates[0].path
    }

    /**
     * Copy the plugin needs at render time, plus the components it registers.
     * @param ctx - the client context (Remote, locale, sidebar, slots).
     * @returns the registered components and the testable panel.
     */
    function buildUi(ctx) {
      const t = ctx.locale.bind(NS)

      /**
       * Tell the Host whether this Session has the panel switched on. The Host
       * needs it for the system-prompt section, the tool gate and notifications.
       * @param sessionId - the Session id.
       * @param enabled - the new value.
       */
      function pushSessionSwitch(sessionId, enabled) {
        if (typeof sessionId !== 'string' || sessionId === '') return
        try {
          const line = '/todo op ' + JSON.stringify({ op: { op: 'session', enabled: enabled === true } })
          const pending = ctx.remote.commands.execute(sessionId, line, [])
          if (pending !== undefined && typeof pending.catch === 'function') pending.catch(() => {})
        } catch {
          // The Host will keep its previous value; the panel still works locally.
        }
      }

      const byOrder = (left, right) => (left.order - right.order) || String(left.id).localeCompare(String(right.id))

      /** Two-digit index for a stage, as the editorial rail numbers them. */
      const indexLabel = index => String(index + 1).padStart(2, '0')
      /**
       * Human text for a stored due value, plus how urgent it is.
       * @param due - the stored value.
       * @param now - reference instant.
       * @returns `{ text, tone }`.
       */
      function dueLabel(due, now) {
        const target = due.length === 10 ? new Date(`${due}T23:59:59`) : new Date(due)
        if (Number.isNaN(target.getTime())) return { text: due, tone: undefined }
        const startOfDay = value => new Date(value.getFullYear(), value.getMonth(), value.getDate())
        const days = Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000)
        const short = due.slice(5, 10)
        if (days < 0) return { text: `${short} ${t('due.overdue')}`, tone: 'danger' }
        if (days === 0) return { text: `${short} ${t('due.today')}`, tone: 'warn' }
        return { text: short, tone: undefined }
      }

      /**
       * Thin-stroke line icons, drawn in `currentColor`.
       * @param props - `{ name, size? }`.
       * @returns the icon.
       */
      function Glyph(props) {
        const size = props.size ?? 12
        const common = { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': true, style: { display: 'block' } }
        const stroke = {
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.25,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }
        if (props.name === 'plus') return h('svg', common, h('path', { d: 'M7 2.5v9M2.5 7h9', ...stroke }))
        if (props.name === 'close') return h('svg', common, h('path', { d: 'M3.5 3.5l7 7M10.5 3.5l-7 7', ...stroke }))
        if (props.name === 'up') return h('svg', common, h('path', { d: 'M3.5 8.5L7 5l3.5 3.5', ...stroke }))
        if (props.name === 'down') return h('svg', common, h('path', { d: 'M3.5 5.5L7 9l3.5-3.5', ...stroke }))
        if (props.name === 'chevron') {
          return h('svg', common, h('path', {
            d: props.open ? 'M3.5 5.5L7 9l3.5-3.5' : 'M5.5 3.5L9 7l-3.5 3.5', ...stroke,
          }))
        }
        if (props.name === 'grip') {
          return h('svg', { ...common, viewBox: '0 0 10 14' },
            ...[-3, 0, 3].flatMap(offset => [
              h('circle', { key: `l${offset}`, cx: 3, cy: 7 + offset, r: 1, fill: 'currentColor' }),
              h('circle', { key: `r${offset}`, cx: 7, cy: 7 + offset, r: 1, fill: 'currentColor' }),
            ]),
          )
        }
        if (props.name === 'calendar') {
          return h('svg', common,
            h('rect', { x: 2, y: 3, width: 10, height: 9, rx: 1.5, ...stroke }),
            h('path', { d: 'M2 5.8h10M4.6 1.8V4M9.4 1.8V4', ...stroke }),
          )
        }
        if (props.name === 'eye' || props.name === 'eye-off') {
          return h('svg', common,
            h('path', { d: 'M1.4 7s2.3-3.4 5.6-3.4S12.6 7 12.6 7s-2.3 3.4-5.6 3.4S1.4 7 1.4 7z', ...stroke }),
            h('circle', { cx: 7, cy: 7, r: 1.5, ...stroke }),
            props.name === 'eye-off' ? h('path', { d: 'M2.4 2.4l9.2 9.2', ...stroke }) : null,
          )
        }
        if (props.name === 'sliders') {
          return h('svg', common,
            h('path', { d: 'M2 4.5h5.4M9.6 4.5h2.4M2 9.5h2.4M6.6 9.5h5.4', ...stroke }),
            h('circle', { cx: 8.5, cy: 4.5, r: 1.3, fill: 'currentColor' }),
            h('circle', { cx: 5.5, cy: 9.5, r: 1.3, fill: 'currentColor' }),
          )
        }
        if (props.name === 'gear') {
          return h('svg', common,
            h('circle', { cx: 7, cy: 7, r: 2.1, ...stroke }),
            h('path', {
              d: 'M7 1.9v1.6M7 10.5v1.6M2.4 7H1M13 7h-1.4M3.7 3.7l1.1 1.1M9.2 9.2l1.1 1.1M10.3 3.7L9.2 4.8M4.8 9.2L3.7 10.3',
              ...stroke,
            }),
          )
        }
        if (props.name === 'back') return h('svg', common, h('path', { d: 'M8.5 3.5L5 7l3.5 3.5', ...stroke }))
        if (props.name === 'target') {
          return h('svg', common,
            h('circle', { cx: 7, cy: 7, r: 5, ...stroke }),
            h('circle', { cx: 7, cy: 7, r: 1.6, fill: 'currentColor' }),
          )
        }
        return h('svg', common, h('path', { d: 'M2.5 7.5l2.4 2.4 6-6.2', ...stroke }))
      }

      /**
       * The status control: one button that flips done / not done. The panel owns
       * this single bit; "in progress" and "next" belong to the agent.
       * @param props - `{ status, onCycle }`.
       * @returns the button.
       */
      function StatusControl(props) {
        const done = props.status === 'completed'
        const label = done ? t('panel.markPending') : t('panel.markDone')
        const size = 14
        const ink = done
          ? 'var(--dsw-alias-state-success-primary)'
          : props.status === 'in_progress'
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-border-l3)'
        return h('button', {
          type: 'button',
          className: 'dsh-todo-dot',
          title: label,
          'aria-label': label,
          'aria-pressed': done,
          'data-action': 'cycle',
          'data-status': props.status,
          onClick: (event) => { event.stopPropagation(); props.onCycle() },
        }, h('span', { key: props.status, className: 'dsh-todo-dot-icon' },
          h('svg', { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': true },
            done
              ? [
                h('circle', { key: 'c', className: 'dsh-todo-check-ring', cx: 7, cy: 7, r: 6.3, fill: ink }),
                h('path', {
                  key: 't', className: 'dsh-todo-check-tick', d: 'M4.2 7.2l1.9 1.9 3.7-3.9', fill: 'none',
                  stroke: 'var(--dsw-alias-label-primary-inverted)', strokeWidth: 1.3,
                  strokeLinecap: 'round', strokeLinejoin: 'round',
                }),
              ]
              : [
                h('circle', { key: 'c', cx: 7, cy: 7, r: 5.6, fill: 'none', stroke: ink, strokeWidth: 1.4 }),
                props.status === 'in_progress'
                  ? h('circle', { key: 'd', cx: 7, cy: 7, r: 2.1, fill: ink })
                  : null,
              ],
          ),
        ))
      }

      /** One tiny icon button for row actions. */
      function IconButton(props) {
        return h('button', {
          type: 'button',
          className: 'dsh-todo-btn',
          title: props.title,
          'aria-label': props.title,
          'data-action': props.action,
          disabled: props.disabled === true,
          onClick: (event) => { event.stopPropagation(); props.onClick() },
        }, h(Glyph, { name: props.name, size: 12 }))
      }

      function TextInput(props) {
        return h('input', {
          className: 'dsh-todo-input',
          type: 'text',
          value: props.value,
          autoFocus: true,
          'aria-label': props.label,
          placeholder: props.placeholder,
          onChange: event => { props.onChange(event.target.value) },
          onKeyDown: (event) => {
            if (event.key === 'Enter') { event.preventDefault(); props.onCommit() }
            if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
          },
          onBlur: () => { props.onCommit() },
        })
      }

      /**
       * A keyboard target for one row: Enter cycles, F2 renames, Delete asks.
       * @param item - the row's item.
       * @param handlers - the panel handlers.
       * @returns the key handler.
       */
      function rowKeys(item, handlers) {
        return (event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handlers.cycle(item)
          } else if (event.key === 'F2') {
            event.preventDefault()
            handlers.startRename(item)
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            handlers.startDelete(item)
          }
        }
      }

      function ItemRow(props) {
        const { item, byId, now, view, handlers, depth } = props
        const done = item.status === 'completed'
        const due = item.due === undefined ? undefined : dueLabel(item.due, now)
        const waiting = item.status === 'pending'
          && (item.after ?? []).some(id => byId.get(id)?.status !== 'completed')
        const editing = view.editing?.id === item.id
        const confirming = view.confirming === item.id
        const addingChild = view.adding?.kind === 'child' && view.adding.parentId === item.id
        const children = (item.children ?? []).slice().sort(byOrder)
        const folded = children.length > 0 && view.foldedChildren?.includes(item.id) === true

        const title = editing
          ? h(TextInput, {
            value: view.editing.value,
            label: t('panel.name'),
            onChange: handlers.setEditValue,
            onCommit: handlers.commitRename,
            onCancel: handlers.cancelEdit,
          })
          : h('div', {
            className: depth === 0 ? 'dsh-todo-item' : 'dsh-todo-child',
            'data-done': done ? '' : undefined,
            'data-progress': depth === 0 && item.status === 'in_progress' ? '' : undefined,
            onDoubleClick: () => { handlers.startRename(item) },
            title: item.title,
          }, item.title)

        const dropSide = view.dropTarget?.kind === 'item' && view.dropTarget.id === item.id
          ? (view.dropTarget.before ? 'before' : 'after')
          : undefined

        return h('div', {
          className: depth === 0 ? 'dsh-todo-item-block' : undefined,
          'data-removing': view.removing === item.id ? '1' : undefined,
        },
          h('div', {
            className: 'dsh-todo-row',
            'data-item': item.id,
            'data-progress': depth === 0 && item.status === 'in_progress' ? '' : undefined,
            'data-child': depth === 1 ? '' : undefined,
            'data-dragging': view.drag?.kind === 'item' && view.drag.id === item.id ? '' : undefined,
            'data-flash': Array.isArray(view.flashIds) && view.flashIds.includes(item.id) ? 'done' : undefined,
            'data-drop': dropSide,
            onDragOver: (event) => { if (depth === 0) handlers.dragOver('item', item.id, event) },
            onDrop: (event) => { if (depth === 0) { event.stopPropagation(); handlers.drop(event) } },
            onKeyDown: rowKeys(item, handlers),
            tabIndex: 0,
          },
            dropSide === undefined ? null : h('div', { className: 'dsh-todo-insert', 'data-pos': dropSide, 'aria-hidden': true }),
            h('span', { key: `fx-${item.status}`, className: 'dsh-todo-fx', 'data-kind': item.status, 'aria-hidden': true }),
            depth === 0 ? h('span', {
              className: 'dsh-todo-grip',
              draggable: true,
              title: t('panel.dragHint'),
              'aria-hidden': true,
              onDragStart: (event) => { handlers.dragStart('item', item.id, event) },
              onDragEnd: () => { handlers.dragEnd() },
            }, h(Glyph, { name: 'grip', size: 10 })) : null,
            h(StatusControl, { status: item.status, onCycle: () => { handlers.cycle(item) } }),
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 } },
                children.length === 0 ? null : h('button', {
                  type: 'button',
                  className: 'dsh-todo-subfold',
                  'data-action': 'fold-children',
                  'aria-expanded': !folded,
                  title: folded ? t('panel.unfoldChildren') : t('panel.foldChildren'),
                  onClick: (event) => { event.stopPropagation(); handlers.toggleChildren(item) },
                },
                  h(Glyph, { name: 'chevron', open: !folded, size: 9 }),
                  folded ? h('span', { className: 'dsh-todo-subcount' }, '+' + children.length) : null,
                ),
                h('div', { style: { minWidth: 0, flex: '1 1 auto' } }, title),
              ),
              waiting ? h('div', { className: 'dsh-todo-wait dsh-todo-mono' }, t('blocked')) : null,
            ),
            h('div', { className: 'dsh-todo-tail' },
              view.dating === item.id
                ? h('input', {
                  className: 'dsh-todo-date',
                  type: 'date',
                  autoFocus: true,
                  'aria-label': t('panel.setDue'),
                  defaultValue: item.due ?? '',
                  onChange: event => { handlers.setDue(item, event.target.value) },
                  onBlur: () => { handlers.cancelDate() },
                })
                : item.due === undefined
                  ? null
                  : h('button', {
                    type: 'button',
                    className: 'dsh-todo-chip dsh-todo-mono',
                    'data-tone': due.tone,
                    'data-action': 'clear-due',
                    title: t('panel.clearDue'),
                    onClick: () => { handlers.setDue(item, '') },
                  }, due.text),
              h('div', { className: 'dsh-todo-actions' },
                confirming
                  ? [
                    h('button', {
                      key: 'yes', type: 'button', className: 'dsh-todo-link', 'data-action': 'confirm-delete',
                      onClick: () => { handlers.confirmDelete(item) },
                    }, t('panel.confirm')),
                    h('button', {
                      key: 'no', type: 'button', className: 'dsh-todo-link', 'data-action': 'cancel-delete',
                      onClick: () => { handlers.cancelDelete() },
                    }, t('panel.cancel')),
                  ]
                  : [
                    item.due === undefined && depth === 0 && view.dating !== item.id
                      ? h(IconButton, {
                        key: 'due', name: 'calendar', title: t('panel.setDue'), action: 'set-due',
                        onClick: () => { handlers.startDate(item) },
                      })
                      : null,
                    depth === 0 ? h(IconButton, {
                      key: 'add', name: 'plus', title: t('panel.addChild'), action: 'add-child',
                      onClick: () => { handlers.startAddChild(item) },
                    }) : null,
                    h(IconButton, {
                      key: 'del', name: 'close', title: t('panel.delete'), action: 'delete',
                      onClick: () => { handlers.startDelete(item) },
                    }),
                  ],
              ),
            ),
          ),
          children.length === 0 ? null : h('div', {
            className: 'dsh-todo-children dsh-todo-collapse',
            'data-open': folded ? undefined : '',
            inert: folded ? '' : undefined,
          },
            h('div', { className: 'dsh-todo-collapse-inner' },
              children.map(child => h(ItemRow, {
                key: child.id, item: child, byId, now, view, handlers, depth: 1,
              })),
            ),
          ),
          addingChild
            ? h('div', { style: { paddingLeft: 48, margin: '2px 0 4px' } },
              h(TextInput, {
                value: view.adding.value,
                label: t('panel.addChild'),
                onChange: handlers.setAddValue,
                onCommit: handlers.commitAdd,
                onCancel: handlers.cancelAdd,
              }),
            )
            : null,
        )
      }

      /** The inline “add an item” row of one stage. */
      function AddRow(props) {
        const adding = props.view.adding?.kind === 'item' && props.view.adding.groupId === props.groupId
        if (adding) {
          return h('div', { className: 'dsh-todo-add' },
            h(TextInput, {
              value: props.view.adding.value,
              label: t('panel.addItem'),
              onChange: props.handlers.setAddValue,
              onCommit: props.handlers.commitAdd,
              onCancel: props.handlers.cancelAdd,
            }),
          )
        }
        return h('div', { className: 'dsh-todo-add' },
          h('button', {
            type: 'button', className: 'dsh-todo-link', 'data-action': 'add-item',
            onClick: () => { props.handlers.startAdd(props.groupId) },
          }, '+ ' + t('panel.addItem')),
        )
      }

      /** The panel-wide “add a stage” row, below every section. */
      function AddStage(props) {
        if (props.view.adding?.kind === 'group') {
          return h('div', { style: { marginTop: 26 } },
            h(TextInput, {
              value: props.view.adding.value,
              label: t('panel.addStage'),
              onChange: props.handlers.setAddValue,
              onCommit: props.handlers.commitAdd,
              onCancel: props.handlers.cancelAdd,
            }),
          )
        }
        return h('div', { className: 'dsh-todo-add-stage', style: { marginTop: 26 } },
          h('button', {
            type: 'button', className: 'dsh-todo-link', 'data-action': 'add-stage',
            onClick: () => { props.handlers.startAddStage() },
          }, '+ ' + t('panel.addStage')),
        )
      }

      /** Stage hues, one per rail position; a stage keeps its hue as the list grows. */
      const HUES = [212, 265, 330, 24, 152, 46]

      /**
       * Which item is next: the user's explicit choice while it is still open,
       * otherwise the first unblocked pending item in stage order.
       * @param plan - loaded plan.
       * @returns the item id, or null.
       */
      function resolveNext(plan) {
        const byId = new Map(plan.items.map(item => [item.id, item]))
        const explicit = plan.next === null ? undefined : byId.get(plan.next)
        if (explicit !== undefined && explicit.status !== 'completed') return explicit.id
        const groups = plan.groups.slice().sort(byOrder)
        const rank = item => {
          const index = groups.findIndex(group => group.id === item.groupId)
          return index < 0 ? groups.length : index
        }
        const ordered = plan.items.slice().sort((left, right) => {
          const rankDelta = rank(left) - rank(right)
          return rankDelta !== 0 ? rankDelta : left.order - right.order
        })
        for (const item of ordered) {
          if (item.status !== 'pending') continue
          const blocked = (item.after ?? []).some(id => byId.get(id)?.status !== 'completed')
          if (!blocked) return item.id
        }
        return null
      }

      function Stage(props) {
        const { group, rows, byId, now, view, handlers, index } = props
        const done = byId.doneByGroup(group.id)
        const total = byId.totalByGroup(group.id)
        const collapsed = view.collapsed?.includes(group.id) === true
        const isMoveTarget = view.pendingMove?.kind === 'item'
          && (view.pendingMove.groupId ?? '__none') === group.id
        const pending = isMoveTarget ? view.pendingMove.ids : undefined
        const ordered = pending === undefined
          ? (view.pendingMove?.kind === 'item' && (view.pendingMove.groupId ?? '__none') !== group.id
            ? rows.filter(row => row.id !== view.pendingMove.movedId)
            : rows)
          : pending
            .map(id => byId.map.get(id))
            .filter(row => row !== undefined && (!view.hide || row.status !== 'completed'))
        const state = total > 0 && done === total
          ? 'done'
          : ordered.some(item => item.status === 'in_progress') ? 'active' : 'idle'
        // "In progress" may cover several items (parallel work, set by the
        // agent); "next" is a single pointer. Never show the same row twice.
        const activeRows = ordered.filter(row => row.status === 'in_progress')
        const nextRow = ordered.find(row => row.id === view.nextId)
        const nextShown = nextRow !== undefined && !activeRows.some(row => row.id === nextRow.id)
        const appendHere = view.dropTarget?.kind === 'stage' && view.dropTarget.id === group.id
        const dropHere = view.dropTarget?.kind === 'group' && view.dropTarget.id === group.id
        const empty = ordered.length === 0
        return h('section', {
          className: 'dsh-todo-stage',
          'data-group-drop': dropHere ? (view.dropTarget.before ? 'before' : 'after') : undefined,
          style: { '--dsh-todo-hue': HUES[index % HUES.length] },
        },
          h('button', {
            type: 'button',
            className: 'dsh-todo-stage-head',
            'data-action': 'fold-stage',
            'data-state': state,
            'aria-expanded': !collapsed,
            onDragOver: (event) => { handlers.dragOver('group', group.id, event) },
            onDrop: (event) => { event.stopPropagation(); handlers.drop(event) },
            onClick: () => { handlers.toggleGroup(group.id) },
          },
            h('span', {
              className: 'dsh-todo-grip is-visible',
              draggable: true,
              title: t('panel.dragHint'),
              'aria-hidden': true,
              onDragStart: (event) => { handlers.dragStart('group', group.id, event) },
              onDragEnd: () => { handlers.dragEnd() },
            }, h(Glyph, { name: 'grip', size: 10 })),
            h('span', { className: 'dsh-todo-chevron' }, h(Glyph, { name: 'chevron', open: !collapsed, size: 10 })),
            h('span', { className: 'dsh-todo-index dsh-todo-mono' }, indexLabel(index)),
            h('span', { className: 'dsh-todo-kicker' }, group.title),
            h('span', { className: 'dsh-todo-mode' }, t('mode.' + group.mode)),
            h('span', { className: 'dsh-todo-stage-count dsh-todo-mono' }, done + '/' + total),
          ),
          activeRows.length === 0 && !nextShown ? null : h('div', { className: 'dsh-todo-stage-focus' },
            activeRows.length === 0 ? null : h('div', { className: 'dsh-todo-focus-row', 'data-focus-kind': 'active' },
              h('span', { className: 'dsh-todo-focus-label' }, t('panel.inProgress')),
              h('span', { className: 'dsh-todo-focus-dot' }),
              h('span', { className: 'dsh-todo-focus-text' }, activeRows[0].title),
              activeRows.length > 1
                ? h('span', { className: 'dsh-todo-focus-more dsh-todo-mono' }, '+' + (activeRows.length - 1))
                : null,
            ),
            nextShown ? h('div', { className: 'dsh-todo-focus-row', 'data-focus-kind': 'next' },
              h('span', { className: 'dsh-todo-focus-label' }, t('panel.next')),
              h('span', { className: 'dsh-todo-focus-text' }, nextRow.title),
            ) : null,
          ),
          h('div', { className: 'dsh-todo-collapse', 'data-open': collapsed ? undefined : '' },
            h('div', { className: 'dsh-todo-collapse-inner' },
              h('div', {
                className: 'dsh-todo-items',
                inert: collapsed ? '' : undefined,
                onDragOver: (event) => { handlers.dragOver('stage', group.id, event) },
                onDrop: (event) => { event.stopPropagation(); handlers.drop(event) },
              },
            empty
              ? (appendHere
                ? h('div', { className: 'dsh-todo-insert' })
                : h('div', {
                  className: 'dsh-todo-empty-stage',
                  style: {
                    padding: '2px 6px 2px 22px', fontSize: 11,
                    color: 'var(--dsw-alias-label-tertiary)',
                  },
                }, view.hide === true && total > 0
                  ? fill(t('panel.stageDone'), { n: total })
                  : t('panel.emptyStage')))
              : ordered.map(item => h(ItemRow, { key: item.id, item, byId: byId.map, now, view, handlers, depth: 0 })),
            appendHere && !empty ? h('div', { className: 'dsh-todo-insert' }) : null,
            h(AddRow, { groupId: group.id, view, handlers }),
              ),
            ),
          ),
        )
      }

      /** The centred empty / error screen. */
      /** Panel looks offered by the settings page, in display order. */
      const STYLE_MODES = [
        { style: 'vivid', key: 'vivid' },
        { style: 'md3', key: 'md3' },
        { style: 'paper', key: 'paper' },
        { style: 'calm', key: 'calm' },
      ]

      /** Notify modes offered by the settings page, with their copy keys. */
      const NOTIFY_MODES = [
        { mode: 'next-turn', key: 'nextTurn' },
        { mode: 'wake', key: 'wake' },
        { mode: 'off', key: 'off' },
      ]

      /** The panel's own settings page. */
      function SettingsScreen(props) {
        const plan = props.state.plan
        const savedWindow = String(plan.notifyWindow ?? 8)
        const [windowDraft, setWindowDraft] = React.useState(savedWindow)
        const [windowError, setWindowError] = React.useState(undefined)
        const lastCommittedRef = React.useRef(plan.notifyWindow ?? 8)
        React.useEffect(() => {
          const current = plan.notifyWindow ?? 8
          lastCommittedRef.current = current
          setWindowDraft(String(current))
          setWindowError(undefined)
        }, [plan.notifyWindow])
        const commitWindow = () => {
          const trimmed = String(windowDraft).trim()
          const value = Number(trimmed)
          if (trimmed === '' || !Number.isInteger(value) || value < 1 || value > 600) {
            setWindowError('合并窗口必须是 1..600 的整数（秒）')
            setWindowDraft(savedWindow)
            return
          }
          setWindowError(undefined)
          if (value !== lastCommittedRef.current) {
            lastCommittedRef.current = value
            props.handlers.setNotifyWindow(value)
          }
        }
        return h('div', {
          className: 'dsh-todo',
          'data-style': plan.style ?? 'vivid',
          'data-material': (plan.material ?? true) ? 'on' : 'off',
        },
          h('style', {}, STYLE),
          h('header', { className: 'dsh-todo-head' },
            h(IconButton, {
              name: 'back', title: t('panel.back'), action: 'back-to-plan',
              onClick: () => { props.handlers.page('plan') },
            }),
            h('span', { className: 'dsh-todo-title' }, t('panel.settings')),
          ),
          h('div', { className: 'dsh-todo-setting' },
            h('div', { className: 'dsh-todo-setting-title' }, t('panel.appearance')),
            STYLE_MODES.map(entry => {
              const desc = t('panel.style.' + entry.key + '.desc')
              return h('button', {
                key: entry.style,
                type: 'button',
                className: 'dsh-todo-choice',
                'data-action': 'style-' + entry.style,
                'aria-pressed': (plan.style ?? 'vivid') === entry.style,
                onClick: () => { props.handlers.setStyle(entry.style) },
              },
                h('span', { className: 'dsh-todo-choice-head' },
                  h('span', { className: 'dsh-todo-choice-title' }, t('panel.style.' + entry.key)),
                  h('span', { className: 'dsh-todo-choice-mark' }, (plan.style ?? 'vivid') === entry.style ? '●' : ''),
                ),
                desc === '' ? null : h('span', { className: 'dsh-todo-choice-desc' }, desc),
              )
            }),
            h('div', { className: 'dsh-todo-setting-row' },
              h('span', { className: 'dsh-todo-setting-title', style: { marginBottom: 0 } }, t('panel.material')),
              h('button', {
                type: 'button',
                role: 'switch',
                className: 'dsh-todo-switch',
                'data-action': 'toggle-material',
                'aria-checked': plan.material ?? true,
                'aria-label': t('panel.material'),
                onClick: () => { props.handlers.setMaterial(!(plan.material ?? true)) },
              }, h('span', { className: 'dsh-todo-switch-knob' })),
            ),
            h('p', { className: 'dsh-todo-setting-hint' }, t('panel.material.desc')),
          ),
          h('div', { className: 'dsh-todo-setting' },
            h('div', { className: 'dsh-todo-setting-title' }, t('panel.notify')),
            NOTIFY_MODES.map(entry => h('button', {
              key: entry.mode,
              type: 'button',
              className: 'dsh-todo-choice',
              'data-action': 'notify-' + entry.mode,
              'aria-pressed': plan.notify === entry.mode,
              onClick: () => { props.handlers.setNotify(entry.mode) },
            },
              h('span', { className: 'dsh-todo-choice-head' },
                h('span', { className: 'dsh-todo-choice-title' }, t('panel.notify.' + entry.key)),
                h('span', { className: 'dsh-todo-choice-mark' }, plan.notify === entry.mode ? '●' : ''),
              ),
              h('span', { className: 'dsh-todo-choice-desc' }, t('panel.notify.' + entry.key + '.desc')),
            )),
            h('p', { className: 'dsh-todo-setting-hint' }, t('panel.notify.hint')),
            h('div', { className: 'dsh-todo-setting-row' },
              h('span', { className: 'dsh-todo-setting-title', style: { marginBottom: 0 } }, t('panel.notifyWindow')),
              h('input', {
                className: 'dsh-todo-input',
                type: 'number',
                min: 1,
                max: 600,
                value: windowDraft,
                'aria-label': t('panel.notifyWindow'),
                onChange: (event) => {
                  lastCommittedRef.current = plan.notifyWindow ?? 8
                  setWindowDraft(event.target.value)
                  setWindowError(undefined)
                },
                onBlur: commitWindow,
                onKeyDown: (event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitWindow() }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setWindowDraft(savedWindow)
                    setWindowError(undefined)
                  }
                },
                style: { width: 76 },
              }),
              h('span', { className: 'dsh-todo-setting-unit' }, t('panel.seconds')),
            ),
            h('p', { className: 'dsh-todo-setting-hint' }, t('panel.notifyWindow.desc')),
          ),
          h(ErrorBar, { message: windowError ?? props.view?.error }),
        )
      }

      function StatusScreen(props) {
        return h('div', { className: 'dsh-todo-empty' },
          h('div', { className: 'dsh-todo-empty-icon' }, props.icon ?? h(EmptyGlyph, {})),
          h('div', { className: 'dsh-todo-empty-title' }, props.title),
          h('div', { className: 'dsh-todo-empty-body' }, props.body),
          props.action === undefined ? null : h('button', {
            type: 'button',
            className: 'dsh-todo-action-button',
            'data-action': 'status-action',
            disabled: props.action.disabled === true,
            onClick: () => { props.action.onClick() },
          }, props.action.label),
          props.error === undefined ? null : h(ErrorBar, { message: props.error }),
        )
      }

      /** A thin line-art checklist for the empty state. */
      function EmptyGlyph() {
        const stroke = {
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.1,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }
        return h('svg', { width: 40, height: 40, viewBox: '0 0 40 40', 'aria-hidden': true },
          h('rect', { x: 7, y: 6, width: 26, height: 28, rx: 3, ...stroke }),
          h('path', { d: 'M12 14.5l1.8 1.8 3.2-3.4', ...stroke }),
          h('path', { d: 'M20.5 14.8h8', ...stroke }),
          h('path', { d: 'M12 22l1.8 1.8 3.2-3.4', ...stroke }),
          h('path', { d: 'M20.5 22.3h8', ...stroke }),
          h('path', { d: 'M20.5 29.5h5.5', ...stroke }),
        )
      }

      /**
       * The sentence the move bar shows for the pending reorder.
       * @param plan - the loaded plan.
       * @param move - `view.pendingMove`.
       * @returns the sentence, or an empty string.
       */
      function moveText(plan, move) {
        if (move === undefined) return ''
        const byId = new Map()
        for (const item of plan.items) {
          byId.set(item.id, item)
          for (const child of item.children ?? []) byId.set(child.id, child)
        }
        const name = id => byId.get(id)?.title ?? id
        if (move.kind === 'group') {
          const at = move.ids.indexOf(move.movedId)
          const title = plan.groups.find(group => group.id === move.movedId)?.title ?? move.movedId
          return fill(t('move.group'), { title, at: at < 0 ? move.ids.length : at + 1 })
        }
        const at = move.ids.indexOf(move.movedId)
        const previous = at > 0 ? move.ids[at - 1] : undefined
        const following = at >= 0 && at + 1 < move.ids.length ? move.ids[at + 1] : undefined
        const title = name(move.movedId)
        const sentence = previous !== undefined
          ? fill(t('move.after'), { a: title, b: name(previous) })
          : following !== undefined
            ? fill(t('move.before'), { a: title, b: name(following) })
            : fill(t('move.last'), { a: title })
        const stage = plan.groups.find(group => group.id === move.groupId)?.title
        const before = byId.get(move.movedId)?.groupId
        return stage === undefined || before === move.groupId
          ? sentence
          : sentence + fill(t('move.intoStage'), { stage })
      }

      /** The warning shown when the file holds rows the Host would reject. */
      function ProblemBar(props) {
        const problems = props.problems ?? []
        if (problems.length === 0) return null
        const shown = problems.slice(0, 3).join('；')
        return h('div', { role: 'alert', className: 'dsh-todo-problem' },
          h('div', { className: 'dsh-todo-problem-text' },
            t('problem.broken') + '：' + shown
            + (problems.length > 3 ? ` …（共 ${problems.length} 处）` : '')),
          h('button', {
            type: 'button', className: 'dsh-todo-action-button', 'data-action': 'repair',
            disabled: props.busy === true,
            onClick: () => { props.onRepair() },
          }, t('problem.repair')),
        )
      }

      /** The pending reorder, pinned to the bottom so it cannot scroll away. */
      function MoveBar(props) {
        return h('div', { className: 'dsh-todo-movebar', role: 'status', title: t('panel.moveAsk') },
          h('span', { className: 'dsh-todo-movebar-text' }, moveText(props.plan, props.move)),
          h('button', {
            type: 'button', className: 'dsh-todo-action-button', 'data-action': 'confirm-move',
            onClick: () => { props.handlers.confirmMove() },
          }, t('panel.confirmMove')),
          h('button', {
            type: 'button', className: 'dsh-todo-link', 'data-action': 'cancel-move',
            onClick: () => { props.handlers.cancelMove() },
          }, t('panel.cancelMove')),
        )
      }

      function ErrorBar(props) {
        if (props.message === undefined) return null
        return h('div', { role: 'alert', className: 'dsh-todo-error' },
          t('error.save') + '：' + props.message)
      }

      /**
       * The panel for one resolved state. Pure: no hooks, so the smoke check
       * renders it as well as the page.
       * @param props - `{ state, view, handlers, now }`.
       * @returns the panel tree.
       */
      /**
       * Layout animation for reordering: measure every row after a render,
       * invert the delta it just jumped, then let it play back to zero (FLIP).
       * Rows are found by `data-item`, so a move between stages animates too.
       */
      function useRowFlip(rootRef, orderKey, layoutKey, isDragging) {
        const previous = React.useRef(new Map())
        const previousOrderKey = React.useRef(orderKey)
        const first = React.useRef(true)
        React.useLayoutEffect(() => {
          if (isDragging) return
          const root = rootRef.current
          if (!root) return
          const orderChanged = previousOrderKey.current !== orderKey
          previousOrderKey.current = orderKey
          const reduced = typeof window !== 'undefined' && window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches
          const next = new Map()
          for (const node of root.querySelectorAll('[data-item]')) {
            const id = node.getAttribute('data-item')
            const top = node.getBoundingClientRect().top
            next.set(id, top)
            const before = previous.current.get(id)
            if (!orderChanged || before === undefined || Math.abs(before - top) < 1) continue
            if (first.current || reduced) continue
            node.style.transition = 'none'
            node.style.transform = `translateY(${before - top}px)`
            void node.offsetHeight
            node.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1)'
            node.style.transform = ''
          }
          previous.current = next
          first.current = false
        }, [orderKey, layoutKey, isDragging])
      }

      function PlanPanel(props) {
        const { state, handlers } = props
        const view = props.view ?? {}
        const rootRef = React.useRef(null)
        // Only the applied order drives the FLIP. Including the pending move
        // made a confirmed drag animate twice: once when the preview cleared and
        // once when the file watching re-read the new order.
        const orderKey = state.kind === 'ready'
          ? state.plan.items.map(item => `${item.id}:${item.groupId ?? ''}:${item.order}`).join('|')
          : ''
        const layoutKey = `${view.page ?? 'plan'}|${Boolean(view.hideCompleted ?? (state.kind === 'ready' ? state.plan.hideCompleted : false))}|${(view.collapsed ?? []).join(',')}|${(view.foldedChildren ?? []).join(',')}`
        useRowFlip(rootRef, orderKey, layoutKey, view.drag !== undefined)
        if (view.page === 'settings' && state.kind === 'ready') {
          return h(SettingsScreen, { state, handlers, view })
        }
        if (state.kind === 'noSession') return h(StatusScreen, { title: t('panel.title'), body: t('noWorkspace') })
        if (state.kind === 'missing') {
          return h(StatusScreen, {
            title: t('empty.title'),
            body: t('empty.body'),
            action: view.busy === true
              ? { label: t('panel.creating'), disabled: true, onClick: () => {} }
              : { label: t('panel.create'), onClick: () => { handlers.create() } },
            error: view.error,
          })
        }
        if (state.kind === 'invalid') {
          return h(StatusScreen, { title: t('error.title'), body: t('error.invalid') + '：' + state.message })
        }
        if (state.kind === 'error') return h(StatusScreen, { title: t('error.title'), body: state.message })
        if (state.kind === 'loading') return h(StatusScreen, { title: t('panel.title'), body: t('panel.loading') })

        const plan = state.plan
        const now = props.now ?? new Date()
        const map = new Map()
        for (const item of plan.items) {
          map.set(item.id, item)
          for (const child of item.children ?? []) map.set(child.id, child)
        }
        const total = plan.items.length
        const done = plan.items.filter(item => item.status === 'completed').length
        const hide = view.hideCompleted ?? plan.hideCompleted
        const baseGroups = plan.groups.slice().sort(byOrder)
        const groups = view.pendingMove?.kind === 'group'
          ? view.pendingMove.ids.map(id => baseGroups.find(group => group.id === id)).filter(group => group !== undefined)
          : baseGroups
        const groupIds = new Set(groups.map(group => group.id))
        const ungrouped = plan.items.filter(item => item.groupId === undefined || !groupIds.has(item.groupId))
        const visible = rows => hide ? rows.filter(item => item.status !== 'completed') : rows
        const byId = {
          map,
          totalByGroup: groupId => plan.items.filter(item => (item.groupId ?? '__none') === groupId).length,
          doneByGroup: groupId => plan.items.filter(item => (item.groupId ?? '__none') === groupId && item.status === 'completed').length,
        }
        const showUngrouped = ungrouped.length > 0
          || (view.pendingMove?.kind === 'item' && (view.pendingMove.groupId ?? '__none') === '__none')
        const sections = [
          ...groups.map((group, index) => ({
            group,
            index,
            rows: visible(plan.items.filter(item => item.groupId === group.id).sort(byOrder)),
          })),
          ...(!showUngrouped ? [] : [{
            group: { id: '__none', title: t('panel.stage'), mode: 'free' },
            index: groups.length,
            rows: visible(ungrouped.sort(byOrder)),
          }]),
        ]
        const completedAnywhere = plan.items.some(item => item.status === 'completed')
        const nextId = resolveNext(plan)
        const stageView = { ...view, nextId, hide }

        return h('div', {
          className: 'dsh-todo',
          ref: rootRef,
          'data-style': plan.style ?? 'vivid',
          'data-material': (plan.material ?? true) ? 'on' : 'off',
        },
          h('style', {}, STYLE),
          h('header', { className: 'dsh-todo-head' },
            h('span', { className: 'dsh-todo-title' }, plan.title || t('panel.untitled')),
            h('span', { className: 'dsh-todo-count dsh-todo-mono' },
              t('panel.done') + ' ' + String(done).padStart(2, '0') + '/' + String(total).padStart(2, '0')),
            h(IconButton, {
              name: 'sliders', title: t('panel.settings'), action: 'open-settings',
              onClick: () => { handlers.page('settings') },
            }),
            completedAnywhere
              ? h(IconButton, {
                name: hide ? 'eye-off' : 'eye',
                title: hide ? t('panel.showCompleted') : t('panel.hideCompleted'),
                action: 'toggle-hide',
                onClick: () => { handlers.toggleHide() },
              })
              : null,
          ),
          view.enabled === false
            ? h('div', { className: 'dsh-todo-offline', role: 'alert' },
              h('span', { className: 'dsh-todo-offline-mark' }, '!'),
              h('span', { className: 'dsh-todo-offline-text' }, t('panel.offline')),
            )
            : null,
          h(ProblemBar, {
            problems: state.problems,
            busy: view.busy === true,
            onRepair: () => { handlers.repair() },
          }),
          h(ErrorBar, { message: view.error }),
          sections.map(section => h(Stage, {
            key: section.group.id,
            group: section.group,
            rows: section.rows,
            byId,
            now,
            view: stageView,
            handlers,
            index: section.index,
          })),
          h(AddStage, { view, handlers }),
          h('div', { className: 'dsh-todo-foot dsh-todo-mono' },
            t('panel.file') + ' ' + (state.path ?? PLAN_FILE) + ' · rev ' + plan.rev),
          view.pendingMove === undefined
            ? null
            : h(MoveBar, { plan, move: view.pendingMove, handlers }),
        )
      }

      /**
       * The tab body: load and follow the plan file, own the inline-edit state,
       * and send every write through the Host command.
       * @param props - slot runtime props; `sessionId` names the workspace.
       * @returns the panel.
       */
      function TodoBody(props) {
        const sessionId = props.sessionId
        const [state, setState] = React.useState({ kind: 'loading' })
        const [hideCompleted, setHideCompleted] = React.useState(undefined)
        const [editing, setEditing] = React.useState(undefined)
        const [adding, setAdding] = React.useState(undefined)
        const [confirming, setConfirming] = React.useState(undefined)
        const [removing, setRemoving] = React.useState(undefined)
        const [dating, setDating] = React.useState(undefined)
        const [collapsed, setCollapsed] = React.useState([])
        const [foldedChildren, setFoldedChildren] = React.useState([])
        const [enabled, setEnabled] = React.useState(typeof sessionId === 'string' && sessionId !== '' ? getSessionSwitch(sessionId) : false)
        React.useEffect(() => {
          if (typeof sessionId !== 'string' || sessionId === '') return undefined
          setEnabled(getSessionSwitch(sessionId))
          return subscribeSessionSwitch((value, changedId) => {
            if (changedId === undefined || changedId === sessionId) setEnabled(value)
          })
        }, [sessionId])

        const readyHide = state.kind === 'ready' ? state.plan.hideCompleted : undefined
        const readyRev = state.kind === 'ready' ? state.plan.rev : undefined
        React.useEffect(() => {
          setHideCompleted(undefined)
        }, [readyHide, readyRev])

        // The completion animation belongs to a real state change, not to a
        // mount: reordering rows or leaving the settings page remounts nodes, and
        // replaying the check burst there is wrong. Compare statuses instead.
        const seenStatus = React.useRef(undefined)
        const [flashIds, setFlashIds] = React.useState([])
        React.useEffect(() => {
          if (state.kind !== 'ready') {
            seenStatus.current = undefined
            setFlashIds([])
            return undefined
          }
          const next = new Map()
          for (const item of state.plan.items) {
            next.set(item.id, item.status)
            for (const child of item.children ?? []) next.set(child.id, child.status)
          }
          const before = seenStatus.current
          seenStatus.current = next
          if (before === undefined) return undefined
          const justDone = []
          for (const [id, status] of next) {
            const previous = before.get(id)
            if (status === 'completed' && previous !== undefined && previous !== 'completed') justDone.push(id)
          }
          if (justDone.length === 0) return undefined
          setFlashIds(justDone)
          const timer = setTimeout(() => { setFlashIds([]) }, 900)
          return () => clearTimeout(timer)
        }, [state])
        const [page, setPage] = React.useState('plan')
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState(undefined)
        const [drag, setDrag] = React.useState(undefined)
        const [dropTarget, setDropTarget] = React.useState(undefined)
        const [pendingMove, setPendingMove] = React.useState(undefined)

        React.useEffect(() => {
          if (pendingMove === undefined) return undefined
          const timer = setTimeout(() => { setPendingMove(undefined) }, 6000)
          return () => clearTimeout(timer)
        }, [pendingMove])

        React.useEffect(() => {
          if (sessionId === undefined) {
            setState({ kind: 'noSession' })
            return undefined
          }
          let alive = true
          const controller = new AbortController()
          let timer
          let currentPath

          const readAt = path => ctx.remote.workspaceFiles.read(sessionId, path, {}, controller.signal)

          /** Find the plan file: the remembered path, then the root, then anywhere in the workspace. */
          const locate = async () => {
            const remembered = currentPath
            if (remembered !== undefined) {
              const hit = await readAt(remembered)
              if (hit.ok || hit.error?.code !== 'workspace-file/not-found') return { path: remembered, result: hit }
            }
            const root = await readAt(PLAN_FILE)
            if (root.ok || root.error?.code !== 'workspace-file/not-found') return { path: PLAN_FILE, result: root }
            let found
            try {
              found = await ctx.remote.workspaceFiles.search(sessionId, {
                query: PLAN_FILE, excludedPaths: [], includeHidden: false, respectGitignore: false,
              }, controller.signal)
            } catch {
              return { path: PLAN_FILE, result: root }
            }
            if (!found.ok) return { path: PLAN_FILE, result: root }
            const located = pickPlanPath(found.value.matches)
            if (located === undefined || located === PLAN_FILE) return { path: PLAN_FILE, result: root }
            return { path: located, result: await readAt(located) }
          }

          const load = async () => {
            let located
            try {
              located = await locate()
            } catch (failure) {
              if (alive) setState({ kind: 'error', message: String(failure?.message ?? failure) })
              return
            }
            if (!alive) return
            const result = located.result
            if (!result.ok) {
              const code = result.error?.code ?? 'unknown'
              setState(code === 'workspace-file/not-found'
                ? { kind: 'missing' }
                : { kind: 'error', message: `${code}${result.error?.message ? '：' + result.error.message : ''}` })
              return
            }
            let parsed
            try {
              parsed = JSON.parse(result.value.text)
            } catch (failure) {
              setState({ kind: 'invalid', message: 'JSON 解析失败：' + failure.message })
              return
            }
            const normalized = normalizePlan(parsed)
            if (!normalized.ok) {
              setState({ kind: 'invalid', path: located.path, message: normalized.message })
              return
            }
            currentPath = located.path
            setFoldedChildren(readFolded(located.path))
            setState({
              kind: 'ready',
              plan: normalized.plan,
              path: located.path,
              absolutePath: result.value.absolutePath,
              problems: planProblems(parsed),
            })
            watch(located.path)
          }

          const streams = new Map()
          const watch = path => {
            if (streams.has(path)) return
            let stream
            try {
              stream = ctx.remote.$stream({
                name: `plan ${path}`,
                open: lifetime => ctx.remote.workspaceFiles.changes(sessionId, path, lifetime),
                ended: () => new Error(`plan watch ended: ${path}`),
              })
            } catch {
              return
            }
            streams.set(path, stream)
            controller.signal.addEventListener('abort', () => { void stream.dispose() }, { once: true })
            ;(async () => {
              for await (const frame of stream) {
                if (frame.value.kind === 'ready') frame.accept()
                else if (alive) schedule()
              }
            })().catch(() => {})
          }

          const schedule = () => {
            clearTimeout(timer)
            timer = setTimeout(() => { void load() }, REFRESH_DELAY_MS)
          }

          watch(PLAN_FILE)
          void load()

          return () => {
            alive = false
            clearTimeout(timer)
            controller.abort()
          }
        }, [sessionId])

        /** Read the command outcome as either text or undefined. */
        const failureOf = outcome => outcome?.ok === false
          ? (outcome.error?.message ?? '命令调用失败')
          : (outcome?.value?.kind === 'error' ? outcome.value.text : undefined)

        const queueRef = React.useRef(Promise.resolve())
        const pendingCountRef = React.useRef(0)
        const pathRef = React.useRef(undefined)
        pathRef.current = state.absolutePath
        const dropTargetRef = React.useRef(undefined)

        const enqueueWrite = (fn) => {
          pendingCountRef.current += 1
          setBusy(true)
          setError(undefined)
          const task = queueRef.current.then(fn, fn)
          queueRef.current = task.catch(() => {}).finally(() => {
            pendingCountRef.current -= 1
            if (pendingCountRef.current === 0) setBusy(false)
          })
          return task
        }

        /**
         * Send one operation through the Host command. The panel never edits
         * its own copy: the write lands, and the file watch re-reads it.
         * @param op - the operation to apply.
         */
        const send = (op) => {
          if (pathRef.current === undefined) { setError('还没有读到计划文件'); return Promise.resolve() }
          return enqueueWrite(async () => {
            const path = pathRef.current
            if (path === undefined) { setError('还没有读到计划文件'); return }
            try {
              const run = payload => ctx.remote.commands.execute(sessionId, '/todo op ' + JSON.stringify(payload), [])
              let failure = failureOf(await run({ path, op }))
              if (failure !== undefined && failure.includes('不认识的操作')) {
                // Bridge for a host that predates the nested `{ path, op }` form:
                // resend with the operation fields beside `path`.
                failure = failureOf(await run({ path, ...op }))
              }
              if (failure !== undefined) setError(failure)
            } catch (failure) {
              setError(String(failure?.message ?? failure))
            }
          })
        }

        /** Create a plan file at the workspace root; the watch then loads it. */
        const sendCreate = () => enqueueWrite(async () => {
          try {
            const line = '/todo op ' + JSON.stringify({ op: { op: 'create' } })
            const failure = failureOf(await ctx.remote.commands.execute(sessionId, line, []))
            if (failure !== undefined) setError(failure)
          } catch (failure) {
            setError(String(failure?.message ?? failure))
          }
        })

        const handlers = {
          cycle(item) {
            // The panel owns one bit: done or not done. "In progress" is the
            // agent's call, so a click on a running item simply finishes it.
            void send({ op: 'status', id: item.id, status: item.status === 'completed' ? 'pending' : 'completed' })
          },
          startRename(item) { setEditing({ id: item.id, value: item.title }) },
          setEditValue(value) { setEditing(current => current === undefined ? current : { ...current, value }) },
          commitRename() {
            if (editing === undefined) return
            const value = editing.value.trim()
            const original = findItem(state, editing.id)
            setEditing(undefined)
            if (value === '' || original === undefined || value === original.title) return
            void send({ op: 'rename', id: editing.id, title: value })
          },
          cancelEdit() { setEditing(undefined) },
          startAdd(groupId) { setAdding({ kind: 'item', groupId, value: '' }) },
          startAddChild(item) { setAdding({ kind: 'child', parentId: item.id, value: '' }) },
          startAddStage() { setAdding({ kind: 'group', value: '' }) },
          setAddValue(value) { setAdding(current => current === undefined ? current : { ...current, value }) },
          commitAdd() {
            if (adding === undefined) return
            const value = adding.value.trim()
            const current = adding
            setAdding(undefined)
            if (value === '') return
            if (current.kind === 'group') { void send({ op: 'addGroup', title: value }); return }
            void send(current.kind === 'child'
              ? { op: 'addChild', parentId: current.parentId, title: value }
              : { op: 'add', groupId: current.groupId === '__none' ? undefined : current.groupId, title: value })
          },
          cancelAdd() { setAdding(undefined) },
          startDate(item) { setDating(item.id) },
          cancelDate() { setDating(undefined) },
          toggleGroup(groupId) {
            setCollapsed(current => current.includes(groupId)
              ? current.filter(id => id !== groupId)
              : [...current, groupId])
          },
          toggleChildren(item) {
            const next = foldedChildren.includes(item.id)
              ? foldedChildren.filter(id => id !== item.id)
              : [...foldedChildren, item.id]
            setFoldedChildren(next)
            if (state.kind === 'ready') writeFolded(state.path, next)
          },
          repair() { void send({ op: 'repair' }) },
          page(value) { setPage(value) },
          setNotify(mode) {
            void send({ op: 'settings', notify: mode })
          },
          setStyle(style) {
            void send({ op: 'settings', style })
          },
          setMaterial(material) {
            void send({ op: 'settings', material: material === true })
          },
          setNotifyWindow(seconds) {
            void send({ op: 'settings', notifyWindow: seconds })
          },
          dragStart(kind, id, event) {
            dropTargetRef.current = undefined
            setDropTarget(undefined)
            setDrag({ kind, id })
            try {
              event.dataTransfer?.setData('text/plain', id)
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            } catch {
              // A drag without a data transfer still reorders inside the panel.
            }
          },
          dragOver(kind, id, event) {
            if (drag === undefined) return
            // A row already claimed this drag (it drew the insertion line); the
            // container must not overwrite that with "append to the stage".
            if (kind === 'stage' && event?.defaultPrevented === true) return
            const setDropHint = (nextTarget) => {
              const prev = dropTargetRef.current
              if (prev?.kind === nextTarget?.kind && prev?.id === nextTarget?.id && prev?.before === nextTarget?.before) return
              dropTargetRef.current = nextTarget
              setDropTarget(nextTarget)
            }
            const computeBefore = (targetKind, targetId) => {
              const rect = event.currentTarget?.getBoundingClientRect?.()
              if (rect === undefined) return true
              const mid = rect.top + rect.height / 2
              const prev = dropTargetRef.current
              if (prev !== undefined && prev.kind === targetKind && prev.id === targetId) {
                if (event.clientY < mid - 3) return true
                if (event.clientY > mid + 3) return false
                return prev.before
              }
              return event.clientY < mid
            }
            if (kind === 'group') {
              if (drag.kind !== 'group' || drag.id === id) return
              event.preventDefault()
              setDropHint({ kind: 'group', id, before: computeBefore('group', id) })
              return
            }
            if (drag.kind !== 'item') return
            event.preventDefault()
            if (kind === 'item') {
              if (drag.id === id) return
              setDropHint({ kind: 'item', id, before: computeBefore('item', id) })
            } else if (kind === 'stage') {
              setDropHint({ kind: 'stage', id })
            }
          },
          drop(event) {
            event.preventDefault()
            const moving = drag
            const hint = dropTargetRef.current ?? dropTarget
            dropTargetRef.current = undefined
            setDrag(undefined)
            setDropTarget(undefined)
            if (moving === undefined || hint === undefined || state.kind !== 'ready') return
            if (moving.kind === 'group') {
              const groups = state.plan.groups.slice().sort(byOrder)
              const ids = groups.map(group => group.id).filter(id => id !== moving.id)
              const at = hint.kind === 'group' ? ids.indexOf(hint.id) : -1
              const index = at < 0 ? ids.length : (hint.before ? at : at + 1)
              ids.splice(index, 0, moving.id)
              setPendingMove({ kind: 'group', ids, movedId: moving.id })
              return
            }
            const dragged = findItem(state, moving.id)
            if (dragged === undefined) return
            const targetGroupId = (hint.kind === 'item'
              ? findItem(state, hint.id)?.groupId
              : hint.id) ?? '__none'
            const rows = state.plan.items
              .filter(candidate => (candidate.groupId ?? '__none') === targetGroupId)
              .sort(byOrder)
            const ids = rows.map(candidate => candidate.id).filter(id => id !== moving.id)
            const at = hint.kind === 'item' ? ids.indexOf(hint.id) : -1
            const index = at < 0 ? ids.length : (hint.before ? at : at + 1)
            ids.splice(index, 0, moving.id)
            setPendingMove({ kind: 'item', groupId: targetGroupId, ids, movedId: moving.id })
          },
          dragEnd() {
            dropTargetRef.current = undefined
            setDrag(undefined)
            setDropTarget(undefined)
          },
          confirmMove() {
            if (pendingMove === undefined) return
            const move = pendingMove
            setPendingMove(undefined)
            if (move.kind === 'group') {
              void send({ op: 'reorderGroups', ids: move.ids })
              return
            }
            void send({
              op: 'reorder',
              ids: move.ids,
              groupId: move.groupId === '__none' || move.groupId === undefined ? null : move.groupId,
            })
          },
          cancelMove() { setPendingMove(undefined) },
          create() { void sendCreate() },
          startDelete(item) { setConfirming(item.id) },
          confirmDelete(item) {
            setConfirming(undefined)
            // Let the row collapse before the file watch drops it: the write is
            // fast, but the animation starts on this render either way.
            setRemoving(item.id)
            const timer = setTimeout(() => { setRemoving(undefined) }, 400)
            void Promise.resolve(send({ op: 'remove', id: item.id }))
              .catch(() => {})
              .finally(() => { clearTimeout(timer); setRemoving(undefined) })
          },
          cancelDelete() { setConfirming(undefined) },
          setDue(item, value) {
            void send({ op: 'due', id: item.id, due: value === '' ? null : value })
          },
          toggleHide() {
            const hide = hideCompleted ?? (state.kind === 'ready' ? state.plan.hideCompleted : false)
            setHideCompleted(!hide)
            void send({ op: 'settings', hideCompleted: !hide })
          },
        }

        return h(PlanPanel, {
          state,
          view: {
            editing, adding, confirming, dating, collapsed, foldedChildren, enabled, page, busy, error, hideCompleted,
            drag, dropTarget, pendingMove, flashIds, removing,
          },
          handlers,
          now: new Date(),
        })
      }

      /** Find one item or child by id in the loaded plan. */
      function findItem(state, id) {
        if (state.kind !== 'ready') return undefined
        for (const item of state.plan.items) {
          if (item.id === id) return item
          for (const child of item.children ?? []) if (child.id === id) return child
        }
        return undefined
      }

      /** The `/todo` row is noise; render the collapse marker instead. */
      function HiddenCommandRow() {
        return h('span', { 'data-dsh-todo-quiet': '' }, h('style', {}, QUIET_STYLE))
      }

      function OpenChip(props) {
        const sessionId = props.sessionId
        const knownPath = React.useRef(undefined)
        const [on, setOn] = React.useState(typeof sessionId === 'string' && sessionId !== '' ? getSessionSwitch(sessionId) : false)
        React.useEffect(() => {
          if (typeof sessionId !== 'string' || sessionId === '') return undefined
          const current = getSessionSwitch(sessionId)
          setOn(current)
          // Host starts every Session switched off; only push when the user
          // previously switched it on, avoiding extra /todo rows on idle chats.
          if (current === true) pushSessionSwitch(sessionId, true)
          return subscribeSessionSwitch((value, changedId) => {
            if (changedId === undefined || changedId === sessionId) setOn(value)
          })
        }, [sessionId])
        React.useEffect(() => {
          knownPath.current = undefined
          if (sessionId === undefined) return undefined
          let alive = true
          let seen
          let timer
          const controller = new AbortController()
          const streams = new Map()
          const read = path => ctx.remote.workspaceFiles.read(sessionId, path, {}, controller.signal)
          const watch = path => {
            if (streams.has(path)) return
            let stream
            try {
              stream = ctx.remote.$stream({
                name: `plan-open ${path}`,
                open: lifetime => ctx.remote.workspaceFiles.changes(sessionId, path, lifetime),
                ended: () => new Error(`plan watch ended: ${path}`),
              })
            } catch {
              return
            }
            streams.set(path, stream)
            controller.signal.addEventListener('abort', () => { void stream.dispose() }, { once: true })
            ;(async () => {
              for await (const frame of stream) {
                if (frame.value.kind === 'ready') frame.accept()
                else if (alive) {
                  clearTimeout(timer)
                  timer = setTimeout(() => { void check() }, 120)
                }
              }
            })().catch(() => {})
          }
          const locate = async () => {
            const known = knownPath.current
            if (known !== undefined) {
              const hit = await read(known)
              if (hit.ok) return { path: known, result: hit }
            }
            const root = await read(PLAN_FILE)
            if (root.ok || root.error?.code !== 'workspace-file/not-found') return { path: PLAN_FILE, result: root }
            let found
            try {
              found = await ctx.remote.workspaceFiles.search(sessionId, {
                query: PLAN_FILE, excludedPaths: [], includeHidden: false, respectGitignore: false,
              }, controller.signal)
            } catch {
              return { path: PLAN_FILE, result: root }
            }
            if (!found.ok) return { path: PLAN_FILE, result: root }
            const located = pickPlanPath(found.value.matches)
            if (located === undefined) return { path: PLAN_FILE, result: root }
            return { path: located, result: await read(located) }
          }
          const check = async () => {
            const located = await locate()
            if (!alive || !located.result.ok) return
            knownPath.current = located.path
            watch(located.path)
            let parsed
            try {
              parsed = JSON.parse(located.result.value.text)
            } catch {
              return
            }
            const request = Number.isInteger(parsed?.ui?.openRequest) ? parsed.ui.openRequest : 0
            if (seen === undefined) {
              seen = request
              return
            }
            if (request > seen) {
              seen = request
              ctx.sidebarRight.openTab(KIND)
            }
          }
          watch(PLAN_FILE)
          void check()
          return () => {
            alive = false
            clearTimeout(timer)
            controller.abort()
          }
        }, [sessionId])

        return h('span', { className: 'dsh-todo-composer' },
          h('style', {}, CHIP_STYLE),
          h('div', { className: 'dsh-todo-chipwrap' },
          h('button', {
            type: 'button',
            title: t('chip.hint'),
            className: 'dsh-todo-chip-open',
            'data-action': 'open-panel',
            onClick: () => { ctx.sidebarRight.openTab(KIND) },
          },
            h(TodoGlyph, { size: 13 }),
            t('chip.open'),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            className: 'dsh-todo-switch',
            'data-action': 'toggle-session',
            'aria-checked': on,
            title: on ? t('chip.on') : t('chip.off'),
            'aria-label': t('chip.switchAria'),
            onClick: () => {
              const next = !on
              setSessionSwitch(sessionId, next)
              pushSessionSwitch(sessionId, next)
              setOn(next)
            },
          }, h('span', { className: 'dsh-todo-switch-knob' })),
          ),
        )
      }

      return { TodoBody, PlanPanel, OpenChip, HiddenCommandRow }
    }

    const plugin = {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles', 'remote.commands'],

      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-todo: dictionaries')

        const ui = buildUi(ctx)

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: ID,
          kind: KIND,
          priority: 'extension',
          title: () => ctx.locale.bind(NS)('type.label'),
          guide: [{
            id: 'plan',
            order: 30,
            title: () => ctx.locale.bind(NS)('guide.title'),
            description: () => ctx.locale.bind(NS)('guide.description'),
            icon: TodoGlyph,
          }],
        }), 'dsh-todo: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: ID, locale: NS },
          ui.TodoBody,
        )), 'dsh-todo: tab body')

        // Keep the panel's own write channel out of the transcript: the command
        // row for `todo` renders nothing (other commands are untouched).
        ctx.effect(() => ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
          { name: 'conversation.chat.commandview', key: 'todo', locale: NS },
          ui.HiddenCommandRow,
        )), 'dsh-todo: hidden command row')

        // Temporary entry: one click from the composer. The assistant tool will
        // replace it once the model-facing side lands.
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'dsh-todo-open', order: 40, locale: NS },
          ui.OpenChip,
        )), 'dsh-todo: composer chip')
      },
    }

    // The smoke check renders the panel without React; the page never sets this flag.
    if (globalThis.__DSH_TODO_TEST__) plugin.__test = { buildUi, normalizePlan, pickPlanPath, planProblems }
    return plugin
  },
})
