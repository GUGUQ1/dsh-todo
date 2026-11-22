/**
 * Tests for the model-facing `todolist` tool: it must read, write, and open the
 * same plan file the panel uses, without a DSH process.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerSkill, registerTool, setSessionEnabled } from '../index.js'

const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-tool-'))
const file = join(dir, 'todolist.json')
/** A tool run context: the session itself may carry no directory at all. */
const agent = {}

/** Register the tool against a fake registry and hand back its definition. */
async function loadTool(extra = {}) {
  let definition
  const ctx = { tools: { register(candidate) { definition = candidate; return () => {} } }, ...extra }
  await registerTool(ctx)
  assert.ok(definition, 'the tool registers')
  return definition
}

const sample = {
  version: 1,
  rev: 1,
  title: '工具测试',
  ui: { hideCompleted: false, openRequest: 0, notify: 'next-turn', next: null },
  groups: [{ id: 'g1', title: '阶段', mode: 'sequence', order: 1 }],
  items: [
    { id: 'a', groupId: 'g1', order: 1, title: '第一件事', status: 'completed' },
    { id: 'b', groupId: 'g1', order: 2, title: '第二件事', status: 'pending' },
  ],
}

try {
  await writeFile(file, `${JSON.stringify(sample, null, 2)}\n`, 'utf8')
  // The working-directory service is the authoritative source (it follows a cd),
  // so the tool must work when the session metadata carries no directory.
  const tool = await loadTool({ workingDirectory: { async ensure() { return dir } } })
  const run = (args) => tool.execute(args, { agent })

  assert.equal(tool.parameters.type, 'object', 'parameters are a JSON Schema object')
  assert.deepEqual(tool.parameters.required, ['action'], 'only the action is required')
  assert.deepEqual(tool.parameters.properties.action.enum.slice(0, 2), ['read', 'add'])
  assert.equal(tool.output.schema.required[0], 'text', 'the output schema requires text')
  assert.equal(tool.output.schema.additionalProperties, false)
  assert.equal(typeof tool.output.render, 'function')

  const read = await run({ action: 'read' })
  assert.match(read.text, /工具测试/)
  assert.match(read.text, /第二件事/)
  assert.match(read.text, /\(a\)/, 'ids are included so the model can act on them')

  const added = await run({ action: 'add', groupId: 'g1', title: '第三件事' })
  assert.match(added.text, /第三件事/)
  const afterAdd = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(afterAdd.items.length, 3)

  await run({ action: 'status', id: 'b', status: 'in_progress' })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).items[1].status, 'in_progress')

  await run({ action: 'next', id: 'b' })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).ui.next, 'b')

  await run({ action: 'settings', notify: 'wake' })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).ui.notify, 'wake')

  await run({ action: 'open' })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).ui.openRequest, 1, 'open bumps the panel request')

  await assert.rejects(() => run({ action: 'status', id: 'ghost', status: 'completed' }), /找不到/)
  // Arguments are validated before the action switch, so a typo names the enum
  // instead of reaching the handler's "unknown action" branch.
  await assert.rejects(() => run({ action: 'nope' }), /必须是/)
  await assert.rejects(() => run({}), /缺少参数 action/)
  await assert.rejects(() => run({ action: 'read', bogus: 1 }), /不认识的参数/)

  // Two more rejection paths a sub-conversation exercise revealed as untested.
  await assert.rejects(() => run({ action: 'addChild', parentId: 'a', title: '   ' }), /title 不能为空/)
  await assert.rejects(() => run({ action: 'status', id: 'a', status: 'later' }), /status 必须是/)

  // Without the service, the session metadata is the remaining source.
  const fallback = await loadTool()
  const fallbackAgent = { session: { cwd: dir } }
  const fallbackRead = await fallback.execute({ action: 'read' }, { agent: fallbackAgent })
  assert.match(fallbackRead.text, /工具测试/, 'session.cwd still resolves the plan')
  await assert.rejects(() => fallback.execute({ action: 'read' }, { agent: {} }), /拿不到会话工作区/, 'no directory anywhere is an error')

  // The per-Session switch: default off, switchable, and never available to a
  // one-shot subagent (which reports back instead).
  const off = { session: { id: 's-off-test' } }
  await assert.rejects(() => tool.execute({ action: 'read' }, { agent: off }), /没有启用计划面板/,
    'a Session that never switched on cannot read the plan')
  setSessionEnabled('s-off-test', true)
  const onRead = await tool.execute({ action: 'read' }, { agent: off })
  assert.match(onRead.text, /工具测试/, 'switching on lets the tool through')
  setSessionEnabled('s-off-test', false)
  await assert.rejects(() => tool.execute({ action: 'read' }, { agent: off }), /没有启用计划面板/,
    'switching off closes it again')

  const child = { session: { id: 's-child-test', header: { origin: 'subagent' } } }
  setSessionEnabled('s-child-test', true)
  await assert.rejects(() => tool.execute({ action: 'read' }, { agent: child }), /子对话/,
    'a subagent is refused even when its own id was switched on')
  console.log('dsh-todo session switch test: OK')

  console.log('dsh-todo tool tests: OK')
} finally {
  await rm(dir, { recursive: true, force: true })
}

// The agent-facing notes are also registered as a runtime skill, so a session
// with this plugin can load the conventions instead of guessing them.
{
  const registeredSkills = []
  const ctx = { skills: { register(skill) { registeredSkills.push(skill); return () => {} } } }
  const dispose = registerSkill(ctx)
  assert.equal(registeredSkills.length, 1, 'one skill registers')
  const skill = registeredSkills[0]
  assert.equal(skill.name, 'dsh-todo-plan')
  assert.equal(skill.source, 'runtime')
  assert.ok(skill.description.length > 20, 'the catalog gets a routing description')
  assert.ok(skill.whenToUse.length > 20, 'the catalog gets when-to-use guidance')
  assert.ok(skill.content.includes('分工'), 'the body is the shipped document')
  assert.ok(skill.content.length > 500, 'the body is the whole document, not a stub')
  assert.equal(typeof dispose, 'function', 'registration returns a disposer')

  const noService = registerSkill({}, { content: 'x' })
  assert.equal(typeof noService, 'function', 'a missing skills service is a no-op, not a crash')
  console.log('dsh-todo skill test: OK')
}
