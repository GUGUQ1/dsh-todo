/**
 * Host half of the dsh-todo bundle.
 *
 * M3: the `/todo` command is the single write path for the panel. The browser
 * half reads the plan file through the read-only workspace-file Remote and
 * writes by executing `/todo op <json>`; this handler validates the payload,
 * applies one operation through `host/plan.js`, and writes the file atomically
 * under the version it read. M4 adds a model-facing tool over the same entry.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileExists, isBoardSessionId, privateBoardFile, privateBoardDir } from './host/boards.js'
import { applyOpAndWrite, createPlanFile, PLAN_FILE, readPlanFile } from './host/plan.js'

/** Required Host services. */
export const inject = ['commands']

/** Pending notifications, one bucket per agent session. */
const pending = new Map()

/**
 * Which board the panel is showing in one Session, pushed by the browser when
 * the user switches tabs. It is the tool's default target: "add this to the
 * plan" means the board the user is looking at.
 */
const activeBoards = new Map()

/** Human name of a board, for messages that have to say which one was meant. */
function boardLabel(board) {
  return board === 'private' ? '本会话私板' : '工作区公板'
}


/**
 * Whether the plugin is switched on for one Session.
 *
 * The switch lives in the composer, is remembered per Session in the browser,
 * and is pushed here. Default is **off**: a Session that never turned it on does
 * not get the system-prompt section, and the model tool refuses to run.
 * A subagent Session inherits its parent's state so a delegated task can still
 * touch the plan its parent is using.
 */
const sessionFlags = new Map()

/**
 * The Session id behind an agent, whichever field carries it.
 * @param agent - the Session's agent.
 * @returns the id, or undefined.
 */
function sessionIdOf(agent) {
  const id = agent?.session?.id ?? agent?.session?.header?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Resolve the switch for one Session.
 *
 * A subagent Session is one-shot and has no composer, so it never gets a
 * switch: it reports back to the conversation that owns the plan instead.
 * @param agent - the Session's agent.
 * @returns whether the plugin is on for it.
 */
function sessionEnabled(agent) {
  return sessionEnabledById(sessionIdOf(agent), agent?.session?.header)
}

/**
 * Whether the Session is a one-shot subagent.
 * @param agent - the Session's agent.
 * @returns true when it was created by a delegation.
 */
function isSubagent(agent) {
  const header = agent?.session?.header
  return header?.origin === 'subagent' || header?.parentSession !== undefined
}

/**
 * Resolve the switch by raw ids (used where only an id is at hand).
 * @param id - the Session id.
 * @param header - its session header, when one is available.
 * @returns whether the plugin is on for it; unknown Sessions count as on.
 */
function sessionEnabledById(id, header) {
  if (header?.origin === 'subagent' || header?.parentSession !== undefined) return false
  if (typeof id !== 'string' || id === '') return true // No Session to scope by.
  return sessionFlags.get(id) === true
}

function cancelPendingForSession(sessionId, sessionObj) {
  for (const [key, bucket] of pending.entries()) {
    const keyId = typeof key === 'string' ? key : (key?.id ?? key?.header?.id)
    if ((sessionObj !== undefined && key === sessionObj)
      || (typeof sessionId === 'string' && sessionId !== '' && keyId === sessionId)) {
      clearTimeout(bucket.timer)
      pending.delete(key)
    }
  }
}

/**
 * Set the switch for one Session.
 * @param sessionId - the Session id.
 * @param enabled - whether the plugin is on.
 * @returns the value that was stored.
 */
export function setSessionEnabled(sessionId, enabled) {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const next = enabled === true
  sessionFlags.set(sessionId, next)
  if (!next) cancelPendingForSession(sessionId)
  return next
}

/** What the model is told when this Session has the panel switched on. */
const SESSION_PROMPT = [
  '## 项目计划面板（本会话已启用）',
  '右栏「项目计划」面板能显示两块板：**工作区公板**（工作区根目录的 todolist.json）和**本会话私板**（跟着这个对话走，存在 DSH 数据目录里）。',
  '用 todolist 工具读写它们，不要用 write/edit 直接改文件；工具默认作用在用户正看着的那块板（面板当前页签），两块板都存在且用户没说哪块时才需要问一句。',
  '分工：用户只勾「完成 / 未完成」；「进行中」（可多项）与「下一步」（单指针）由你维护。',
  '时机：用户明确要求时直接改；一轮工作有实质进展（开始做、做完、发现新任务）时顺手更新；与计划无关的闲聊不要动。',
  '写之前先 read 拿 id；一次只改一件事；标题只写「做什么」，不写状态。',
  '别的会话的私板只能读（board 传 session:<会话 id>），不能改，也不能替用户建。',
  '详细约定见技能 dsh-todo-plan。',
].join('\n')

/**
 * Build the user-role message a notification injects.
 *
 * `Agent.inject` and `Agent.followup` take a **UserMessage object**, not text.
 * A bare string lands in `agent/inbox/spliced.inserted` as a string, and the
 * session format rejects that on the *next load* — which corrupts the whole
 * session file instead of failing here. The shape mirrors
 * `createUserMessage({ content, source })` from `@deepseek-ai/dsh-llm`, which
 * this plugin cannot import from the profile.
 * @param text - the notice.
 * @returns a frozen-shaped user message.
 */
function noticeMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-todo', form: 'notice', summary: text },
  }
}

/**
 * Tell the agent what the user changed, honouring the plan's `ui.notify`:
 * `next-turn` injects into the next turn, `wake` starts one now, `off` stays
 * silent. Edits inside the plan's `ui.notifyWindow` (seconds) become one
 * message, so a burst of clicks is one transcript row instead of many.
 * @param agent - the Session's agent.
 * @param note - what changed, one short clause, or null for nothing worth telling.
 * @param ui - the plan's ui block (notify mode and window).
 * @param board - which board changed; shown so the agent does not edit the other one.
 */
function notifyAgent(agent, note, ui, board = 'public') {
  const session = agent?.session
  // Key by the Session id when it has one: the switch is stored per id, and a
  // queued notice must be cancellable from setSessionEnabled(sessionId).
  const key = (typeof session?.id === 'string' && session.id !== '') ? session.id : session
  // If notifications or the session switch were turned off, cancel any queued notice.
  if (ui?.notify === 'off' || agent === undefined || !sessionEnabled(agent)) {
    if (key !== undefined && pending.has(key)) {
      clearTimeout(pending.get(key).timer)
      pending.delete(key)
    }
    return
  }
  if (note === null) return
  const bucket = pending.get(key) ?? { notes: [], timer: undefined, notify: ui.notify }
  bucket.notify = ui.notify
  if (!bucket.notes.includes(note)) bucket.notes.push(note)
  if (bucket.timer !== undefined) clearTimeout(bucket.timer)
  const window = Math.max(1, Math.min(600, Number.isInteger(ui.notifyWindow) ? ui.notifyWindow : 8))
  bucket.timer = setTimeout(() => {
    pending.delete(key)
    if (!sessionEnabled(agent) || bucket.notify === 'off') return
    const text = `（面板）用户在${boardLabel(board)}上${bucket.notes.join('；')}。需要时用 todolist read 看最新计划；不要因为这条通知开始新工作。`
    try {
      const message = noticeMessage(text)
      // Belt and braces: a string here corrupts the Session on its next load,
      // and the write path cannot tell. Refuse anything that is not the object
      // shape instead of handing it to the log.
      const shaped = message !== null
        && typeof message === 'object'
        && typeof message.id === 'string'
        && message.role === 'user'
        && Array.isArray(message.content)
        && typeof message.source?.kind === 'string'
      if (!shaped) return
      if (bucket.notify === 'wake') agent.followup(message)
      else agent.inject(message)
    } catch {
      // A Session that has gone away has nobody to tell.
    }
  }, window * 1000)
  pending.set(key, bucket)
}

/**
 * One clause describing an operation, for the notification.
 * @param op - the applied operation.
 * @param plan - the plan after the write.
 * @param beforePlan - optional plan snapshot before the write (for `remove`).
 * @returns the clause.
 */
function describeOp(op, plan, beforePlan) {
  const findIn = (source, id) => {
    for (const item of source?.items ?? []) {
      if (item.id === id) return item
      for (const child of item.children ?? []) if (child.id === id) return child
    }
    return undefined
  }
  const find = id => findIn(plan, id) ?? findIn(beforePlan, id)
  const named = id => {
    const item = find(id)
    return item === undefined ? id : `「${item.title}」`
  }
  switch (op.op) {
    case 'status': return `把 ${named(op.id)} 标成了 ${op.status}`
    case 'toggle': return `切换了 ${named(op.id)} 的完成状态`
    case 'rename': return `把 ${named(op.id)} 改名为「${op.title}」`
    case 'add': return `新增了事项「${op.title}」`
    case 'addChild': return `给 ${named(op.parentId)} 加了子项「${op.title}」`
    case 'addGroup': return `新增了阶段「${op.title}」`
    case 'remove': return `删除了 ${named(op.id)}`
    case 'move': case 'reorder': return '调整了事项顺序'
    case 'reorderGroups': return '调整了阶段顺序'
    case 'due': return `改了 ${named(op.id)} 的截止日期`
    case 'settings':
      if (op.notify !== undefined) return `把通知方式改成 ${op.notify}`
      if (op.notifyWindow !== undefined) return `把通知合并窗口改成 ${op.notifyWindow} 秒`
      // Display-only changes (hide completed, look, materials) are not worth a
      // transcript row.
      return null
    case 'next': return op.id === null ? '取消了「下一步」' : `把 ${named(op.id)} 设为下一步`
    case 'note': return `改了 ${named(op.id)} 的备注`
    case 'repair': return '修复了计划文件里的坏项'
    default: return '修改了计划'
  }
}

const USAGE = '用法：/todo op {"path":"<绝对路径>","op":"toggle","id":"…"}'

/**
 * Resolve the real path of a file or its existing parent directory so symlink
 * escapes cannot bypass workspace containment checks.
 * @param target - candidate path.
 * @returns resolved real path.
 */
async function resolveReal(target) {
  try {
    return await realpath(target)
  } catch {
    try {
      return join(await realpath(dirname(target)), basename(target))
    } catch {
      return resolve(target)
    }
  }
}

/**
 * Whether a target path stays inside a root directory after resolving symlinks.
 * @param root - workspace root.
 * @param target - candidate path.
 * @returns whether `target` is the root or below it.
 */
async function insideWorkspace(root, target) {
  const realRoot = await resolveReal(root)
  const realTarget = await resolveReal(target)
  const rel = relative(realRoot, realTarget)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Find the plan file for a workspace: the root, then one directory deep. The
 * model tool cannot run the browser's search, so it walks the shallow case.
 * @param cwd - workspace root.
 * @returns the absolute path that most likely holds the plan.
 */
async function resolvePlanFile(cwd) {
  const direct = resolve(cwd, PLAN_FILE)
  if ((await readPlanFile(direct)).ok) return direct
  try {
    const entries = await readdir(cwd, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const candidate = resolve(cwd, entry.name, PLAN_FILE)
      if ((await readPlanFile(candidate)).ok) return candidate
    }
  } catch {
    // An unreadable workspace falls back to the root path, which reports the
    // real failure on the next read.
  }
  return direct
}

/**
 * Resolve both boards of one Session: where each one would live and whether it
 * exists. A board that exists but is broken still counts as existing, so the
 * panel can offer to repair it instead of pretending it is not there.
 * @param ctx - Host context.
 * @param exec - tool or command run context (`agent` is the Session).
 * @returns `{ cwd, sessionId, public: {path, exists}, private: {path, exists} }`.
 */
async function resolveBoards(ctx, exec) {
  const cwd = await planCwd(ctx, exec)
  const sessionId = sessionIdOf(exec.agent)
  const publicPath = typeof cwd === 'string' && cwd !== '' ? await resolvePlanFile(cwd) : undefined
  const privatePath = sessionId === undefined ? undefined : privateBoardFile(sessionId)
  return {
    cwd,
    sessionId,
    public: { path: publicPath, exists: await fileExists(publicPath) },
    private: { path: privatePath, exists: await fileExists(privatePath) },
  }
}

/**
 * Pick the board an operation is about.
 *
 * Order: what the caller named, then the tab the user is looking at, then the
 * only board that exists. With two boards and no hint the call is refused on
 * purpose — writing into the wrong board is worse than one extra question.
 * @param ctx - Host context.
 * @param exec - tool or command run context.
 * @param requested - `public` / `private` when the caller was explicit.
 * @returns `{ board, path, exists, boards }`.
 */
async function pickBoard(ctx, exec, requested) {
  const boards = await resolveBoards(ctx, exec)
  const active = activeBoards.get(boards.sessionId)
  const explicit = requested ?? active
  if (explicit === 'public' || explicit === 'private') {
    return { board: explicit, ...boards[explicit], boards }
  }
  const existing = ['public', 'private'].filter(name => boards[name].exists)
  if (existing.length === 1) return { board: existing[0], ...boards[existing[0]], boards }
  if (existing.length === 0) {
    // Nothing exists yet: a plain "create the plan" means the workspace board.
    return { board: 'public', ...boards.public, boards }
  }
  throw new Error('这个工作区和这个会话各有一块板（工作区公板 / 本会话私板）。'
    + '请用 board 参数说明改哪一块；用户没指定就问一句')
}

/**
 * Compact text of a plan for the model: stages, statuses, due dates, ids, and
 * which item is next. Markdown, not JSON — the file itself is one tool call away.
 * @param plan - validated plan.
 * @returns the summary.
 */
function summarize(plan) {
  const nextId = plan.ui.next ?? null
  const done = plan.items.filter(item => item.status === 'completed').length
  const lines = [`${plan.title || '计划'} · rev ${plan.rev} · 完成 ${done}/${plan.items.length}`]
  const mark = status => status === 'completed' ? 'x' : status === 'in_progress' ? '~' : ' '
  const groups = plan.groups.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const known = new Set(groups.map(group => group.id))
  const sections = [
    ...groups.map(group => ({ id: group.id, title: group.title, mode: group.mode })),
    ...(plan.items.some(item => item.groupId === undefined || !known.has(item.groupId))
      ? [{ id: '__none', title: '未分组', mode: 'free' }]
      : []),
  ]
  for (const section of sections) {
    const rows = plan.items
      .filter(item => (item.groupId ?? '__none') === section.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const sectionDone = rows.filter(item => item.status === 'completed').length
    lines.push('', `## ${section.title}（${section.mode}，${sectionDone}/${rows.length}）`)
    for (const item of rows) {
      const tags = [
        item.due === undefined ? '' : `截止 ${item.due}`,
        (item.after ?? []).length > 0 ? `前置 ${(item.after ?? []).join(',')}` : '',
        item.note === undefined ? '' : `备注 ${item.note}`,
        item.id === nextId ? '← 下一步' : '',
      ].filter(Boolean).join(' · ')
      lines.push(`- [${mark(item.status)}] ${item.title} (${item.id})${tags === '' ? '' : ' — ' + tags}`)
      for (const child of item.children ?? []) {
        lines.push(`  - [${mark(child.status)}] ${child.title} (${child.id})`)
      }
    }
  }
  const mode = plan.ui.notify ?? 'next-turn'
  lines.push('', `通知方式：${mode}`)
  return lines.join('\n')
}

/**
 * The `tools` service, however this context exposes it. A Host plugin's context
 * may offer it as a property, or only through service resolution; a miss must
 * never throw, because the panel and the command must keep working without it.
 * @param ctx - Host context.
 * @returns the registry, or undefined while `tools` is not active yet.
 */
function toolsService(ctx) {
  const usable = value => value !== null && value !== undefined && typeof value.register === 'function'
  try {
    if (typeof ctx.get === 'function' && usable(ctx.get('tools'))) return ctx.get('tools')
  } catch {
    // Service resolution failing means "not active yet", not "no tools".
  }
  try {
    return usable(ctx.tools) ? ctx.tools : undefined
  } catch {
    return undefined
  }
}

/** Where registration outcomes land, so a missing tool or skill is diagnosable. */
const STATUS_FILE = join(tmpdir(), 'dsh-todo-tool-status.json')

/**
 * Serializes the read-modify-write on {@link STATUS_FILE}.
 *
 * The tool registration runs asynchronously while the prompt and the skill
 * register synchronously, so three writers land at once and two of them used to
 * read the same old file and overwrite each other's key. The queue costs nothing
 * and keeps every outcome visible.
 */
let statusWrites = Promise.resolve()

/**
 * Record one registration outcome under its own key.
 * @param key - `tool`, `skill`, or `prompt`.
 * @param value - status fields.
 * @returns when the note is written (failures are ignored).
 */
function recordStatus(key, value) {
  const write = statusWrites.then(async () => {
    let previous = {}
    try {
      previous = JSON.parse(await readFile(STATUS_FILE, 'utf8'))
    } catch {
      // No file yet, or somebody left half a line: start over.
    }
    const next = { ...previous, [key]: { ...value, at: new Date().toISOString() } }
    try {
      await writeFile(STATUS_FILE, `${JSON.stringify(next)}\n`, 'utf8')
    } catch {
      // Diagnostics are best-effort.
    }
  }).catch(() => {})
  statusWrites = write
  return write
}

/**
 * The `skills` service, looked up the same defensive way as `tools`.
 * @param ctx - Host context.
 * @returns the registry, or undefined while `skills` is not active.
 */
function skillsService(ctx) {
  const usable = value => value !== null && value !== undefined && typeof value.register === 'function'
  try {
    if (typeof ctx.get === 'function' && usable(ctx.get('skills'))) return ctx.get('skills')
  } catch {
    // Not active yet.
  }
  try {
    return usable(ctx.skills) ? ctx.skills : undefined
  } catch {
    return undefined
  }
}

/** Used when `docs/AGENT.md` cannot be read (packaging accident). */
const SKILL_FALLBACK = '工作区里的 todolist.json 是用户的项目计划，右栏「项目计划」面板是它的界面。\n'
  + '用 `todolist` 工具读写它，不要手改文件。面板只负责「完成 / 未完成」；\n'
  + '「进行中」（可多项）与「下一步」（单指针）由你维护。先 `read` 拿 id，再写。'

/**
 * The `systemPrompt` service, looked up the same defensive way as the others.
 * @param ctx - Host context.
 * @returns the registry, or undefined.
 */
function systemPromptService(ctx) {
  const usable = value => value !== null && value !== undefined && typeof value.section === 'function'
  try {
    if (typeof ctx.get === 'function' && usable(ctx.get('systemPrompt'))) return ctx.get('systemPrompt')
  } catch {
    // Not active yet.
  }
  try {
    return usable(ctx.systemPrompt) ? ctx.systemPrompt : undefined
  } catch {
    return undefined
  }
}

/**
 * Contribute the "this Session has the panel on" instructions to the system
 * prompt. The text is resolved at every assembly, so switching the panel off
 * removes it from the next turn without leaving anything in the transcript.
 * @param ctx - Host context carrying the system-prompt registry.
 * @returns the section disposer, or a no-op when the service is unavailable.
 */
export function registerSessionPrompt(ctx) {
  const service = systemPromptService(ctx)
  if (service === undefined) {
    void recordStatus('prompt', { ok: false, deferred: true })
    return () => {}
  }
  try {
    const dispose = service.section({
      name: 'dsh-todo:session',
      // Just after the tool sections: it is operational guidance about a tool.
      order: 2360,
      text: context => (context?.agent !== undefined && sessionEnabled(context.agent) ? SESSION_PROMPT : ''),
    })
    void recordStatus('prompt', { ok: typeof dispose === 'function', name: 'dsh-todo:session' })
    return typeof dispose === 'function' ? dispose : () => {}
  } catch (error) {
    void recordStatus('prompt', { ok: false, error: String(error?.message ?? error) })
    console.error('[dsh-todo] 系统提示注册失败：', error)
    return () => {}
  }
}

/**
 * Register the agent-facing usage notes as a runtime skill, so any session with
 * this plugin can load them on demand instead of guessing the conventions.
 * @param ctx - Host context carrying the skill registry.
 * @param options - `content` overrides the shipped document (tests).
 * @returns the skill disposer, or a no-op when the service is unavailable.
 */
export function registerSkill(ctx, options = {}) {
  let content = options.content
  if (content === undefined) {
    try {
      content = readFileSync(new URL('./docs/AGENT.md', import.meta.url), 'utf8')
    } catch {
      content = SKILL_FALLBACK
    }
  }
  const skills = skillsService(ctx)
  if (skills === undefined) {
    void recordStatus('skill', { ok: false, deferred: true })
    return () => {}
  }
  try {
    const dispose = skills.register({
      name: 'dsh-todo-plan',
      description: 'Read or change the workspace plan (todolist.json) behind the right-sidebar Plan panel.',
      whenToUse: 'When the user asks about the plan, progress, what is next, or asks to add, finish, or reorder plan items.',
      source: 'runtime',
      invocation: { modelInvocable: true, userInvocable: false },
      content,
    })
    void recordStatus('skill', { ok: typeof dispose === 'function', name: 'dsh-todo-plan', chars: content.length })
    return typeof dispose === 'function' ? dispose : () => {}
  } catch (error) {
    void recordStatus('skill', { ok: false, error: String(error?.message ?? error) })
    console.error('[dsh-todo] 技能注册失败：', error)
    return () => {}
  }
}

/**
 * Build the tool definition the registry expects.
 *
 * `defineTool` from `@deepseek-ai/dsh-tools` compiles an authoring shorthand into
 * JSON Schema. Importing it from this plugin failed silently once (a linked
 * plugin resolves modules from its own checkout), and the tool then never
 * appeared on the model side; building the definition here removes that
 * dependency entirely and keeps the schema explicit.
 * @param options - `{ name, description, parameters, output, execute }`.
 * @returns a registry-ready definition.
 */
export function buildToolDefinition(options) {
  const compile = spec => {
    const properties = {}
    const required = []
    for (const [name, rule] of Object.entries(spec)) {
      const { required: isRequired, ...schema } = rule
      properties[name] = schema
      if (isRequired === true) required.push(name)
    }
    return { properties, required }
  }
  const params = compile(options.parameters)
  const output = compile(options.output.schema.properties ?? {})
  return {
    name: options.name,
    description: options.description,
    parameters: {
      type: 'object',
      properties: params.properties,
      ...(params.required.length === 0 ? {} : { required: params.required }),
    },
    output: {
      schema: {
        type: 'object',
        ...(options.output.schema.additionalProperties === false ? { additionalProperties: false } : {}),
        properties: output.properties,
        ...(output.required.length === 0 ? {} : { required: output.required }),
      },
      render: options.output.render,
    },
    async execute(args, exec) {
      const problems = checkArgs(options.parameters, args)
      if (problems.length > 0) {
        const error = new Error(`invalid arguments: ${problems.join('; ')}`)
        error.name = 'ToolArgsError'
        throw error
      }
      return options.execute(args, exec)
    },
  }
}

/**
 * Validate model-generated arguments against the declared parameter rules.
 * @param spec - parameter spec (same shorthand as the definition).
 * @param args - candidate arguments.
 * @returns one message per violation; empty means valid.
 */
const NULLABLE_PARAMS = new Set(['groupId', 'due', 'note'])

function checkArgs(spec, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['参数必须是对象']
  const problems = []
  for (const [name, rule] of Object.entries(spec)) {
    const value = args[name]
    if (value === undefined) {
      if (rule.required === true) problems.push(`缺少参数 ${name}`)
      continue
    }
    if (value === null && (NULLABLE_PARAMS.has(name) || (name === 'id' && (args.action === 'next' || args.action === 'addGroup')))) continue
    if (rule.enum !== undefined && !rule.enum.includes(value)) {
      problems.push(`${name} 必须是 ${rule.enum.join(' / ')}`)
    } else if (rule.type === 'string' && typeof value !== 'string') {
      problems.push(`${name} 必须是字符串`)
    } else if (rule.type === 'integer' && !Number.isInteger(value)) {
      problems.push(`${name} 必须是整数`)
    } else if (rule.type === 'boolean' && typeof value !== 'boolean') {
      problems.push(`${name} 必须是布尔值`)
    } else if (rule.type === 'array'
      && (!Array.isArray(value) || (rule.items?.type === 'string' && value.some(entry => typeof entry !== 'string')))) {
      problems.push(`${name} 必须是字符串数组`)
    }
  }
  for (const key of Object.keys(args)) {
    if (!(key in spec)) problems.push(`不认识的参数 ${key}`)
  }
  return problems
}

/**
 * The `workingDirectory` service, however this context exposes it. A Host plugin
 * may reach services through resolution or as a property; a miss must not throw.
 * @param ctx - Host context.
 * @returns the service, or undefined.
 */
function workingDirectoryService(ctx) {
  try {
    if (typeof ctx.get === 'function') {
      const service = ctx.get('workingDirectory')
      if (service !== undefined && service !== null) return service
    }
  } catch {
    // Resolution failing means "not active", not "no working directory".
  }
  try {
    return ctx.workingDirectory ?? undefined
  } catch {
    return undefined
  }
}

/**
 * The directory a Session is working in.
 *
 * `session.cwd` is not reliable: built-in tools resolve through the
 * `workingDirectory` service, which follows a `cd` and restores the original
 * project. Every fallback here has been observed missing at least once, so the
 * chain tries the service first and never throws.
 * @param ctx - Host context.
 * @param exec - tool or command run context.
 * @returns the directory, or undefined when nothing knows it.
 */
async function planCwd(ctx, exec) {
  const usable = value => typeof value === 'string' && value !== ''
  const service = workingDirectoryService(ctx)
  if (service !== undefined && exec.agent !== undefined) {
    try {
      if (typeof service.ensure === 'function') {
        const cwd = await service.ensure(exec.agent, exec.signal)
        if (usable(cwd)) return cwd
      }
    } catch {
      // Fall through: a missing directory must not hide the other sources.
    }
    try {
      if (typeof service.get === 'function') {
        const cwd = service.get(exec.agent?.session)
        if (usable(cwd)) return cwd
      }
    } catch {
      // Same.
    }
  }
  const session = exec.agent?.session
  const fallback = session?.cwd ?? session?.header?.cwd
  return usable(fallback) ? fallback : undefined
}

export async function registerTool(ctx, options = {}) {
  const build = options.buildTool ?? buildToolDefinition
  let tool
  try {
    tool = build({
      name: 'todolist',
      description: 'Read or change a plan board that the right-sidebar Plan panel shows. '
        + 'There can be two: the public board (a workspace file, todolist.json) and the private board (this conversation\'s own). '
        + 'Pass board to say which one; omit it to use the board the user is looking at, or the only one that exists. '
        + 'Actions: read, add, addChild, addGroup, status, rename, due, note, remove, move, reorder, reorderGroups, settings, next, open, create. '
        + 'Use it whenever the user asks about or changes a board; ids come from read.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: [
            'read', 'add', 'addChild', 'addGroup', 'status', 'rename', 'due', 'note',
            'remove', 'move', 'reorder', 'reorderGroups', 'settings', 'next', 'open', 'create',
          ],
          description: 'What to do.',
        },
        board: {
          type: 'string',
          description: 'Which board: "public" (the workspace board) or "private" (this conversation\'s board). '
            + 'Omit to use the board the user is looking at, or the only one that exists. '
            + '"session:<id>" reads another conversation\'s private board, read-only.',
        },
        id: { type: 'string', description: 'Item, child, or stage id (or "" / null to clear next).' },
        title: { type: 'string', description: 'Title for add, addChild, addGroup, rename, or create.' },
        parentId: { type: 'string', description: 'Parent item id for addChild.' },
        groupId: { type: 'string', description: 'Stage id for add, move, or reorder ("" / "__none" / null for ungrouped).' },
        mode: { type: 'string', enum: ['sequence', 'parallel', 'free'], description: 'Stage mode for addGroup.' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'New status.' },
        order: { type: 'integer', description: 'Order inside the stage (or stage order for addGroup).' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Ids in their new order, for reorder or reorderGroups.' },
        after: { type: 'array', items: { type: 'string' }, description: 'Prerequisite item ids for add.' },
        due: { type: 'string', description: 'ISO date (2026-12-01), or "" / null to clear.' },
        note: { type: 'string', description: 'Item note for note action ("" / null to clear) or add.' },
        hideCompleted: { type: 'boolean', description: 'Panel display setting.' },
        notify: { type: 'string', enum: ['next-turn', 'wake', 'off'], description: 'How panel edits reach you.' },
        notifyWindow: { type: 'integer', description: 'Seconds over which panel edits merge into one notice (1..600).' },
        style: { type: 'string', enum: ['md3', 'vivid', 'paper', 'calm'], description: 'Panel look: md3 (default, Material Design 3), vivid, paper, or calm.' },
        material: { type: 'boolean', description: 'Advanced materials (gradients, shadows, glass). Off is flatter and cheaper.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args, exec) {
        // The per-Session switch is the whole point: a Session that never turned
        // the panel on does not get to read or write a board. Subagents have no
        // composer and no switch, so they report back instead.
        if (isSubagent(exec.agent)) {
          throw new Error('这是子对话：没有计划面板，也没有开关。请把要改的地方回报给主对话，由主对话改计划')
        }
        if (!sessionEnabled(exec.agent)) {
          throw new Error('本会话没有启用计划面板：请先在输入框上方把「计划」开关打开')
        }

        // Another conversation's private board: readable by id, never writable.
        // Its file is derived from the id alone, so a crafted id cannot redirect it.
        if (typeof args.board === 'string' && args.board.startsWith('session:')) {
          if (args.action !== 'read') throw new Error('别的会话的私板只能读，不能改')
          const other = args.board.slice('session:'.length).trim()
          if (!isBoardSessionId(other)) throw new Error('会话 id 不合法：只能用会话 id，不能是路径')
          const read = await readPlanFile(privateBoardFile(other))
          if (!read.ok) throw new Error(read.error === 'missing' ? '那个会话还没有私板' : read.error)
          return { text: `【另一个会话的私板 · 只读】\n\n${summarize(read.plan)}` }
        }
        if (args.board !== undefined && args.board !== 'public' && args.board !== 'private') {
          throw new Error('board 只能是 public、private，或 session:<会话 id>')
        }

        const target = await pickBoard(ctx, exec, args.board)
        if (target.path === undefined) {
          throw new Error(target.board === 'private'
            ? '拿不到会话 id，读不到本会话的私板'
            : '拿不到会话工作区，读不到工作区公板')
        }
        const creating = args.action === 'create'
        if (!target.exists) {
          if (args.action === 'read') {
            throw new Error(`${boardLabel(target.board)}还没有创建。要建就用 create；不确定建哪块就问用户`)
          }
          // Any other action means "use this board": creating it is the write.
          const created = await createPlanFile(target.path, creating ? (args.title ?? '') : '')
          if (!created.ok) throw new Error(created.error === 'already-exists' ? '这块板已经存在' : created.error)
          if (creating) return { text: `已创建${boardLabel(target.board)}（rev ${created.rev}）。发一条 add 加第一件事。` }
        } else if (creating) {
          throw new Error(`${boardLabel(target.board)}已经存在，不用再建`)
        }

        const current = await readPlanFile(target.path)
        if (!current.ok) throw new Error(current.error)
        const plan = current.plan
        const other = target.board === 'public' ? target.boards.private : target.boards.public
        const otherNote = `\n\n另一块板：${boardLabel(target.board === 'public' ? 'private' : 'public')}`
          + `${other.exists ? '（已存在）' : '（还没有）'}。要改那块请带 board 参数。`
        if (args.action === 'read') return { text: `【${boardLabel(target.board)}】\n${summarize(plan)}${otherNote}` }

        let op
        switch (args.action) {
          case 'add':
            op = {
              op: 'add',
              title: args.title,
              ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
              ...(args.order === undefined ? {} : { order: args.order }),
              ...(args.after === undefined ? {} : { after: args.after }),
              ...(args.due === undefined || args.due === '' || args.due === null ? {} : { due: args.due }),
              ...(args.note === undefined || args.note === '' || args.note === null ? {} : { note: args.note }),
            }
            break
          case 'addChild':
            op = {
              op: 'addChild',
              parentId: args.parentId,
              title: args.title,
              ...(args.status === undefined ? {} : { status: args.status }),
            }
            break
          case 'addGroup':
            op = {
              op: 'addGroup',
              title: args.title,
              ...(args.id === undefined || args.id === null ? {} : { id: args.id }),
              ...(args.mode === undefined ? {} : { mode: args.mode }),
              ...(args.order === undefined ? {} : { order: args.order }),
            }
            break
          case 'status': op = { op: 'status', id: args.id, status: args.status }; break
          case 'rename': op = { op: 'rename', id: args.id, title: args.title }; break
          case 'due': op = { op: 'due', id: args.id, due: args.due === '' || args.due === null ? null : args.due }; break
          case 'note': op = { op: 'note', id: args.id, note: args.note === '' || args.note === null ? null : args.note }; break
          case 'remove': op = { op: 'remove', id: args.id }; break
          case 'move':
            op = {
              op: 'move',
              id: args.id,
              order: args.order,
              ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
            }
            break
          case 'reorder':
            op = {
              op: 'reorder',
              ids: args.ids,
              ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
            }
            break
          case 'reorderGroups': op = { op: 'reorderGroups', ids: args.ids }; break
          case 'settings': op = { op: 'settings', hideCompleted: args.hideCompleted, notify: args.notify, notifyWindow: args.notifyWindow, style: args.style, material: args.material }; break
          case 'next': op = { op: 'next', id: args.id ?? null }; break
          case 'open': op = { op: 'open' }; break
          default: throw new Error(`不认识的操作 ${args.action}`)
        }
        const result = await applyOpAndWrite(target.path, op)
        if (!result.ok) throw new Error(result.error)
        return { text: `${args.action} 完成（${boardLabel(target.board)}），rev ${result.rev}。\n\n${summarize(result.plan)}` }
      },
    })
  } catch (error) {
    await recordStatus('tool', { ok: false, error: String(error?.message ?? error) })
    console.error('[dsh-todo] 工具定义构建失败：', error)
    return () => {}
  }

  let disposed = false
  let registeredDispose
  let injectDispose
  const dispose = () => {
    disposed = true
    registeredDispose?.()
    injectDispose?.()
  }

  const attempt = async () => {
    if (disposed) return true
    const tools = toolsService(ctx)
    if (tools === undefined) return false
    try {
      const cleanup = tools.register(tool)
      if (typeof cleanup === 'function') {
        if (disposed) cleanup()
        else registeredDispose = cleanup
      }
      await recordStatus('tool', { ok: true, name: tool.name, parameters: Object.keys(tool.parameters.properties ?? {}).length })
    } catch (error) {
      await recordStatus('tool', { ok: false, error: String(error?.message ?? error) })
      console.error('[dsh-todo] 工具注册失败：', error)
    }
    return true
  }

  if (await attempt()) return dispose
  // `tools` was not active during apply; register as soon as it is. Never throw:
  // a missing tool must not take the panel or the command down with it.
  try {
    const inj = ctx.inject(['tools'], () => { if (!disposed) void attempt() })
    if (typeof inj === 'function') injectDispose = inj
    await recordStatus('tool', { ok: false, deferred: true })
  } catch (error) {
    await recordStatus('tool', { ok: false, error: String(error?.message ?? error) })
    console.error('[dsh-todo] 等待 tools 服务失败：', error)
  }
  return dispose
}

/**
 * Register the write command the panel drives, and the model-facing tool.
 * @param ctx - Host context carrying the command and tool registries.
 * @returns when the plugin is ready.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'todo',
    description: '修改当前工作区的计划文件（面板的写入通道）',
    input: { hint: 'op {"path":…,"op":…}' },
    handler: async ({ agent, rawInput }) => {
      const input = String(rawInput ?? '').trim()
      if (input === '') return { kind: 'error', text: USAGE }
      const space = input.indexOf(' ')
      const verb = space < 0 ? input : input.slice(0, space)
      const rest = space < 0 ? '' : input.slice(space + 1).trim()
      if (verb !== 'op') return { kind: 'error', text: USAGE }

      let payload
      try {
        payload = JSON.parse(rest)
      } catch (error) {
        return { kind: 'error', text: `命令里的 JSON 解析失败：${error.message}` }
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return { kind: 'error', text: '命令载荷必须是对象' }
      }

      const raw = payload.op
      let op
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        op = raw
      } else if (typeof raw === 'string' && raw !== '') {
        // Flat form (`{ path, op: "toggle", id }`): the operation fields sit
        // beside `path`. Accepted so an older panel keeps working.
        op = { ...payload, op: raw }
        delete op.path
        delete op.board
      } else {
        return { kind: 'error', text: 'op 字段必须是操作对象，例如 {"path":"…","op":{"op":"toggle","id":"…"}}' }
      }

      // The session switch is not a plan edit: it needs no path and no file.
      if (op.op === 'session') {
        const sessionId = sessionIdOf(agent)
        if (sessionId === undefined) return { kind: 'error', text: '拿不到会话 id，无法切换计划面板' }
        const enabled = setSessionEnabled(sessionId, op.enabled === true)
        return { kind: 'success', text: enabled ? '本会话已启用计划面板' : '本会话已停用计划面板' }
      }

      // Which tab the panel is on. The tool uses it as its default board.
      if (op.op === 'active') {
        const sessionId = sessionIdOf(agent)
        if (sessionId === undefined) return { kind: 'error', text: '拿不到会话 id，无法记住当前页签' }
        if (op.board !== 'public' && op.board !== 'private') return { kind: 'error', text: 'active 需要一个 board' }
        activeBoards.set(sessionId, op.board)
        return { kind: 'success', text: `当前页签：${boardLabel(op.board)}` }
      }

      // Both boards' paths and existence, for the panel's tab bar and empty
      // states. Reading needs no file, so this works before anything exists.
      if (op.op === 'boards') {
        const boards = await resolveBoards(ctx, { agent })
        return { kind: 'success', text: JSON.stringify({
          cwd: boards.cwd ?? null,
          public: { path: boards.public.path ?? null, exists: boards.public.exists },
          private: { path: boards.private.path ?? null, exists: boards.private.exists },
        }) }
      }

      const board = payload.board
      if (board !== undefined && board !== 'public' && board !== 'private') {
        return { kind: 'error', text: 'board 只能是 public 或 private' }
      }

      // Workspace cwd is mandatory for the public board (fail-closed); the
      // private board is anchored to the Session id and needs no workspace.
      const cwd = await planCwd(ctx, { agent })
      let file
      if (board === 'private') {
        const sessionId = sessionIdOf(agent)
        if (sessionId === undefined) return { kind: 'error', text: '拿不到会话 id，读不到本会话的私板' }
        file = privateBoardFile(sessionId)
        if (file === undefined) return { kind: 'error', text: '会话 id 不能用作目录名，读不到本会话的私板' }
      } else {
        if (typeof cwd !== 'string' || cwd === '') {
          return { kind: 'error', text: '拿不到会话工作区，无法修改计划文件' }
        }
        if (typeof payload.path === 'string' && payload.path !== '') {
          file = isAbsolute(payload.path) ? resolve(payload.path) : resolve(cwd, payload.path)
        } else if (op.op === 'create') {
          // Creating is the one write that may not know a path yet: the panel has
          // nothing to read, so the workspace root decides.
          file = resolve(cwd, PLAN_FILE)
        } else {
          return { kind: 'error', text: '缺少 path' }
        }
        if (basename(file) !== PLAN_FILE) {
          return { kind: 'error', text: `只允许修改名为 ${PLAN_FILE} 的文件` }
        }
        if (!(await insideWorkspace(cwd, file))) {
          return { kind: 'error', text: `路径不在会话工作区内：${file}` }
        }
      }

      if (op.op === 'create') {
        const created = await createPlanFile(file, typeof op.title === 'string' ? op.title : '')
        if (created.ok) return { kind: 'success', text: `已创建${boardLabel(board === 'private' ? 'private' : 'public')} rev ${created.rev}` }
        return { kind: 'error', text: created.error === 'already-exists' ? '这块板已存在' : created.error }
      }

      const beforeRead = op.op === 'remove' ? await readPlanFile(file) : undefined
      const result = await applyOpAndWrite(file, op)
      if (!result.ok) return { kind: 'error', text: result.error }
      notifyAgent(agent, describeOp(op, result.plan, beforeRead?.plan), result.plan.ui, board === 'private' ? 'private' : 'public')
      const notes = Array.isArray(result.notes) ? result.notes : []
      if (op.op === 'repair') {
        if (notes.length === 0) return { kind: 'success', text: '文件没有问题，不需要修复' }
        return { kind: 'success', text: `已修复 rev ${result.rev}：${notes.join('；')}` }
      }
      return { kind: 'success', text: `已保存 rev ${result.rev}` }
    },
  }), 'dsh-todo: todo command')
  // The tool and the skill are both optional: a composition without those
  // registries must not take the panel or the write command down with it.
  ctx.effect(() => {
    let active = true
    let cleanup
    void registerTool(ctx).then(fn => {
      if (!active) fn?.()
      else cleanup = fn
    })
    return () => {
      active = false
      cleanup?.()
    }
  }, 'dsh-todo: model tool')
  ctx.effect(() => () => {
    for (const bucket of pending.values()) clearTimeout(bucket.timer)
    pending.clear()
  }, 'dsh-todo: notification timers')
  ctx.effect(() => registerSessionPrompt(ctx), 'dsh-todo: session prompt')
  ctx.effect(() => registerSkill(ctx), 'dsh-todo: usage skill')
}
