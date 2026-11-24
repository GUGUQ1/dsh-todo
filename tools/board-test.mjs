/**
 * Tests for the two-board model: the workspace board and the Session board.
 *
 * Covers the path rules (`$DSH_HOME` resolution, Session ids as path segments),
 * the panel command's board handling, and the tool's board resolution order —
 * named board, then the tab the user is looking at, then the only board that
 * exists. No DSH process: the command handler and the tool run against fakes.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DSH_HOME_ENV, isBoardSessionId, privateBoardFile, resolveDshHome,
} from '../host/boards.js'
import { apply, registerTool, setSessionEnabled } from '../index.js'

const home = await mkdtemp(join(tmpdir(), 'dsh-todo-home-'))
const ws = await mkdtemp(join(tmpdir(), 'dsh-todo-ws-'))
const ws2 = await mkdtemp(join(tmpdir(), 'dsh-todo-ws2-'))
process.env[DSH_HOME_ENV] = home

const opLine = payload => 'op ' + JSON.stringify(payload)

/** Register the plugin and hand back its command handler. */
async function loadHandler() {
  let handler
  const ctx = {
    effect(fn) { fn() },
    tools: { register() { return () => {} } },
    commands: { register(definition) { handler = definition.handler; return () => {} } },
  }
  await apply(ctx)
  assert.equal(typeof handler, 'function')
  return handler
}

/** Register the tool against a fake registry, with a working directory. */
async function loadTool() {
  let definition
  const ctx = {
    tools: { register(candidate) { definition = candidate; return () => {} } },
    workingDirectory: { async ensure(agent) { return agent?.session?.cwd ?? ws } },
  }
  await registerTool(ctx)
  assert.ok(definition)
  return definition
}

const handler = await loadHandler()
const tool = await loadTool()
const run = (args, agent) => tool.execute(args, { agent })

/** A session with an id (needs it for the private board) and a directory. */
function session(id, cwd = ws) {
  setSessionEnabled(id, true)
  return { session: { id, cwd } }
}

const sample = title => ({
  version: 1,
  rev: 1,
  title,
  ui: { hideCompleted: false, openRequest: 0, notify: 'next-turn', notifyWindow: 1 },
  groups: [],
  items: [{ id: 'a', order: 1, title: '第一件事', status: 'pending' }],
})

try {
  // --- Path rules -------------------------------------------------------
  assert.equal(resolveDshHome({ [DSH_HOME_ENV]: home }), resolve(home), '$DSH_HOME wins')
  assert.equal(resolveDshHome({}, homedir()), join(homedir(), '.dsh'), 'the default is ~/.dsh')
  assert.equal(resolveDshHome({ [DSH_HOME_ENV]: '  ' }, homedir()), join(homedir(), '.dsh'),
    'a blank $DSH_HOME counts as unset')
  assert.ok(isBoardSessionId('s-2026-11-24_abc.X'))
  for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(129), undefined]) {
    assert.equal(isBoardSessionId(bad), false, `${String(bad)} must not name a directory`)
    assert.equal(privateBoardFile(bad), undefined)
  }
  assert.equal(privateBoardFile('s1'), join(home, 'dsh-todo', 's1', 'private.json'))

  // --- The panel command -------------------------------------------------
  const boards0 = await handler({ agent: session('s1'), rawInput: opLine({ op: { op: 'boards' } }) })
  assert.equal(boards0.kind, 'success')
  const parsed0 = JSON.parse(boards0.text)
  assert.equal(parsed0.public.exists, false)
  assert.equal(parsed0.private.exists, false)
  assert.equal(parsed0.private.path, join(home, 'dsh-todo', 's1', 'private.json'))

  const created = await handler({ agent: session('s1'), rawInput: opLine({ board: 'private', op: { op: 'create' } }) })
  assert.equal(created.kind, 'success', 'the private board can be created')
  const privateFile = privateBoardFile('s1')
  assert.equal(JSON.parse(await readFile(privateFile, 'utf8')).version, 1)
  assert.deepEqual(JSON.parse(await readFile(privateFile, 'utf8')).items, [])

  const added = await handler({
    agent: session('s1'),
    rawInput: opLine({ board: 'private', op: { op: 'add', title: '私板事项' } }),
  })
  assert.equal(added.kind, 'success')
  assert.equal(JSON.parse(await readFile(privateFile, 'utf8')).items[0].title, '私板事项')

  // The private board needs no workspace at all: it is anchored to the Session.
  const noWorkspace = await handler({
    agent: { session: { id: 's-nodir' } },
    rawInput: opLine({ board: 'private', op: { op: 'create' } }),
  })
  assert.equal(noWorkspace.kind, 'success', 'a Session without a directory still has its board')

  // …and it does not move when the Session changes workspace.
  const afterSwitch = await handler({ agent: session('s1', ws2), rawInput: opLine({ op: { op: 'boards' } }) })
  assert.equal(JSON.parse(afterSwitch.text).private.path, privateFile, 'the private board follows the Session')

  const badBoard = await handler({ agent: session('s1'), rawInput: opLine({ board: 'session:s2', op: { op: 'read' } }) })
  assert.equal(badBoard.kind, 'error', 'the panel may not target another Session')
  assert.match(badBoard.text, /board 只能是/)

  // The tab the user is looking at.
  const active = await handler({ agent: session('s1'), rawInput: opLine({ op: { op: 'active', board: 'private' } }) })
  assert.equal(active.kind, 'success')
  assert.match(active.text, /本会话私板/)
  assert.equal((await handler({ agent: session('s1'), rawInput: opLine({ op: { op: 'active', board: 'nope' } }) })).kind, 'error')

  // --- Tool: which board -------------------------------------------------
  const s1 = session('s1')
  const readOne = await run({ action: 'read' }, s1)
  assert.match(readOne.text, /本会话私板/, 'the active tab is the default board')
  assert.match(readOne.text, /私板事项/)
  assert.match(readOne.text, /另一块板：工作区公板（还没有）/)

  // The active tab is private, so a bare create would target the private board:
  // naming the other one is how the public board gets made.
  const publicCreated = await run({ action: 'create', board: 'public' }, s1)
  assert.match(publicCreated.text, /工作区公板/)
  assert.ok(JSON.parse(await readFile(join(ws, 'todolist.json'), 'utf8')))

  const ambiguous = await run({ action: 'read' }, s1)
  assert.match(ambiguous.text, /本会话私板/, 'an explicit active tab still wins over "both exist"')

  // With no tab pushed, two boards are ambiguous on purpose. s2 works in a
  // different workspace so its public board is a separate file.
  const s2 = session('s2', ws2)
  await assert.rejects(() => run({ action: 'read', board: 'private' }, s2), /还没有创建/,
    's2 has no private board yet')
  await run({ action: 'create', board: 'private' }, s2)
  await run({ action: 'create', board: 'public' }, s2)
  await assert.rejects(() => run({ action: 'read' }, s2), /各有一块板/, 'two boards and no hint is refused')

  // Writing into a board that does not exist creates it.
  await unlink(privateBoardFile('s2'))
  const wrote = await run({ action: 'add', board: 'private', title: '写时建板' }, s2)
  assert.match(wrote.text, /本会话私板/)
  assert.equal(JSON.parse(await readFile(privateBoardFile('s2'), 'utf8')).items[0].title, '写时建板')

  // Re-creating an existing board is refused rather than overwriting it.
  await assert.rejects(() => run({ action: 'create', board: 'private' }, s2), /已经存在/)

  // --- Tool: another Session's private board, read-only ------------------
  const other = session('other-session')
  await run({ action: 'create', board: 'private' }, other)
  await run({ action: 'add', board: 'private', title: '别人的事项' }, other)

  const peek = await run({ action: 'read', board: 'session:other-session' }, s2)
  assert.match(peek.text, /只读/)
  assert.match(peek.text, /别人的事项/)
  await assert.rejects(() => run({ action: 'add', board: 'session:other-session', title: '偷改' }, s2), /只能读/)
  await assert.rejects(() => run({ action: 'read', board: 'session:../etc' }, s2), /不合法/)
  await assert.rejects(() => run({ action: 'read', board: 'session:nobody' }, s2), /还没有私板/)
  await assert.rejects(() => run({ action: 'read', board: 'workspace' }, s2), /board 只能是/)

  // --- The public board is still confined to its workspace ---------------
  const outside = await handler({ agent: session('s1'), rawInput: opLine({ path: join(tmpdir(), 'todolist.json'), op: 'toggle', id: 'a' }) })
  assert.equal(outside.kind, 'error')
  assert.match(outside.text, /工作区/)

  console.log('dsh-todo board tests: OK')
} finally {
  delete process.env[DSH_HOME_ENV]
  for (const dir of [home, ws, ws2]) await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}
