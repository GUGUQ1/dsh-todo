/**
 * Smoke check for the browser half.
 *
 * Loads `client.js` the way the DSH page does (a `window.__ModuleLoader__.load`
 * call), runs `apply` against fake services, then renders the panel from three
 * resolved states. It catches the failures a page reload would show as a blank
 * slot: a throwing factory, a registration that needs a service we do not
 * inject, a panel that throws on data it did not expect.
 *
 * It does not verify what the page actually draws — that still needs the real
 * console.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

/** Collected registrations, filled by the fake services below. */
const registered = { tabTypes: [], slots: [] }

/** Minimal React stand-in: elements are plain objects, so components stay callable. */
const React = {
  createElement(type, props, ...children) {
    const flat = children.flat()
    return {
      type,
      props: { ...(props ?? {}), ...(flat.length === 0 ? {} : { children: flat.length === 1 ? flat[0] : flat }) },
      children: flat,
    }
  },
  useState(initial) { return [initial, () => {}] },
  useRef(initial) { return { current: initial } },
  useEffect() {},
  useLayoutEffect() {},
}

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded = module
    },
  },
}
globalThis.__DSH_TODO_TEST__ = true

await import('../client.js')
assert.ok(loaded, 'client.js must call window.__ModuleLoader__.load')
assert.equal(loaded.id, pkg.name, 'client module id must equal the package name')

const mod = loaded.factory(specifier => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require("${specifier}")`)
})

const dicts = {}
const t = key => dicts[dictionaryNS]?.[key] ?? key
let dictionaryNS = 'todoPanel'

const ctx = {
  effect(fn, label) {
    const dispose = fn()
    assert.ok(dispose === undefined || typeof dispose === 'function', `effect ${label} must return a disposer or nothing`)
  },
  locale: {
    register(ns, dictionaries) {
      dictionaryNS = ns
      dicts[ns] = dictionaries.zh
    },
    bind() {
      return t
    },
  },
  sidebarRightTabs: {
    register(definition) {
      registered.tabTypes.push(definition)
    },
  },
  sidebarRight: {
    openTab(kind) {
      registered.opened = kind
    },
  },
  slots: {
    inject(owner, register) {
      return register()
    },
    register(options, component) {
      registered.slots.push({ options, component })
    },
  },
  remote: {
    workspaceFiles: {
      read: async () => ({ ok: false, error: { code: 'workspace-file/not-found' } }),
      changes: async function* () {},
    },
    $stream: () => ({
      async *[Symbol.asyncIterator]() {},
      dispose: async () => {},
    }),
    commands: {
      execute: async () => ({ ok: true, value: { kind: 'success', text: '已保存' } }),
    },
  },
}
ctx['remote.workspaceFiles'] = ctx.remote.workspaceFiles
ctx['remote.commands'] = ctx.remote.commands

for (const service of mod.inject) {
  assert.ok(service in ctx, `inject "${service}" has no fake service in this check`)
}

mod.apply(ctx)

assert.equal(registered.tabTypes.length, 1, 'one tab type')
const definition = registered.tabTypes[0]
assert.equal(definition.id, pkg.name)
assert.equal(definition.kind, 'todo')
assert.equal(typeof definition.title(), 'string')
assert.ok(definition.guide?.length >= 1, 'the type offers a guide entry')

const slotNames = registered.slots.map(entry => entry.options.name).sort()
assert.deepEqual(slotNames, ['conversation.chat.commandview', 'conversation.composer.dock', 'sidebar.right.pane.tab'])
const commandRow = registered.slots.find(entry => entry.options.name === 'conversation.chat.commandview')
assert.equal(commandRow.options.key, 'todo', 'only the todo command row is specialized')
const quiet = commandRow.component({})
assert.equal(quiet.props['data-dsh-todo-quiet'], '', 'the todo row renders a collapse marker')
assert.ok(JSON.stringify(quiet).includes('flowItem'), 'the marker carries the collapsing rule')

/** Render an element tree far enough to run every function component. */
function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type(node.props))
  return { type: node.type, props: node.props, children: render(node.children) }
}

/** Flatten the text a rendered tree would show. */
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return text(node.children)
}

const { buildUi, normalizePlan } = mod.__test
const ui = buildUi(ctx)

const samplePlan = {
  version: 1,
  rev: 7,
  title: '测试计划',
  ui: { hideCompleted: false, openRequest: 0 },
  groups: [{ id: 'g1', title: '第一段', mode: 'sequence', order: 1 }],
  items: [
    { id: 'a', groupId: 'g1', order: 1, title: '已完成的事', status: 'completed' },
    {
      id: 'b', groupId: 'g1', order: 2, title: '进行中的事', status: 'in_progress',
      after: ['a'], due: '2026-11-25',
      children: [{ id: 'b1', title: '子项', status: 'pending' }],
    },
    { id: 'c', groupId: 'g1', order: 3, title: '下一步的事', status: 'pending', after: ['b'] },
  ],
}
const normalized = normalizePlan(samplePlan)
assert.equal(normalized.ok, true)

/** Handlers the panel calls; the check records what it asked for. */
const calls = []
const handlers = {
  cycle: item => calls.push(['cycle', item.id]),
  startRename: item => calls.push(['rename', item.id]),
  setEditValue() {}, commitRename() {}, cancelEdit() {},
  startAdd: groupId => calls.push(['add', groupId]),
  startAddChild: item => calls.push(['addChild', item.id]),
  setAddValue() {}, commitAdd() {}, cancelAdd() {},
  startDelete: item => calls.push(['delete', item.id]),
  confirmDelete() {}, cancelDelete() {},
  move: (item, delta) => calls.push(['move', item.id, delta]),
  setDue: (item, value) => calls.push(['due', item.id, value]),
  toggleHide: () => calls.push(['toggleHide']),
  toggleGroup: groupId => calls.push(['fold', groupId]),
  toggleChildren: item => calls.push(['foldChildren', item.id]),
  repair: () => calls.push(['repair']),
  confirmMove: () => calls.push(['confirmMove']),
  cancelMove: () => calls.push(['cancelMove']),
  setNext: item => calls.push(['next', item.id]),
  setNotify: mode => calls.push(['notify', mode]),
  setStyle: style => calls.push(['style', style]),
  setMaterial: material => calls.push(['material', material]),
  page: value => calls.push(['page', value]),
  startDate: item => calls.push(['startDate', item.id]),
  cancelDate() {},
  startAddStage: () => calls.push(['addStage']),
  create: () => calls.push(['create']),
}

const now = new Date(2026, 10, 21, 12, 0, 0)
const ready = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { hideCompleted: false },
  handlers,
  now,
}))
const shown = text(ready)
assert.ok(shown.includes('测试计划'), 'header shows the plan title')
assert.ok(shown.includes('完成 01/03'), 'header shows top-level progress')
assert.ok(shown.includes('第一段'), 'a group renders')
assert.ok(shown.includes('依次'), 'the group mode renders')
assert.ok(shown.includes('进行中的事'), 'items render')
assert.ok(shown.includes('子项'), 'child items render')
assert.ok(shown.includes('11-25'), 'a due date renders')
assert.ok(shown.includes('rev 7'), 'the footer shows the revision')
assert.ok(shown.includes('添加事项'), 'each stage offers an add row')

/** Collect every rendered element that carries one attribute. */
function findAll(node, name, found = []) {
  if (Array.isArray(node)) { node.forEach(child => findAll(child, name, found)); return found }
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (node.props !== undefined && node.props[name] !== undefined) found.push(node)
  return findAll(node.children, name, found)
}

const dots = findAll(ready, 'data-action').filter(node => node.props['data-action'] === 'cycle')
assert.equal(dots.length, 4, 'one cycle control per item and child')
assert.equal(dots[0].props.title, '标记为未完成', 'a completed row offers to reopen')
assert.equal(dots.find(node => node.props['data-status'] === 'in_progress').props.title, '标记为完成',
  'a running row is finished with one click, not cycled further')
dots[0].props.onClick({ stopPropagation() {} })
assert.deepEqual(calls[0], ['cycle', 'a'], 'clicking a dot cycles that item')

const deleteButtons = findAll(ready, 'data-action').filter(node => node.props['data-action'] === 'delete')
assert.ok(deleteButtons.length >= 2, 'rows offer a delete control')

const addButtons = findAll(ready, 'data-action').filter(node => node.props['data-action'] === 'add-item')
assert.ok(addButtons.length >= 1, 'an add control exists')
addButtons[0].props.onClick()
assert.deepEqual(calls.at(-1), ['add', 'g1'], 'the add control targets its stage')

const foldButtons = findAll(ready, 'data-action').filter(node => node.props['data-action'] === 'fold-stage')
assert.equal(foldButtons.length, 1, 'a stage folds')
foldButtons[0].props.onClick()
assert.deepEqual(calls.at(-1), ['fold', 'g1'], 'folding asks for that stage')

assert.ok(findAll(ready, 'data-action').some(node => node.props['data-action'] === 'add-stage'), 'stages can be added')
assert.ok(findAll(ready, 'data-action').some(node => node.props['data-action'] === 'set-due'), 'a row without a date offers one')
assert.ok(findAll(ready, 'data-action').some(node => node.props['data-action'] === 'clear-due'), 'a row with a date can clear it')

const creating = text(render(React.createElement(ui.PlanPanel, { state: { kind: 'missing' }, view: {}, handlers })))
assert.ok(creating.includes('创建计划'), 'the empty state offers to create the plan')

assert.ok(shown.includes('进行中'), 'the focus block names the current item')
assert.ok(shown.includes('下一步'), 'the focus block names the next item')
assert.ok(findAll(ready, 'data-action').some(node => node.props['data-action'] === 'open-settings'), 'the header offers settings')

const settings = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: { ...normalized.plan, notify: 'wake' } },
  view: { page: 'settings' },
  handlers,
  now,
}))
const settingsText = text(settings)
assert.ok(settingsText.includes('通知方式'), 'the settings page shows the notify group')
const choices = findAll(settings, 'data-action').filter(node => String(node.props['data-action']).startsWith('notify-'))
assert.equal(choices.length, 3, 'three notify modes are offered')
const wake = choices.find(node => node.props['data-action'] === 'notify-wake')
assert.equal(wake.props['aria-pressed'], true, 'the saved mode is the pressed one')
wake.props.onClick()
assert.deepEqual(calls.at(-1), ['notify', 'wake'], 'picking a mode asks for it')

const back = findAll(settings, 'data-action').find(node => node.props['data-action'] === 'back-to-plan')
back.props.onClick({ stopPropagation() {} })
assert.deepEqual(calls.at(-1), ['page', 'plan'], 'the back control returns to the plan')

// Appearance: four looks plus an independent materials switch.
const styleChoices = findAll(settings, 'data-action').filter(node => String(node.props['data-action']).startsWith('style-'))
assert.equal(styleChoices.length, 4, 'all four looks are offered')
assert.equal(styleChoices.find(node => node.props['data-action'] === 'style-vivid').props['aria-pressed'], true,
  'vivid is the pressed default')
styleChoices.find(node => node.props['data-action'] === 'style-md3').props.onClick()
assert.deepEqual(calls.at(-1), ['style', 'md3'], 'picking md3 asks for it')
styleChoices.find(node => node.props['data-action'] === 'style-calm').props.onClick()
assert.deepEqual(calls.at(-1), ['style', 'calm'], 'picking a look asks for it')
const materialSwitch = findAll(settings, 'data-action').find(node => node.props['data-action'] === 'toggle-material')
assert.equal(materialSwitch.props['aria-checked'], true, 'materials are on by default')
materialSwitch.props.onClick()
assert.deepEqual(calls.at(-1), ['material', false], 'the materials switch asks for the opposite')
assert.equal(findAll(ready, 'data-style')[0].props['data-style'], 'vivid', 'the panel carries its look')
assert.equal(findAll(ready, 'data-material')[0].props['data-material'], 'on', 'the panel carries the materials flag')

const hidden = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { hideCompleted: true },
  handlers,
  now,
}))
assert.ok(!text(hidden).includes('已完成的事'), 'hideCompleted drops completed rows')
assert.ok(text(hidden).includes('1/3'), 'the stage count still counts hidden rows')

// The focus strip names the current and next item in both states; only the row
// tag that used to duplicate it is gone.
assert.ok(shown.includes('进行中'), 'the focus strip is there while the stage is expanded')
const collapsedStage = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { collapsed: ['g1'] },
  handlers,
  now,
}))
assert.ok(text(collapsedStage).includes('进行中'), 'the focus strip survives folding the stage')

const foldChildren = findAll(ready, 'data-action').filter(node => node.props['data-action'] === 'fold-children')
assert.equal(foldChildren.length, 1, 'a parent with children offers a fold control')
foldChildren[0].props.onClick({ stopPropagation() {} })
assert.deepEqual(calls.at(-1), ['foldChildren', 'b'], 'folding asks for that parent')

const folded = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { foldedChildren: ['b'] },
  handlers,
  now,
}))
// Children stay mounted inside a collapsing grid row so the height can animate;
// "folded" is expressed by data-open, not by removing the nodes, and inert keeps focus out.
const foldedChildrenBox = findAll(folded, 'className')
  .find(node => String(node.props.className).includes('dsh-todo-children'))
assert.equal(foldedChildrenBox.props['data-open'], undefined, 'a folded parent keeps its children collapsed')
assert.equal(foldedChildrenBox.props.inert, '', 'a folded parent sets inert on collapsed children')
const openChildrenBox = findAll(ready, 'className')
  .find(node => String(node.props.className).includes('dsh-todo-children'))
assert.equal(openChildrenBox.props['data-open'], '', 'an open parent marks its children open')
assert.equal(openChildrenBox.props.inert, undefined, 'an open parent does not mark children inert')
assert.ok(text(folded).includes('+1'), 'a folded parent says how many children it hides')

const moving = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { pendingMove: { kind: 'item', groupId: 'g1', ids: ['b', 'a'], movedId: 'a' } },
  handlers,
  now,
}))
assert.equal(
  findAll(moving, 'data-action').filter(node => node.props['data-action'] === 'confirm-move').length, 1,
  'the move confirmation renders once, not per stage',
)
assert.ok(text(moving).includes('把「已完成的事」移到「进行中的事」之后'), 'the move bar names the drop position')
findAll(moving, 'data-action').find(node => node.props['data-action'] === 'confirm-move').props.onClick()
assert.deepEqual(calls.at(-1), ['confirmMove'], 'confirming the move asks the panel to save it')

const broken = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan, problems: ['第 22 项 缺标题'] },
  view: {},
  handlers,
  now,
}))
assert.ok(text(broken).includes('计划文件有问题'), 'a file the host would reject says so up front')
assert.ok(text(broken).includes('第 22 项 缺标题'), 'the banner names the broken row')
findAll(broken, 'data-action').find(node => node.props['data-action'] === 'repair').props.onClick()
assert.deepEqual(calls.at(-1), ['repair'], 'the banner offers to repair the file')

const { planProblems } = mod.__test
assert.deepEqual(planProblems(samplePlan), [], 'a valid plan reports no problems')
assert.ok(planProblems({
  version: 1, rev: 1, ui: {}, groups: [{ id: 'g', title: 'G', mode: 'free' }],
  items: [{ id: 'x', groupId: 'g', title: '', status: 'pending' }],
}).some(message => message.includes('缺标题')), 'a row without a title is reported')
assert.ok(planProblems({
  version: 1, rev: 1, ui: {}, groups: [{ id: 'g', title: 'G', mode: 'weird' }], items: [],
}).some(message => message.includes('mode')), 'an unknown mode is reported')
assert.ok(planProblems({
  version: 1, rev: 1, ui: {}, groups: [{ id: 'g', title: 'G' }],
  items: [{ id: 'x', groupId: 'g', title: 'T', status: 'pending', futureFlag: true }],
}).some(message => message.includes('不认识的字段')), 'a hand-added key is reported')


const missing = text(render(React.createElement(ui.PlanPanel, { state: { kind: 'missing' } })))
assert.ok(missing.includes('还没有计划'), 'missing file shows the empty state')

const invalid = text(render(React.createElement(ui.PlanPanel, {
  state: { kind: 'invalid', message: 'version 必须是 1' },
})))
assert.ok(invalid.includes('计划文件读不出来'), 'an invalid file shows the error state')

const failing = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { error: 'stale: 文件自上次读取后已变化' },
  handlers,
  now,
}))
assert.ok(text(failing).includes('没有保存成功'), 'a failed write shows an error bar')

const bad = normalizePlan({ version: 2, groups: [], items: [] })
assert.equal(bad.ok, false, 'normalizePlan rejects an unknown version')

const { pickPlanPath } = mod.__test
assert.equal(pickPlanPath([
  { path: 'dsh-todo/todolist.json', type: 'file' },
  { path: 'todolist.json', type: 'file' },
]), 'todolist.json', 'the shallowest plan wins')
assert.equal(pickPlanPath([
  { path: 'a/b/todolist.json', type: 'file' },
  { path: 'a/todolist.json', type: 'file' },
]), 'a/todolist.json', 'depth decides before path length')
assert.equal(pickPlanPath([{ path: 'docs', type: 'directory' }]), undefined, 'directories are not plans')
assert.equal(pickPlanPath([{ path: 'x/other.json', type: 'file' }]), undefined, 'other files are not plans')

// The panel owns one bit per row: no "make this next" control anywhere.
assert.equal(findAll(ready, 'data-action').filter(node => String(node.props['data-action']).endsWith('-next')).length, 0,
  'the panel no longer offers a next-step control')

// One action layer per row: the calendar used to be a second, overlapping layer.
const layers = findAll(ready, 'className')
  .filter(node => String(node.props.className).split(' ').includes('dsh-todo-actions'))
assert.equal(layers.length, 4, 'each row has exactly one action layer')

/** Render with a given view overlay. */
const withView = view => render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view,
  handlers,
  now,
}))

// The insertion line the drag actually draws.
const dropping = withView({ dropTarget: { kind: 'item', id: 'b', before: true } })
const rowB = findAll(dropping, 'data-item').find(node => node.props['data-item'] === 'b')
assert.equal(rowB.props['data-drop'], 'before', 'hovering a row draws the insertion line there')
assert.ok(findAll(dropping, 'className').some(node => String(node.props.className).includes('dsh-todo-insert')),
  'hovering a row renders a standalone .dsh-todo-insert bar')
const appending = withView({ dropTarget: { kind: 'stage', id: 'g1' } })
assert.ok(findAll(appending, 'className').some(node => String(node.props.className).includes('dsh-todo-insert')),
  'dropping on empty space shows where the row will land')

// Running tasks: several may run at once, and the pointer never repeats one.
const parallel = {
  ...normalized.plan,
  items: normalized.plan.items.map(item => item.status === 'pending' ? { ...item, status: 'in_progress' } : item),
  next: 'c',
}
const runningNode = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: parallel },
  view: {},
  handlers,
  now,
}))
const runningText = text(runningNode)
assert.ok(runningText.includes('进行中'), 'running rows are named in the stage strip')
assert.ok(runningText.includes('+1'), 'more than one running row is counted')
const focusRows = findAll(runningNode, 'className')
  .filter(node => String(node.props.className).split(' ').includes('dsh-todo-focus-row'))
assert.equal(focusRows.length, 1, 'a row that is both running and next is listed once')

// Blocked is a pending-only hint.
const runningBlocked = {
  ...normalized.plan,
  items: normalized.plan.items.map(item => item.id === 'c' ? { ...item, status: 'in_progress' } : item),
}
const blockedText = text(render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: runningBlocked },
  view: {},
  handlers,
  now,
})))
assert.ok(!blockedText.includes('待前序'), 'a running row is not labelled as waiting on earlier items')

// The composer switch: new conversations start switched off, and flipping it
// tells the Host (which owns the prompt section, tool gate and notifications).
const sent = []
ctx.remote.commands.execute = async (sessionId, line) => {
  sent.push([sessionId, line])
  return { ok: true, value: { kind: 'success', text: '' } }
}
const cleanups = []
const originalUseEffect = React.useEffect
React.useEffect = (fn) => {
  const dispose = fn()
  if (typeof dispose === 'function') cleanups.push(dispose)
}
const chip = render(React.createElement(ui.OpenChip, { sessionId: 's-switch' }))
React.useEffect = originalUseEffect
for (const dispose of cleanups) dispose()
assert.equal(sent.length, 0, 'mounting OpenChip when switched off does not send /todo')

const switchControl = findAll(chip, 'data-action').find(node => node.props['data-action'] === 'toggle-session')
assert.ok(switchControl, 'the composer offers a switch')
assert.equal(switchControl.props['aria-checked'], false, 'a new conversation starts switched off')
assert.equal(switchControl.props.role, 'switch', 'it is exposed as a switch')
switchControl.props.onClick()
assert.equal(sent.at(-1)[0], 's-switch', 'the switch speaks for its own Session')
assert.match(sent.at(-1)[1], /"op":"session"/, 'the switch sends the session operation')
assert.match(sent.at(-1)[1], /"enabled":true/, 'the switch sends the new value')

// F4: cross-stage pendingMove renders moved item in target stage and hides it from source stage
const crossPlan = normalizePlan({
  version: 1,
  rev: 8,
  title: '跨阶段测试',
  ui: {},
  groups: [
    { id: 'g1', title: '阶段一', mode: 'free', order: 1 },
    { id: 'g2', title: '阶段二', mode: 'free', order: 2 },
  ],
  items: [
    { id: 'i1', groupId: 'g1', order: 1, title: '源阶段事项', status: 'pending' },
    { id: 'i2', groupId: 'g2', order: 1, title: '目标阶段事项', status: 'pending' },
  ],
}).plan
const crossRendered = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: crossPlan },
  view: { pendingMove: { kind: 'item', groupId: 'g2', ids: ['i1', 'i2'], movedId: 'i1' } },
  handlers,
  now,
}))
const stageBoxes = findAll(crossRendered, 'className')
  .filter(node => String(node.props.className).split(' ').includes('dsh-todo-stage'))
assert.equal(stageBoxes.length, 2)
assert.ok(!text(stageBoxes[0]).includes('源阶段事项'), 'source stage hides moved item during preview')
assert.ok(text(stageBoxes[1]).includes('源阶段事项'), 'target stage shows moved item during preview')

const offline = text(render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { enabled: false },
  handlers,
  now,
})))
assert.ok(offline.includes('本会话没有启用计划面板'), 'a switched-off Session says so in the panel')
const online = text(render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { enabled: true },
  handlers,
  now,
})))
assert.ok(!online.includes('本会话没有启用计划面板'), 'a switched-on Session shows no such banner')

// A stage whose items are all done must not claim to be empty when they are
// hidden; it says so with the count.
const doneStagePlan = {
  ...normalized.plan,
  groups: [{ id: 'g1', title: '全都完成的阶段', mode: 'free', order: 1 }],
  items: [
    { id: 'c1', groupId: 'g1', order: 1, title: '做完的一条', status: 'completed' },
    { id: 'c2', groupId: 'g1', order: 2, title: '做完的另一条', status: 'completed' },
  ],
}
const doneStageText = text(render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: doneStagePlan },
  view: { hideCompleted: true },
  handlers,
  now,
})))
assert.ok(doneStageText.includes('这个阶段的 2 项都已完成'), 'an all-done stage says so when its rows are hidden')
assert.ok(!doneStageText.includes('这个阶段还没有事项'), 'an all-done stage is not reported as empty')

// The completion burst is driven by data-flash, never by mounting: a plain
// render carries none, and only the ids handed in flash.
const plainRows = findAll(ready, 'data-flash')
assert.equal(plainRows.length, 0, 'a normal render does not flash anything')
const flashed = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { flashIds: ['b'] },
  handlers,
  now,
}))
const flashedRow = findAll(flashed, 'data-item').find(node => node.props['data-item'] === 'b')
assert.equal(flashedRow.props['data-flash'], 'done', 'only the id that just completed flashes')
const quietRow = findAll(flashed, 'data-item').find(node => node.props['data-item'] === 'a')
assert.equal(quietRow.props['data-flash'], undefined, 'other rows stay quiet')

// Deleting collapses the row before the file watch drops it.
const removing = render(React.createElement(ui.PlanPanel, {
  state: { kind: 'ready', plan: normalized.plan },
  view: { removing: 'b' },
  handlers,
  now,
}))
const removingBlock = findAll(removing, 'data-removing')
assert.equal(removingBlock.length, 1, 'only the deleted row collapses')
assert.equal(removingBlock[0].props['data-removing'], '1')

process.stdout.write('dsh-todo client smoke check: OK\n')
