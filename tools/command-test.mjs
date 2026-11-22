/**
 * Tests for the Host command that the panel writes through (`index.js`).
 *
 * The handler is plain async code, so it runs here against a fake command
 * registry and a temp directory: no DSH process, no agent.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, registerSessionPrompt } from '../index.js'

/** Register the plugin and hand back its command handler. */
async function loadHandler() {
  let handler
  const ctx = {
    effect(fn) { fn() },
    tools: { register() { return () => {} } },
    commands: {
      register(definition) {
        handler = definition.handler
        return () => {}
      },
    },
  }
  await apply(ctx)
  assert.equal(typeof handler, 'function', 'index.js registers a command handler')
  return handler
}

const sample = {
  version: 1,
  rev: 1,
  title: '命令测试',
  ui: { hideCompleted: false, openRequest: 0, notify: 'next-turn', notifyWindow: 1 },
  groups: [{ id: 'g1', title: '阶段', mode: 'free', order: 1 }],
  items: [{ id: 'a', groupId: 'g1', order: 1, title: '事项', status: 'pending' }],
}

const handler = await loadHandler()
const dir = await mkdtemp(join(tmpdir(), 'dsh-todo-command-'))
const file = join(dir, 'todolist.json')
const agent = { session: { cwd: dir } }
const opLine = payload => 'op ' + JSON.stringify(payload)

try {
  await writeFile(file, `${JSON.stringify(sample, null, 2)}\n`, 'utf8')

  const ok = await handler({ agent, rawInput: opLine({ path: file, op: { op: 'toggle', id: 'a' } }) })
  assert.equal(ok.kind, 'success', 'a nested operation succeeds')
  assert.match(ok.text, /rev 2/)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).items[0].status, 'completed')

  const flat = await handler({ agent, rawInput: opLine({ path: file, op: 'toggle', id: 'a' }) })
  assert.equal(flat.kind, 'success', 'the flat form still works')
  assert.equal(JSON.parse(await readFile(file, 'utf8')).items[0].status, 'pending')

  const noOp = await handler({ agent, rawInput: opLine({ path: file }) })
  assert.equal(noOp.kind, 'error', 'an operation object is required')
  assert.match(noOp.text, /op 字段/)

  const badJson = await handler({ agent, rawInput: 'op { nope' })
  assert.equal(badJson.kind, 'error')

  const noVerb = await handler({ agent, rawInput: JSON.stringify({ path: file }) })
  assert.equal(noVerb.kind, 'error', 'the payload needs the `op` verb')
  assert.match(noVerb.text, /用法/)

  const wrongName = await handler({ agent, rawInput: opLine({ path: join(dir, 'other.json'), op: 'toggle', id: 'a' }) })
  assert.equal(wrongName.kind, 'error', 'only a plan file may be written')
  assert.match(wrongName.text, /todolist\.json/)

  const outside = await handler({ agent, rawInput: opLine({ path: join(tmpdir(), 'todolist.json'), op: 'toggle', id: 'a' }) })
  assert.equal(outside.kind, 'error', 'a path outside the workspace is refused')
  assert.match(outside.text, /工作区/)

  const unknownOp = await handler({ agent, rawInput: opLine({ path: file, op: 'explode', id: 'a' }) })
  assert.equal(unknownOp.kind, 'error')
  assert.match(unknownOp.text, /不认识的操作/)

  const noPath = await handler({ agent, rawInput: opLine({ op: 'toggle', id: 'a' }) })
  assert.equal(noPath.kind, 'error')
  assert.match(noPath.text, /缺少 path/)

  // Creating is the only write that works without a path: the workspace root decides.
  const emptyDir = await mkdtemp(join(tmpdir(), 'dsh-todo-create-'))
  try {
    const creator = { session: { cwd: emptyDir } }
    const created = await handler({ agent: creator, rawInput: opLine({ op: { op: 'create' } }) })
    assert.equal(created.kind, 'success', 'a missing plan can be created')
    const createdFile = join(emptyDir, 'todolist.json')
    assert.equal(JSON.parse(await readFile(createdFile, 'utf8')).items.length, 0)
    const again = await handler({ agent: creator, rawInput: opLine({ op: { op: 'create' } }) })
    assert.equal(again.kind, 'error', 'an existing plan is never overwritten')
    assert.match(again.text, /已存在/)
  } finally {
    await rm(emptyDir, { recursive: true, force: true })
  }

  // Notifications: next-turn injects, wake follows up, off stays silent.
  // Every notification must be a UserMessage object: a bare string lands in the
  // session log as an invalid `agent/inbox/spliced.inserted` entry and corrupts
  // the session on its next load.
  const notes = []
  const notifier = {
    session: {},
    inject: message => notes.push(['inject', message]),
    followup: message => notes.push(['followup', message]),
  }
  const wait = () => new Promise(resolve => setTimeout(resolve, 1100))
  const noticeText = message => message.content[0].text
  await writeFile(file, `${JSON.stringify(sample, null, 2)}\n`, 'utf8')

  await handler({ agent: notifier, rawInput: opLine({ path: file, op: { op: 'toggle', id: 'a' } }) })
  await wait()
  assert.equal(notes.at(-1)[0], 'inject', 'the default mode injects into the next turn')
  const injected = notes.at(-1)[1]
  assert.equal(typeof injected, 'object', 'inject receives a message object, never a string')
  assert.equal(injected.role, 'user')
  assert.equal(typeof injected.id, 'string')
  assert.ok(Array.isArray(injected.content) && injected.content[0].type === 'text')
  assert.equal(typeof injected.source.kind, 'string')
  assert.match(noticeText(injected), /切换/)

  await handler({ agent: notifier, rawInput: opLine({ path: file, op: { op: 'settings', notify: 'wake' } }) })
  await wait()
  assert.equal(notes.at(-1)[0], 'followup', 'wake mode follows up instead')
  assert.equal(typeof notes.at(-1)[1], 'object', 'followup receives a message object too')

  await handler({ agent: notifier, rawInput: opLine({ path: file, op: { op: 'settings', notify: 'off' } }) })
  await wait()
  const before = notes.length
  await handler({ agent: notifier, rawInput: opLine({ path: file, op: { op: 'toggle', id: 'a' } }) })
  await wait()
  assert.equal(notes.length, before, 'off stays silent')


  // The per-Session switch: default off, the prompt section follows it, and a
  // switched-off Session hears nothing about panel edits.
  let captured
  registerSessionPrompt({
    systemPrompt: {
      section(definition) { captured = definition; return () => {} },
    },
  })
  assert.ok(captured, 'a prompt section is registered')
  assert.equal(captured.text({ agent: { session: { id: 's-off' } } }), '',
    'a Session that never switched on gets no instructions')

  const turnedOn = await handler({ agent: { session: { id: 's-off' } }, rawInput: opLine({ op: { op: 'session', enabled: true } }) })
  assert.equal(turnedOn.kind, 'success', 'the switch can be turned on without a plan path')
  assert.match(captured.text({ agent: { session: { id: 's-off' } } }), /项目计划面板/, 'switching on injects the section')

  const turnedOff = await handler({ agent: { session: { id: 's-off' } }, rawInput: opLine({ op: { op: 'session', enabled: false } }) })
  assert.equal(turnedOff.kind, 'success')
  assert.equal(captured.text({ agent: { session: { id: 's-off' } } }), '', 'switching off removes it again')

  // A subagent is one-shot and has no composer, so it never gets the section —
  // even when its parent has the panel on. It reports back instead.
  await handler({ agent: { session: { id: 's-parent' } }, rawInput: opLine({ op: { op: 'session', enabled: true } }) })
  const child = { session: { id: 's-child', header: { parentSession: 's-parent', origin: 'subagent' } } }
  assert.equal(captured.text({ agent: child }), '', 'a subagent never inherits the section')

  await handler({ agent: notifier, rawInput: opLine({ path: file, op: { op: 'settings', notify: 'next-turn' } }) })
  await wait()
  const quiet = { session: { id: 's-quiet' }, inject: message => notes.push(['inject', message]) }
  await handler({ agent: quiet, rawInput: opLine({ op: { op: 'session', enabled: false } }) })
  const beforeQuiet = notes.length
  await writeFile(file, `${JSON.stringify(sample, null, 2)}\n`, 'utf8')
  await handler({ agent: quiet, rawInput: opLine({ path: file, op: { op: 'toggle', id: 'a' } }) })
  await wait()
  assert.equal(notes.length, beforeQuiet, 'a switched-off Session is not notified')
  console.log('dsh-todo command tests: OK')
} finally {
  await rm(dir, { recursive: true, force: true })
}
