/**
 * Model-level tests for `host/plan.js`: validation, operations, dependency
 * cycles, and the atomic write with its stale check. No dependencies — plain
 * `node tools/plan-store-test.mjs`.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyOp, applyOpAndWrite, dueState, emptyPlan, readPlanFile, repairPlan, repairPlanFile,
  validatePlan, writePlanFile,
} from '../host/plan.js'

let passed = 0
/**
 * Run one named case.
 * @param name - case name.
 * @param body - assertions.
 */
function test(name, body) {
  return Promise.resolve().then(body).then(
    () => { passed += 1 },
    (error) => { console.error(`FAIL ${name}\n`, error); process.exitCode = 1 },
  )
}

const sample = () => ({
  version: 1,
  rev: 2,
  title: '示例',
  ui: { hideCompleted: false, openRequest: 0 },
  groups: [{ id: 'g1', title: '阶段一', mode: 'sequence', order: 1 }],
  items: [
    { id: 'a', groupId: 'g1', order: 1, title: '第一项', status: 'pending' },
    { id: 'b', groupId: 'g1', order: 2, title: '第二项', status: 'pending', after: ['a'], due: '2026-12-01' },
  ],
})

/** A valid plan with two stages, for the stage-reorder case. */
const validPlanWithTwoGroups = () => validatePlan({
  ...sample(),
  groups: [
    { id: 'g1', title: '阶段一', mode: 'sequence', order: 1 },
    { id: 'g2', title: '阶段二', mode: 'free', order: 2 },
  ],
  items: [
    { id: 'a', groupId: 'g1', order: 1, title: '第一项', status: 'pending' },
    { id: 'c', groupId: 'g2', order: 1, title: '另一项', status: 'pending' },
  ],
}).plan

await test('有效计划通过校验并补默认值', () => {
  const result = validatePlan(sample())
  assert.equal(result.ok, true)
  assert.equal(result.plan.groups[0].mode, 'sequence')
  assert.equal(result.plan.ui.hideCompleted, false)
})

await test('缺 version / rev 被拒', () => {
  const missing = validatePlan({ groups: [], items: [] })
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some(message => message.includes('version')))
})

await test('未知字段被拒（防止拼写错误被悄悄吞掉）', () => {
  const value = sample()
  value.items[0].titel = 'typo'
  const result = validatePlan(value)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(message => message.includes('titel')))
})

await test('id 重复、groupId 不存在、依赖不存在都被拒', () => {
  const dup = sample()
  dup.items[1].id = 'a'
  assert.equal(validatePlan(dup).ok, false)

  const badGroup = sample()
  badGroup.items[0].groupId = 'nope'
  assert.ok(validatePlan(badGroup).errors.some(message => message.includes('groupId')))

  const badDep = sample()
  badDep.items[1].after = ['ghost']
  assert.ok(validatePlan(badDep).errors.some(message => message.includes('ghost')))
})

await test('依赖成环被拒', () => {
  const value = sample()
  value.items[0].after = ['b']
  const result = validatePlan(value)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(message => message.includes('成环')))
})

await test('status 流转与 toggle', () => {
  const plan = validatePlan(sample()).plan
  const started = applyOp(plan, { op: 'status', id: 'a', status: 'in_progress' })
  assert.equal(started.ok, true)
  assert.equal(started.plan.items[0].status, 'in_progress')
  const toggled = applyOp(started.plan, { op: 'toggle', id: 'a' })
  assert.equal(toggled.plan.items[0].status, 'completed')
  assert.equal(applyOp(plan, { op: 'status', id: 'a', status: 'nope' }).ok, false)
})

await test('新 id 不与已有 id 冲突', () => {
  const plan = validatePlan(sample()).plan
  const added = applyOp(plan, { op: 'add', groupId: 'g1', title: '第三项', after: ['b'] })
  assert.equal(added.ok, true)
  assert.equal(added.plan.items.length, 3)
  assert.ok(!['a', 'b', 'g1'].includes(added.plan.items[2].id))
})

await test('加子项与勾选子项分别写入文件结构', () => {
  const plan = validatePlan(sample()).plan
  const added = applyOp(plan, { op: 'addChild', parentId: 'a', title: '子项' })
  assert.equal(added.ok, true)
  assert.equal(added.plan.items[0].children.length, 1)
  const childId = added.plan.items[0].children[0].id
  const done = applyOp(added.plan, { op: 'toggle', id: childId })
  assert.equal(done.plan.items[0].children[0].status, 'completed')
})

await test('删除事项时清掉指向它的依赖', () => {
  const plan = validatePlan(sample()).plan
  const removed = applyOp(plan, { op: 'remove', id: 'a' })
  assert.equal(removed.ok, true)
  assert.equal(removed.plan.items.length, 1)
  assert.equal(removed.plan.items[0].after, undefined)
})

await test('移动、改截止日期、改显示设置', () => {
  const plan = validatePlan(sample()).plan
  assert.equal(applyOp(plan, { op: 'move', id: 'b', order: 1 }).plan.items[1].order, 1)
  assert.equal(applyOp(plan, { op: 'due', id: 'b', due: '2027-01-02' }).plan.items[1].due, '2027-01-02')
  assert.equal(applyOp(plan, { op: 'due', id: 'b', due: null }).plan.items[1].due, undefined)
  assert.equal(applyOp(plan, { op: 'settings', hideCompleted: true }).plan.ui.hideCompleted, true)
})

await test('打开请求只递增计数，不改其它字段', () => {
  const plan = validatePlan(sample()).plan
  const opened = applyOp(plan, { op: 'open' })
  assert.equal(opened.plan.ui.openRequest, 1)
  assert.equal(opened.plan.rev, plan.rev)
})

await test('未知操作被拒', () => {
  const plan = validatePlan(sample()).plan
  assert.equal(applyOp(plan, { op: 'explode' }).ok, false)
})

await test('dueState 判定逾期、今天、未来', () => {
  const now = new Date(2026, 10, 21, 12, 0, 0)
  assert.deepEqual(dueState('2026-11-20', now), { kind: 'overdue', days: -1 })
  assert.deepEqual(dueState('2026-11-21', now), { kind: 'today', days: 0 })
  assert.deepEqual(dueState('2026-11-25', now), { kind: 'future', days: 4 })
  assert.deepEqual(dueState(undefined, now), { kind: 'none' })
})

await test('读写往返：rev 递增、格式化、丢未知字段', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    const plan = validatePlan(sample()).plan
    const written = await writePlanFile(file, plan)
    assert.equal(written.ok, true)
    assert.equal(written.rev, 3)
    const text = await readFile(file, 'utf8')
    assert.ok(text.endsWith('\n'))
    assert.equal(JSON.parse(text).rev, 3)
    const read = await readPlanFile(file)
    assert.equal(read.ok, true)
    assert.equal(read.plan.items.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('文件在读取后被修改时拒绝覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    await writeFile(file, `${JSON.stringify(sample(), null, 2)}\n`, 'utf8')
    const read = await readPlanFile(file)
    assert.equal(read.ok, true)
    await writeFile(file, `${JSON.stringify({ ...sample(), rev: 99 }, null, 2)}\n`, 'utf8')
    const written = await writePlanFile(file, read.plan, { expectedVersion: read.version })
    assert.equal(written.ok, false)
    assert.ok(written.error.startsWith('stale'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('缺失与坏 JSON 分别报不同错误', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const missing = await readPlanFile(join(dir, 'nope.json'))
    assert.deepEqual(missing, { ok: false, error: 'missing' })
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ nope', 'utf8')
    const read = await readPlanFile(broken)
    assert.equal(read.ok, false)
    assert.ok(read.error.startsWith('invalid-json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('空计划是合法的可写起点', () => {
  const plan = emptyPlan('新计划')
  assert.equal(validatePlan(plan).ok, true)
  assert.equal(applyOp(plan, { op: 'add', title: '第一件事' }).ok, true)
})

await test('重排：按给定 id 顺序重写 order', () => {
  const plan = validatePlan(sample()).plan
  const reordered = applyOp(plan, { op: 'reorder', ids: ['b', 'a'] })
  assert.equal(reordered.ok, true)
  assert.equal(reordered.plan.items[0].order, 2)
  assert.equal(reordered.plan.items[1].order, 1)
  assert.equal(applyOp(plan, { op: 'reorder', ids: ['a', 'ghost'] }).ok, false)
})

await test('applyOpAndWrite：读-改-写一次完成，rev 递增', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    await writeFile(file, `${JSON.stringify(sample(), null, 2)}\n`, 'utf8')
    const result = await applyOpAndWrite(file, { op: 'toggle', id: 'a' })
    assert.equal(result.ok, true)
    assert.equal(result.rev, 3)
    const read = await readPlanFile(file)
    assert.equal(read.plan.items[0].status, 'completed')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('applyOpAndWrite 遇到坏文件不覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    await writeFile(file, '{ nope', 'utf8')
    const result = await applyOpAndWrite(file, { op: 'toggle', id: 'a' })
    assert.equal(result.ok, false)
    assert.equal(await readFile(file, 'utf8'), '{ nope')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('通知方式与「下一步」：校验、设置、清除', () => {
  const plan = validatePlan(sample()).plan
  assert.equal(plan.ui.notify, 'next-turn', 'the default notify mode is next-turn')
  assert.equal(plan.ui.next, null)
  const bad = sample()
  bad.ui.notify = 'shout'
  assert.equal(validatePlan(bad).ok, false, 'an unknown notify mode is rejected')
  const pointer = sample()
  pointer.ui.next = 'ghost'
  assert.equal(validatePlan(pointer).ok, false, 'ui.next must name an existing item')

  const warmer = applyOp(plan, { op: 'settings', notify: 'wake' })
  assert.equal(warmer.plan.ui.notify, 'wake')
  assert.equal(applyOp(plan, { op: 'settings', notify: 'nope' }).ok, false)

  const chosen = applyOp(plan, { op: 'next', id: 'b' })
  assert.equal(chosen.plan.ui.next, 'b')
  assert.equal(applyOp(chosen.plan, { op: 'next', id: null }).plan.ui.next, null)
  assert.equal(applyOp(plan, { op: 'next', id: 'ghost' }).ok, false)
})

await test('下一步：完成或删除它时自动清空，不能指向已完成的事项', () => {
  const plan = applyOp(validatePlan(sample()).plan, { op: 'next', id: 'b' }).plan
  assert.equal(plan.ui.next, 'b')

  const finished = applyOp(plan, { op: 'status', id: 'b', status: 'completed' }).plan
  assert.equal(finished.ui.next, null, 'a finished item cannot stay next')

  const toggled = applyOp(plan, { op: 'toggle', id: 'b' }).plan
  assert.equal(toggled.items.find(item => item.id === 'b').status, 'completed')
  assert.equal(toggled.ui.next, null, 'toggle clears the pointer the same way')

  const removed = applyOp(plan, { op: 'remove', id: 'b' }).plan
  assert.equal(removed.ui.next, null, 'removing the next item clears the pointer')

  const done = applyOp(plan, { op: 'status', id: 'b', status: 'completed' }).plan
  assert.equal(applyOp(done, { op: 'next', id: 'b' }).ok, false, 'a completed item cannot be made next')
})

await test('重排阶段：按给定 id 顺序重写阶段 order', () => {
  const plan = validPlanWithTwoGroups()
  const reordered = applyOp(plan, { op: 'reorderGroups', ids: ['g2', 'g1'] })
  assert.equal(reordered.ok, true)
  assert.equal(reordered.plan.groups.find(group => group.id === 'g2').order, 1)
  assert.equal(reordered.plan.groups.find(group => group.id === 'g1').order, 2)
  assert.equal(applyOp(plan, { op: 'reorderGroups', ids: ['g1', 'ghost'] }).ok, false)
})

await test('通知合并窗口：默认 8 秒，越界被拒', () => {
  const plan = validatePlan(sample()).plan
  assert.equal(plan.ui.notifyWindow, 8)
  assert.equal(applyOp(plan, { op: 'settings', notifyWindow: 3 }).plan.ui.notifyWindow, 3)
  for (const bad of [0, 601, 2.5]) {
    assert.equal(applyOp(plan, { op: 'settings', notifyWindow: bad }).ok, false, `${bad} must be rejected`)
  }
  const invalid = sample()
  invalid.ui.notifyWindow = 0
  assert.equal(validatePlan(invalid).ok, false)
})

await test('ui 里不认识的字段被保留而不是让整个计划失败', () => {
  const forward = sample()
  forward.ui.futureFlag = true
  const checked = validatePlan(forward)
  assert.equal(checked.ok, true, 'an unknown ui key must not fail the plan')
  assert.equal(checked.plan.ui.futureFlag, true, 'the unknown ui key survives the round trip')
  assert.equal(checked.plan.ui.notify, 'next-turn', 'known defaults still fill in')
})

await test('修复：缺标题的事项被移除，其余保留', () => {
  const broken = sample()
  broken.items.push({ id: 'ghost', groupId: 'g1', order: 3, status: 'completed' })
  assert.equal(validatePlan(broken).ok, false, 'the broken plan must be rejected first')

  const repaired = repairPlan(broken)
  assert.equal(repaired.ok, true)
  assert.deepEqual(repaired.plan.items.map(item => item.id), ['a', 'b'], 'the untitled row is gone')
  assert.equal(validatePlan(repaired.plan).ok, true, 'the repaired plan validates')
  assert.equal(repaired.notes.length, 1)
  assert.ok(repaired.notes[0].includes('ghost'), 'the note names the dropped row')
})

await test('修复：保住能救的字段，清掉坏引用与未知字段', () => {
  const broken = sample()
  broken.items[1].status = 'later'
  broken.items[1].after = ['a', 'a', 'b', 'nope']
  broken.items[1].futureFlag = true
  broken.items.push({ id: 'c', groupId: 'g9', order: 4, title: '孤儿阶段', status: 'pending' })
  const repaired = repairPlan(broken)
  assert.equal(repaired.ok, true)
  const b = repaired.plan.items.find(item => item.id === 'b')
  assert.equal(b.status, 'pending', 'an unknown status falls back to pending')
  assert.deepEqual(b.after, ['a'], 'only a real, distinct, non-self dependency survives')
  assert.equal(b.futureFlag, undefined, 'an unknown item key is dropped')
  const c = repaired.plan.items.find(item => item.id === 'c')
  assert.equal(c.groupId, undefined, 'an item whose stage is gone becomes ungrouped')
  assert.equal(validatePlan(repaired.plan).ok, true)
})

await test('修复：断掉依赖成环', () => {
  const broken = sample()
  broken.items[0].after = ['b']
  const repaired = repairPlan(broken)
  assert.equal(repaired.ok, true)
  assert.equal(validatePlan(repaired.plan).ok, true, 'the cycle is gone')
  assert.ok(repaired.notes.some(note => note.includes('成环')))
})

await test('修复：合法的计划原样通过，不产生修改说明', () => {
  const repaired = repairPlan(sample())
  assert.equal(repaired.ok, true)
  assert.deepEqual(repaired.notes, [])
  assert.equal(repaired.plan.rev, 2)
})

await test('修复写入文件：坏文件被改成合法文件，rev 递增', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    const broken = sample()
    broken.items.push({ id: 'ghost', groupId: 'g1', order: 3 })
    await writeFile(file, `${JSON.stringify(broken, null, 2)}\n`, 'utf8')
    assert.equal((await readPlanFile(file)).ok, false, 'the file starts out invalid')

    const repaired = await repairPlanFile(file)
    assert.equal(repaired.ok, true, `repair failed: ${repaired.error}`)
    assert.equal(repaired.rev, 3, 'the rewritten file gets a new revision')
    assert.ok(repaired.notes.length >= 1)
    const after = await readPlanFile(file)
    assert.equal(after.ok, true, 'the file is valid after repair')
    assert.deepEqual(after.plan.items.map(item => item.id), ['a', 'b'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('修复：合法文件不动，坏 JSON 拒绝修', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    await writeFile(file, `${JSON.stringify(sample(), null, 2)}\n`, 'utf8')
    const untouched = await repairPlanFile(file)
    assert.equal(untouched.ok, true)
    assert.deepEqual(untouched.notes, [])
    assert.equal((await readPlanFile(file)).plan.rev, 2, 'a no-op repair does not bump rev')

    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ nope', 'utf8')
    const refused = await repairPlanFile(broken)
    assert.equal(refused.ok, false)
    assert.ok(refused.error.startsWith('invalid-json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('applyOpAndWrite 的 repair 走读原始文件的通道', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    const broken = sample()
    broken.items.push({ id: 'ghost', groupId: 'g1', order: 3 })
    await writeFile(file, `${JSON.stringify(broken, null, 2)}\n`, 'utf8')
    const refused = await applyOpAndWrite(file, { op: 'status', id: 'a', status: 'completed' })
    assert.equal(refused.ok, false, 'other ops still need a valid file')
    assert.ok(refused.error.startsWith('invalid-plan'))
    const repaired = await applyOpAndWrite(file, { op: 'repair' })
    assert.equal(repaired.ok, true, `repair failed: ${repaired.error}`)
    const now = await applyOpAndWrite(file, { op: 'status', id: 'a', status: 'completed' })
    assert.equal(now.ok, true, 'writes work again after the repair')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('外观：默认灵动 + 高级材质开；非法值被拒；修复回默认', () => {
  const plan = validatePlan(sample()).plan
  assert.equal(plan.ui.style, 'vivid', 'vivid is the default look')
  assert.equal(plan.ui.material, true, 'materials default on')
  assert.equal(applyOp(plan, { op: 'settings', style: 'calm' }).plan.ui.style, 'calm')
  assert.equal(applyOp(plan, { op: 'settings', style: 'md3' }).plan.ui.style, 'md3')
  assert.equal(applyOp(plan, { op: 'settings', material: false }).plan.ui.material, false)
  assert.equal(applyOp(plan, { op: 'settings', style: 'vivid' }).plan.ui.style, 'vivid')
  assert.equal(applyOp(plan, { op: 'settings', style: 'noir' }).ok, false)
  assert.equal(applyOp(plan, { op: 'settings', material: 'yes' }).ok, false)

  const broken = sample()
  broken.ui.style = 'noir'
  broken.ui.material = 'yes'
  assert.equal(validatePlan(broken).ok, false, 'an unknown look is rejected on read too')
  const repaired = repairPlan(broken)
  assert.equal(repaired.plan.ui.style, 'vivid', 'repair falls back to vivid')
  assert.equal(repaired.plan.ui.material, true, 'repair falls back to materials on')
})

await test('修复：仅含未知字段时仍记录 note 并写盘递增 rev', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-test-'))
  try {
    const file = join(dir, 'todolist.json')
    const broken = sample()
    broken.items[0].titel = 'typo'
    await writeFile(file, `${JSON.stringify(broken, null, 2)}\n`, 'utf8')
    const repaired = await repairPlanFile(file)
    assert.equal(repaired.ok, true)
    assert.equal(repaired.rev, 3, 'rev increments on unknown field cleanup')
    assert.ok(repaired.notes.some(note => note.includes('titel')))
    const after = await readPlanFile(file)
    assert.equal(after.ok, true)
    assert.equal(after.plan.items[0].titel, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('move 与 reorder 支持移入未分组，拒绝不存在的阶段，且跨阶段各自顺序编号', () => {
  const plan = validPlanWithTwoGroups()
  const movedNull = applyOp(plan, { op: 'move', id: 'a', order: 1, groupId: null })
  assert.equal(movedNull.ok, true)
  assert.equal(movedNull.plan.items.find(item => item.id === 'a').groupId, undefined)

  const reorderedNone = applyOp(plan, { op: 'reorder', ids: ['a'], groupId: '__none' })
  assert.equal(reorderedNone.ok, true)
  assert.equal(reorderedNone.plan.items.find(item => item.id === 'a').groupId, undefined)

  const badStage = applyOp(plan, { op: 'reorder', ids: ['a'], groupId: 'nonexistent' })
  assert.equal(badStage.ok, false)

  // Cross-stage reorder: moving 'a' from g1 into g2 before 'c' gives g2 unique 1..2
  const cross = applyOp(plan, { op: 'reorder', ids: ['a', 'c'], groupId: 'g2' })
  assert.equal(cross.ok, true)
  const g2Items = cross.plan.items.filter(item => item.groupId === 'g2').sort((x, y) => x.order - y.order)
  assert.deepEqual(g2Items.map(item => [item.id, item.order]), [['a', 1], ['c', 2]])

  // Moving one item into a stage that already has another item keeps unique 1..N per stage
  const multi = validatePlan({
    ...sample(),
    groups: [
      { id: 'g1', title: '阶段一', mode: 'free', order: 1 },
      { id: 'g2', title: '阶段二', mode: 'free', order: 2 },
    ],
    items: [
      { id: 'a', groupId: 'g1', order: 1, title: '第一项', status: 'pending' },
      { id: 'b', groupId: 'g1', order: 2, title: '第二项', status: 'pending' },
      { id: 'c', groupId: 'g2', order: 1, title: '第三项', status: 'pending' },
    ],
  }).plan
  const partialCross = applyOp(multi, { op: 'reorder', ids: ['a', 'c'], groupId: 'g2' })
  assert.equal(partialCross.ok, true)
  assert.equal(partialCross.plan.items.find(item => item.id === 'b').order, 1)
  assert.deepEqual(
    partialCross.plan.items.filter(item => item.groupId === 'g2').map(item => [item.id, item.order]),
    [['a', 1], ['c', 2]],
  )

  // move (same stage & cross-stage) and add(order) keep unique continuous 1..N per stage
  const movedSame = applyOp(multi, { op: 'move', id: 'b', order: 1 })
  assert.equal(movedSame.ok, true)
  assert.deepEqual(
    movedSame.plan.items.filter(item => item.groupId === 'g1').sort((x, y) => x.order - y.order).map(item => [item.id, item.order]),
    [['b', 1], ['a', 2]],
  )

  const movedCross = applyOp(multi, { op: 'move', id: 'c', order: 1, groupId: 'g1' })
  assert.equal(movedCross.ok, true)
  assert.deepEqual(
    movedCross.plan.items.filter(item => item.groupId === 'g1').sort((x, y) => x.order - y.order).map(item => [item.id, item.order]),
    [['c', 1], ['a', 2], ['b', 3]],
  )

  const addedAtHead = applyOp(multi, { op: 'add', groupId: 'g1', title: '插队项', order: 1 }, () => 'd')
  assert.equal(addedAtHead.ok, true)
  assert.deepEqual(
    addedAtHead.plan.items.filter(item => item.groupId === 'g1').sort((x, y) => x.order - y.order).map(item => [item.id, item.order]),
    [['d', 1], ['a', 2], ['b', 3]],
  )

  // reorderGroups with a subset of stage ids keeps all stage orders unique and continuous 1..N
  const threeGroups = validatePlan({
    ...sample(),
    groups: [
      { id: 'g1', title: '阶段一', mode: 'free', order: 1 },
      { id: 'g2', title: '阶段二', mode: 'free', order: 2 },
      { id: 'g3', title: '阶段三', mode: 'free', order: 3 },
    ],
    items: [],
  }).plan
  const partialGroups = applyOp(threeGroups, { op: 'reorderGroups', ids: ['g3'] })
  assert.equal(partialGroups.ok, true)
  assert.deepEqual(
    partialGroups.plan.groups.slice().sort((x, y) => x.order - y.order).map(group => [group.id, group.order]),
    [['g3', 1], ['g1', 2], ['g2', 3]],
  )
})

if (process.exitCode === 1) {
  console.error(`plan-store tests: ${passed} passed, with failures`)
} else {
  console.log(`plan-store tests: ${passed} passed`)
}
