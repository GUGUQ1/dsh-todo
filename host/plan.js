/**
 * The plan file's model: validation, operations, and atomic persistence.
 *
 * Pure functions (`validatePlan`, `applyOp`, `dueState`) carry the rules in
 * SPEC.md; the two I/O functions are the only places that touch the disk. The
 * Host tool (M4) and the user's write command (M3) both call `applyOp`, so the
 * two callers cannot drift apart.
 */
import { randomBytes } from 'node:crypto'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'

/** Default file name inside a workspace. */
export const PLAN_FILE = 'todolist.json'

/** Format version this build understands. */
export const PLAN_VERSION = 1

/** Item statuses accepted in the file and by operations. */
export const STATUSES = ['pending', 'in_progress', 'completed']

/** Group modes accepted in the file. */
export const MODES = ['sequence', 'parallel', 'free']

const TOP_KEYS = new Set(['version', 'rev', 'title', 'ui', 'groups', 'items'])
const UI_KEYS = new Set(['hideCompleted', 'openRequest', 'notify', 'next', 'notifyWindow', 'style', 'material'])
const GROUP_KEYS = new Set(['id', 'title', 'mode', 'order'])
const ITEM_KEYS = new Set(['id', 'groupId', 'order', 'title', 'status', 'after', 'due', 'note', 'children'])
const CHILD_KEYS = new Set(['id', 'title', 'status'])

/** How the Host tells the agent about a panel edit. */
export const NOTIFY_MODES = ['next-turn', 'wake', 'off']

/** Panel looks the user can pick between. */
export const STYLES = ['paper', 'calm', 'vivid', 'md3']

/**
 * A fresh, empty plan.
 * @param title - plan name.
 * @returns the plan.
 */
export function emptyPlan(title = '') {
  return {
    version: PLAN_VERSION,
    rev: 0,
    title,
    ui: { hideCompleted: false, openRequest: 0, notify: 'next-turn', notifyWindow: 8, style: 'vivid', material: true, next: null },
    groups: [],
    items: [],
  }
}

/**
 * Report keys that are not part of the format, so a typo fails loudly instead
 * of being silently dropped.
 * @param value - object to inspect.
 * @param allowed - accepted key names.
 * @param at - where the object sits, for the message.
 * @param errors - collected errors.
 */
function unknownKeys(value, allowed, at, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${at}: 未知字段 "${key}"`)
  }
}

/**
 * Validate one plan object.
 * @param value - parsed JSON.
 * @returns `{ ok: true, plan }` with a normalized copy, or `{ ok: false, errors }`.
 */
export function validatePlan(value) {
  const errors = []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['根节点必须是一个对象'] }
  }
  unknownKeys(value, TOP_KEYS, '根', errors)
  if (value.version !== PLAN_VERSION) errors.push(`version 必须是 ${PLAN_VERSION}`)
  if (!Number.isInteger(value.rev) || value.rev < 0) errors.push('rev 必须是非负整数')
  if (value.title !== undefined && typeof value.title !== 'string') errors.push('title 必须是字符串')

  const ui = value.ui ?? {}
  if (typeof ui !== 'object' || ui === null || Array.isArray(ui)) errors.push('ui 必须是对象')
  else {
    // `ui` is presentation state that a newer build may extend; unknown keys are
    // preserved instead of rejected, so a newer file never bricks an older host.
    if (ui.hideCompleted !== undefined && typeof ui.hideCompleted !== 'boolean') errors.push('ui.hideCompleted 必须是布尔值')
    if (ui.openRequest !== undefined && (!Number.isInteger(ui.openRequest) || ui.openRequest < 0)) errors.push('ui.openRequest 必须是非负整数')
    if (ui.notify !== undefined && !NOTIFY_MODES.includes(ui.notify)) errors.push(`ui.notify 必须是 ${NOTIFY_MODES.join(' / ')}`)
    if (ui.notifyWindow !== undefined
      && (!Number.isInteger(ui.notifyWindow) || ui.notifyWindow < 1 || ui.notifyWindow > 600)) {
      errors.push('ui.notifyWindow 必须是 1..600 的整数（秒）')
    }
    if (ui.next !== undefined && ui.next !== null && (typeof ui.next !== 'string' || ui.next === '')) {
      errors.push('ui.next 必须是事项 id 或 null')
    }
    if (ui.style !== undefined && !STYLES.includes(ui.style)) errors.push(`ui.style 必须是 ${STYLES.join(' / ')}`)
    if (ui.material !== undefined && typeof ui.material !== 'boolean') errors.push('ui.material 必须是布尔值')
  }

  const groups = value.groups
  if (!Array.isArray(groups)) errors.push('groups 必须是数组')
  const groupIds = new Set()
  for (const [index, group] of (Array.isArray(groups) ? groups : []).entries()) {
    const at = `groups[${index}]`
    if (group === null || typeof group !== 'object' || Array.isArray(group)) { errors.push(`${at} 必须是对象`); continue }
    unknownKeys(group, GROUP_KEYS, at, errors)
    if (typeof group.id !== 'string' || group.id === '') errors.push(`${at}.id 必须是非空字符串`)
    else if (groupIds.has(group.id)) errors.push(`${at}.id 重复: "${group.id}"`)
    else groupIds.add(group.id)
    if (typeof group.title !== 'string' || group.title === '') errors.push(`${at}.title 必须是非空字符串`)
    if (group.mode !== undefined && !MODES.includes(group.mode)) errors.push(`${at}.mode 必须是 ${MODES.join(' / ')}`)
    if (group.order !== undefined && !Number.isInteger(group.order)) errors.push(`${at}.order 必须是整数`)
  }

  const items = value.items
  if (!Array.isArray(items)) errors.push('items 必须是数组')
  const itemIds = new Set()
  const allIds = new Set()
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const at = `items[${index}]`
    if (item === null || typeof item !== 'object' || Array.isArray(item)) { errors.push(`${at} 必须是对象`); continue }
    unknownKeys(item, ITEM_KEYS, at, errors)
    if (typeof item.id !== 'string' || item.id === '') errors.push(`${at}.id 必须是非空字符串`)
    else if (itemIds.has(item.id)) errors.push(`${at}.id 重复: "${item.id}"`)
    else { itemIds.add(item.id); allIds.add(item.id) }
    if (item.groupId !== undefined && typeof item.groupId !== 'string') errors.push(`${at}.groupId 必须是字符串`)
    if (item.order !== undefined && !Number.isInteger(item.order)) errors.push(`${at}.order 必须是整数`)
    if (typeof item.title !== 'string' || item.title === '') errors.push(`${at}.title 必须是非空字符串`)
    if (!STATUSES.includes(item.status)) errors.push(`${at}.status 必须是 ${STATUSES.join(' / ')}`)
    if (item.due !== undefined && !isDueValue(item.due)) errors.push(`${at}.due 必须是 YYYY-MM-DD 或带时区的 ISO 时间`)
    if (item.note !== undefined && typeof item.note !== 'string') errors.push(`${at}.note 必须是字符串`)
    if (item.after !== undefined) {
      if (!Array.isArray(item.after)) errors.push(`${at}.after 必须是数组`)
      else {
        for (const dep of item.after) {
          if (typeof dep !== 'string' || dep === '') errors.push(`${at}.after 里的 id 必须是非空字符串`)
        }
      }
    }
    if (item.children !== undefined) {
      if (!Array.isArray(item.children)) errors.push(`${at}.children 必须是数组`)
      else {
        for (const [childIndex, child] of item.children.entries()) {
          const childAt = `${at}.children[${childIndex}]`
          if (child === null || typeof child !== 'object' || Array.isArray(child)) { errors.push(`${childAt} 必须是对象`); continue }
          unknownKeys(child, CHILD_KEYS, childAt, errors)
          if (typeof child.id !== 'string' || child.id === '') errors.push(`${childAt}.id 必须是非空字符串`)
          else if (allIds.has(child.id)) errors.push(`${childAt}.id 重复: "${child.id}"`)
          else allIds.add(child.id)
          if (typeof child.title !== 'string' || child.title === '') errors.push(`${childAt}.title 必须是非空字符串`)
          if (!STATUSES.includes(child.status)) errors.push(`${childAt}.status 必须是 ${STATUSES.join(' / ')}`)
        }
      }
    }
  }

  // Group references and dependencies only make sense once every id is known.
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item?.groupId === 'string' && !groupIds.has(item.groupId)) {
      errors.push(`items: "${item.id}" 的 groupId "${item.groupId}" 不存在`)
    }
    for (const dep of Array.isArray(item?.after) ? item.after : []) {
      if (!itemIds.has(dep)) errors.push(`items: "${item.id}" 依赖的 "${dep}" 不存在`)
      else if (dep === item.id) errors.push(`items: "${item.id}" 不能依赖自己`)
    }
  }
  if (errors.length === 0) {
    cycleError(items).forEach(message => errors.push(message))
    if (typeof ui?.next === 'string' && ui.next !== '' && !itemIds.has(ui.next)) {
      errors.push(`ui.next 指向的 "${ui.next}" 不存在`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    plan: {
      version: PLAN_VERSION,
      rev: value.rev,
      title: value.title ?? '',
      ui: {
        ...Object.fromEntries(Object.entries(ui).filter(([key]) => !UI_KEYS.has(key))),
        hideCompleted: ui.hideCompleted ?? false,
        openRequest: ui.openRequest ?? 0,
        notify: ui.notify ?? 'next-turn',
        notifyWindow: ui.notifyWindow ?? 8,
        style: STYLES.includes(ui.style) ? ui.style : 'vivid',
        material: ui.material ?? true,
        next: ui.next ?? null,
      },
      groups: groups.map(group => ({
        id: group.id,
        title: group.title,
        mode: group.mode ?? 'free',
        ...(group.order === undefined ? {} : { order: group.order }),
      })),
      items: items.map(item => ({
        id: item.id,
        ...(item.groupId === undefined ? {} : { groupId: item.groupId }),
        ...(item.order === undefined ? {} : { order: item.order }),
        title: item.title,
        status: item.status,
        ...(item.after === undefined ? {} : { after: [...item.after] }),
        ...(item.due === undefined ? {} : { due: item.due }),
        ...(item.note === undefined ? {} : { note: item.note }),
        ...(item.children === undefined ? {} : {
          children: item.children.map(child => ({ id: child.id, title: child.title, status: child.status })),
        }),
      })),
    },
  }
}

/**
 * Rebuild a plan object, dropping whatever `validatePlan` would reject.
 *
 * Every write validates the whole file, so one hand-edited row without a title
 * used to disable every operation at once. This is the escape hatch behind the
 * panel's "移除坏项" button: it keeps everything it can still trust and reports
 * what it had to drop.
 * @param value - parsed JSON, possibly invalid.
 * @returns `{ ok: true, plan, notes }`, or `{ ok: false, error, notes }` when the
 *   remaining damage cannot be rebuilt.
 */
export function repairPlan(value) {
  const notes = []
  const isObject = candidate => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
  const raw = isObject(value) ? value : {}
  if (raw !== value) notes.push('根节点不是对象，已按空计划重建')
  if (raw.version !== undefined && raw.version !== PLAN_VERSION) {
    notes.push(`version 是 ${String(raw.version)}，已写成 ${PLAN_VERSION}`)
  }
  const drop = (at, why) => { notes.push(`${at} ${why}，已移除`) }
  const dropUnknown = (obj, allowed, label) => {
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) notes.push(`${label} 的未知字段「${key}」已移除`)
    }
  }
  if (raw === value) {
    dropUnknown(raw, TOP_KEYS, '根')
    if (!Number.isInteger(raw.rev) || raw.rev < 0) notes.push('rev 不合法，已重置为 0')
    if (raw.title !== undefined && typeof raw.title !== 'string') notes.push('title 不是字符串，已清空')
    if (raw.groups !== undefined && !Array.isArray(raw.groups)) notes.push('groups 不是数组，已按空数组重建')
    if (raw.items !== undefined && !Array.isArray(raw.items)) notes.push('items 不是数组，已按空数组重建')
    if (raw.ui !== undefined && !isObject(raw.ui)) notes.push('ui 不是对象，已重置')
  }

  const groups = []
  const groupIds = new Set()
  for (const [index, group] of (Array.isArray(raw.groups) ? raw.groups : []).entries()) {
    const at = `groups[${index}]`
    if (!isObject(group)) { drop(at, '不是对象'); continue }
    const id = typeof group.id === 'string' ? group.id.trim() : ''
    const title = typeof group.title === 'string' ? group.title.trim() : ''
    if (id === '') { drop(at, '缺 id'); continue }
    if (groupIds.has(id)) { drop(at, `id 重复（${id}）`); continue }
    if (title === '') { drop(at, `「${id}」缺标题`); continue }
    dropUnknown(group, GROUP_KEYS, `${at}「${title}」`)
    if (group.mode !== undefined && !MODES.includes(group.mode)) notes.push(`${at}.mode 不合法，已改成 free`)
    if (group.order !== undefined && !Number.isInteger(group.order)) notes.push(`${at}.order 不是整数，已重排`)
    groupIds.add(id)
    groups.push({
      id,
      title,
      mode: MODES.includes(group.mode) ? group.mode : 'free',
      ...(Number.isInteger(group.order) ? { order: group.order } : {}),
    })
  }

  const items = []
  const itemIds = new Set()
  const allIds = new Set()
  for (const [index, item] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    const at = `items[${index}]`
    if (!isObject(item)) { drop(at, '不是对象'); continue }
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (id === '') { drop(at, '缺 id'); continue }
    if (itemIds.has(id)) { drop(at, `id 重复（${id}）`); continue }
    if (title === '') { drop(at, `「${id}」缺标题`); continue }
    itemIds.add(id)
    allIds.add(id)
    dropUnknown(item, ITEM_KEYS, `${at}「${title}」`)

    if (!STATUSES.includes(item.status)) notes.push(`${at}「${title}」的状态不合法，已改成 pending`)
    if (item.order !== undefined && !Number.isInteger(item.order)) notes.push(`${at}「${title}」的 order 不是整数，已移除`)
    if (item.groupId !== undefined && typeof item.groupId !== 'string') {
      notes.push(`${at}「${title}」的 groupId 不是字符串，已移到未分组`)
    }
    const groupId = typeof item.groupId === 'string' && groupIds.has(item.groupId) ? item.groupId : undefined
    if (typeof item.groupId === 'string' && groupId === undefined) {
      notes.push(`${at}「${title}」的阶段「${item.groupId}」不存在，已移到未分组`)
    }
    if (item.after !== undefined && !Array.isArray(item.after)) notes.push(`${at}「${title}」的 after 不是数组，已清掉`)
    if (item.due !== undefined && !isDueValue(item.due)) notes.push(`${at}「${title}」的截止日期不合法，已清掉`)
    if (item.note !== undefined && typeof item.note !== 'string') notes.push(`${at}「${title}」的备注不是字符串，已清掉`)
    if (item.children !== undefined && !Array.isArray(item.children)) notes.push(`${at}「${title}」的 children 不是数组，已清掉`)

    const children = []
    for (const [childIndex, child] of (Array.isArray(item.children) ? item.children : []).entries()) {
      const childAt = `${at}.children[${childIndex}]`
      if (!isObject(child)) { drop(childAt, '不是对象'); continue }
      const childId = typeof child.id === 'string' ? child.id.trim() : ''
      const childTitle = typeof child.title === 'string' ? child.title.trim() : ''
      if (childId === '') { drop(childAt, '缺 id'); continue }
      if (allIds.has(childId)) { drop(childAt, `id 重复（${childId}）`); continue }
      if (childTitle === '') { drop(childAt, `「${childId}」缺标题`); continue }
      allIds.add(childId)
      dropUnknown(child, CHILD_KEYS, `${childAt}「${childTitle}」`)
      if (!STATUSES.includes(child.status)) notes.push(`${childAt}「${childTitle}」的状态不合法，已改成 pending`)
      children.push({ id: childId, title: childTitle, status: STATUSES.includes(child.status) ? child.status : 'pending' })
    }

    items.push({
      id,
      ...(groupId === undefined ? {} : { groupId }),
      ...(Number.isInteger(item.order) ? { order: item.order } : {}),
      title,
      status: STATUSES.includes(item.status) ? item.status : 'pending',
      // Dependencies are filtered once every id is known, below.
      ...(Array.isArray(item.after) ? { after: item.after } : {}),
      ...(isDueValue(item.due) ? { due: item.due } : {}),
      ...(typeof item.note === 'string' ? { note: item.note } : {}),
      ...(children.length === 0 ? {} : { children }),
    })
  }

  // Dependencies may only point at another item (not a child), once, and never
  // at themselves.
  for (const item of items) {
    if (item.after === undefined) continue
    const kept = []
    let lost = 0
    for (const dep of item.after) {
      if (typeof dep !== 'string' || dep === '' || dep === item.id || !itemIds.has(dep) || kept.includes(dep)) { lost += 1; continue }
      kept.push(dep)
    }
    if (lost > 0) notes.push(`「${item.title}」有 ${lost} 条依赖指向不存在的事项，已去掉`)
    if (kept.length === 0) delete item.after
    else item.after = kept
  }

  // A cycle is a validation error as well: drop the edge that closes it.
  const byId = new Map(items.map(item => [item.id, item]))
  const seen = new Map()
  const walk = id => {
    if (seen.has(id)) return
    seen.set(id, 'open')
    const item = byId.get(id)
    const deps = item.after ?? []
    const kept = []
    for (const dep of deps) {
      if (seen.get(dep) === 'open') { notes.push(`依赖成环（${item.title} -> ${byId.get(dep)?.title ?? dep}），已去掉这条依赖`); continue }
      kept.push(dep)
      walk(dep)
    }
    if (kept.length !== deps.length) {
      if (kept.length === 0) delete item.after
      else item.after = kept
    }
    seen.set(id, 'done')
  }
  for (const item of items) walk(item.id)

  const rawUi = isObject(raw.ui) ? raw.ui : {}
  const ui = {}
  for (const [key, entry] of Object.entries(rawUi)) if (!UI_KEYS.has(key)) ui[key] = entry
  if (rawUi.hideCompleted !== undefined && typeof rawUi.hideCompleted !== 'boolean') {
    notes.push('ui.hideCompleted 不合法，已重置为 false')
  }
  if (typeof rawUi.hideCompleted === 'boolean') ui.hideCompleted = rawUi.hideCompleted
  if (rawUi.openRequest !== undefined && (!Number.isInteger(rawUi.openRequest) || rawUi.openRequest < 0)) {
    notes.push('ui.openRequest 不合法，已重置为 0')
  }
  if (Number.isInteger(rawUi.openRequest) && rawUi.openRequest >= 0) ui.openRequest = rawUi.openRequest
  if (rawUi.notify !== undefined && !NOTIFY_MODES.includes(rawUi.notify)) {
    notes.push('ui.notify 不合法，已改成 next-turn')
  }
  if (NOTIFY_MODES.includes(rawUi.notify)) ui.notify = rawUi.notify
  if (rawUi.notifyWindow !== undefined && (!Number.isInteger(rawUi.notifyWindow) || rawUi.notifyWindow < 1 || rawUi.notifyWindow > 600)) {
    notes.push('ui.notifyWindow 不合法，已重置为 8')
  }
  if (Number.isInteger(rawUi.notifyWindow) && rawUi.notifyWindow >= 1 && rawUi.notifyWindow <= 600) {
    ui.notifyWindow = rawUi.notifyWindow
  }
  if (rawUi.next !== undefined && rawUi.next !== null && typeof rawUi.next !== 'string') {
    notes.push('「下一步」不合法，已清掉')
  }
  const next = typeof rawUi.next === 'string' && itemIds.has(rawUi.next) ? rawUi.next : null
  if (typeof rawUi.next === 'string' && next === null) notes.push('「下一步」指向的事项不存在，已清掉')
  if (rawUi.style !== undefined && !STYLES.includes(rawUi.style)) notes.push('ui.style 不合法，已改成 vivid')
  const style = STYLES.includes(rawUi.style) ? rawUi.style : 'vivid'
  if (rawUi.material !== undefined && typeof rawUi.material !== 'boolean') {
    notes.push('ui.material 不合法，已重置为 true')
  }
  const material = typeof rawUi.material === 'boolean' ? rawUi.material : true

  const plan = {
    version: PLAN_VERSION,
    rev: Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0,
    title: typeof raw.title === 'string' ? raw.title : '',
    ui: {
      ...ui,
      hideCompleted: ui.hideCompleted ?? false,
      openRequest: ui.openRequest ?? 0,
      notify: ui.notify ?? 'next-turn',
      notifyWindow: ui.notifyWindow ?? 8,
      style,
      material,
      next,
    },
    groups,
    items,
  }
  const checked = validatePlan(plan)
  if (!checked.ok) return { ok: false, error: checked.errors.join('; '), notes }
  return { ok: true, plan: checked.plan, notes }
}

/**
 * Whether a string is an acceptable due value: a plain date, or an ISO instant
 * with an explicit offset.
 * @param value - candidate.
 * @returns whether it parses and carries a date.
 */
export function isDueValue(value) {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * Report every dependency cycle reachable from the plan's items.
 * @param items - validated items.
 * @returns one message per cycle found.
 */
function cycleError(items) {
  const byId = new Map(items.map(item => [item.id, item]))
  const state = new Map()
  const messages = []
  const walk = (id, trail) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'open') {
      messages.push(`依赖成环: ${[...trail, id].join(' -> ')}`)
      return
    }
    state.set(id, 'open')
    for (const dep of byId.get(id).after ?? []) walk(dep, [...trail, id])
    state.set(id, 'done')
  }
  for (const item of items) walk(item.id, [])
  return messages
}

/**
 * How a due value reads today.
 * @param due - the stored value.
 * @param now - reference instant.
 * @returns `'overdue' | 'today' | 'future' | 'none'`, and the day difference for a future date.
 */
export function dueState(due, now = new Date()) {
  if (due === undefined || due === '') return { kind: 'none' }
  const target = due.length === 10 ? new Date(`${due}T23:59:59`) : new Date(due)
  if (Number.isNaN(target.getTime())) return { kind: 'none' }
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000)
  if (days < 0) return { kind: 'overdue', days }
  if (days === 0) return { kind: 'today', days }
  return { kind: 'future', days }
}

/** Every item id in the plan, parents before children. */
function allItems(plan) {
  const flat = []
  for (const item of plan.items) {
    flat.push(item)
    for (const child of item.children ?? []) flat.push(child)
  }
  return flat
}

/**
 * Apply one operation to a plan, returning a new plan. The plan is not written
 * here: `writePlanFile` bumps `rev` and persists.
 * @param plan - current plan.
 * @param op - `{ op: string, ... }` as listed in SPEC.md.
 * @param nextId - id generator for added rows; must be unique in the plan.
 * @returns `{ ok: true, plan }` or `{ ok: false, error }`.
 */
export function applyOp(plan, op, nextId = defaultNextId(plan)) {
  if (op === null || typeof op !== 'object') return { ok: false, error: '操作必须是对象' }
  const next = structuredClone(plan)
  const items = () => next.items
  const find = id => {
    for (const item of items()) {
      if (item.id === id) return item
      for (const child of item.children ?? []) if (child.id === id) return child
    }
    return undefined
  }
  const fail = error => ({ ok: false, error })
  const done = () => {
    const checked = validatePlan({ ...next, rev: plan.rev })
    return checked.ok ? { ok: true, plan: next } : fail(checked.errors.join('; '))
  }
  const groupKeyOf = candidate => candidate.groupId ?? '__none'
  const renumberStage = (groupKeyValue, pinnedItem, targetOrder = 1) => {
    const others = items()
      .filter(candidate => candidate !== pinnedItem && groupKeyOf(candidate) === groupKeyValue)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    if (pinnedItem !== undefined && groupKeyOf(pinnedItem) === groupKeyValue) {
      const slot = Math.max(0, Math.min(others.length, targetOrder - 1))
      others.splice(slot, 0, pinnedItem)
    }
    others.forEach((candidate, index) => { candidate.order = index + 1 })
  }

  switch (op.op) {
    case 'status': {
      const item = find(op.id)
      if (item === undefined) return fail(`找不到事项 "${op.id}"`)
      if (!STATUSES.includes(op.status)) return fail(`status 必须是 ${STATUSES.join(' / ')}`)
      item.status = op.status
      // The panel owns "done"; a finished item cannot stay "next".
      if (op.status === 'completed' && next.ui.next === op.id) next.ui.next = null
      return done()
    }
    case 'toggle': {
      const item = find(op.id)
      if (item === undefined) return fail(`找不到事项 "${op.id}"`)
      item.status = item.status === 'completed' ? 'pending' : 'completed'
      if (item.status === 'completed' && next.ui.next === item.id) next.ui.next = null
      return done()
    }
    case 'rename': {
      const item = find(op.id)
      if (item === undefined) return fail(`找不到事项 "${op.id}"`)
      const title = typeof op.title === 'string' ? op.title.trim() : ''
      if (title === '') return fail('title 不能为空')
      item.title = title
      return done()
    }
    case 'due': {
      const item = find(op.id)
      if (item === undefined) return fail(`找不到事项 "${op.id}"`)
      if (op.due === null || op.due === '') delete item.due
      else if (isDueValue(op.due)) item.due = op.due
      else return fail('due 必须是 YYYY-MM-DD 或带时区的 ISO 时间')
      return done()
    }
    case 'note': {
      const item = find(op.id)
      if (item === undefined) return fail(`找不到事项 "${op.id}"`)
      if (op.note === null || op.note === '') delete item.note
      else item.note = String(op.note)
      return done()
    }
    case 'add': {
      const title = typeof op.title === 'string' ? op.title.trim() : ''
      if (title === '') return fail('title 不能为空')
      const ungrouped = op.groupId === null || op.groupId === '__none' || op.groupId === ''
      const groupId = ungrouped ? undefined : op.groupId
      if (groupId !== undefined && !next.groups.some(group => group.id === groupId)) return fail(`找不到阶段 "${groupId}"`)
      const groupKey = groupId ?? '__none'
      const stageCount = items().filter(candidate => groupKeyOf(candidate) === groupKey).length
      const order = Number.isInteger(op.order) ? op.order : (stageCount + 1)
      const item = {
        id: nextId(), ...(groupId === undefined ? {} : { groupId }), order, title, status: 'pending',
        ...(Array.isArray(op.after) && op.after.length > 0 ? { after: op.after } : {}),
        ...(isDueValue(op.due) ? { due: op.due } : {}),
        ...(typeof op.note === 'string' && op.note !== '' ? { note: op.note } : {}),
      }
      items().push(item)
      renumberStage(groupKey, item, order)
      return done()
    }
    case 'addChild': {
      const parent = items().find(item => item.id === op.parentId)
      if (parent === undefined) return fail(`找不到父事项 "${op.parentId}"`)
      const title = typeof op.title === 'string' ? op.title.trim() : ''
      if (title === '') return fail('title 不能为空')
      parent.children = [...(parent.children ?? []), { id: nextId(), title, status: op.status ?? 'pending' }]
      return done()
    }
    case 'remove': {
      const index = items().findIndex(item => item.id === op.id)
      if (next.ui.next === op.id) next.ui.next = null
      if (index >= 0) {
        items().splice(index, 1)
        for (const item of items()) {
          if (item.after !== undefined) {
            item.after = item.after.filter(dep => dep !== op.id)
            if (item.after.length === 0) delete item.after
          }
        }
        return done()
      }
      for (const item of items()) {
        if (item.children === undefined) continue
        const childIndex = item.children.findIndex(child => child.id === op.id)
        if (childIndex >= 0) {
          item.children.splice(childIndex, 1)
          return done()
        }
      }
      return fail(`找不到事项 "${op.id}"`)
    }
    case 'move': {
      const item = items().find(candidate => candidate.id === op.id)
      if (item === undefined) return fail(`找不到事项 "${op.id}"`)
      if (!Number.isInteger(op.order)) return fail('order 必须是整数')
      const prevKey = groupKeyOf(item)
      if (op.groupId !== undefined) {
        if (op.groupId === null || op.groupId === '__none' || op.groupId === '') {
          delete item.groupId
        } else if (!next.groups.some(group => group.id === op.groupId)) {
          return fail(`找不到阶段 "${op.groupId}"`)
        } else {
          item.groupId = op.groupId
        }
      }
      const nextKey = groupKeyOf(item)
      renumberStage(nextKey, item, op.order)
      if (prevKey !== nextKey) renumberStage(prevKey)
      return done()
    }
    case 'addGroup': {
      const title = typeof op.title === 'string' ? op.title.trim() : ''
      if (title === '') return fail('title 不能为空')
      const id = typeof op.id === 'string' && op.id !== '' ? op.id : nextId()
      if (next.groups.some(group => group.id === id)) return fail(`阶段 "${id}" 已存在`)
      if (op.mode !== undefined && !MODES.includes(op.mode)) return fail(`mode 必须是 ${MODES.join(' / ')}`)
      next.groups.push({
        id, title, mode: op.mode ?? 'free',
        ...(Number.isInteger(op.order) ? { order: op.order } : { order: next.groups.length + 1 }),
      })
      return done()
    }
    case 'settings': {
      if (op.hideCompleted !== undefined) {
        if (typeof op.hideCompleted !== 'boolean') return fail('hideCompleted 必须是布尔值')
        next.ui.hideCompleted = op.hideCompleted
      }
      if (op.notify !== undefined) {
        if (!NOTIFY_MODES.includes(op.notify)) return fail(`notify 必须是 ${NOTIFY_MODES.join(' / ')}`)
        next.ui.notify = op.notify
      }
      if (op.notifyWindow !== undefined) {
        if (!Number.isInteger(op.notifyWindow) || op.notifyWindow < 1 || op.notifyWindow > 600) {
          return fail('notifyWindow 必须是 1..600 的整数（秒）')
        }
        next.ui.notifyWindow = op.notifyWindow
      }
      if (op.style !== undefined) {
        if (!STYLES.includes(op.style)) return fail(`style 必须是 ${STYLES.join(' / ')}`)
        next.ui.style = op.style
      }
      if (op.material !== undefined) {
        if (typeof op.material !== 'boolean') return fail('material 必须是布尔值')
        next.ui.material = op.material
      }
      return done()
    }
    case 'next': {
      if (op.id === null || op.id === undefined || op.id === '') {
        next.ui.next = null
        return done()
      }
      const item = items().find(candidate => candidate.id === op.id)
      if (item === undefined) return fail(`找不到事项 "${op.id}"`)
      if (item.status === 'completed') return fail(`「${item.title}」已完成，先把它改回未完成再设为下一步`)
      next.ui.next = op.id
      return done()
    }
    case 'reorder': {
      if (!Array.isArray(op.ids) || op.ids.some(id => typeof id !== 'string')) return fail('ids 必须是字符串数组')
      const toUngrouped = op.groupId === null || op.groupId === '__none' || op.groupId === ''
      if (op.groupId !== undefined && !toUngrouped) {
        if (typeof op.groupId !== 'string' || !next.groups.some(group => group.id === op.groupId)) {
          return fail(`找不到阶段 "${op.groupId}"`)
        }
      }
      const byId = new Map(items().map(item => [item.id, item]))
      const seen = new Set()
      for (const id of op.ids) {
        const item = byId.get(id)
        if (item === undefined) return fail(`找不到事项 "${id}"`)
        if (seen.has(id)) return fail(`ids 里 "${id}" 重复`)
        seen.add(id)
        if (op.groupId !== undefined) {
          if (toUngrouped) delete item.groupId
          else item.groupId = op.groupId
        }
      }
      const groupKey = item => item.groupId ?? '__none'
      const counters = new Map()
      for (const id of op.ids) {
        const item = byId.get(id)
        const key = groupKey(item)
        const n = (counters.get(key) ?? 0) + 1
        counters.set(key, n)
        item.order = n
      }
      const remaining = items()
        .filter(item => !seen.has(item.id))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      for (const item of remaining) {
        const key = groupKey(item)
        const n = (counters.get(key) ?? 0) + 1
        counters.set(key, n)
        item.order = n
      }
      return done()
    }
    case 'reorderGroups': {
      if (!Array.isArray(op.ids) || op.ids.some(id => typeof id !== 'string')) return fail('ids 必须是字符串数组')
      const byId = new Map(next.groups.map(group => [group.id, group]))
      const seen = new Set()
      let order = 1
      for (const id of op.ids) {
        const group = byId.get(id)
        if (group === undefined) return fail(`找不到阶段 "${id}"`)
        if (seen.has(id)) return fail(`ids 里 "${id}" 重复`)
        seen.add(id)
        group.order = order++
      }
      const remaining = next.groups
        .filter(group => !seen.has(group.id))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      for (const group of remaining) group.order = order++
      return done()
    }
    case 'open': {
      next.ui.openRequest = (next.ui.openRequest ?? 0) + 1
      return { ok: true, plan: next }
    }
    default:
      return fail(`不认识的操作 "${op.op}"`)
  }
}

/**
 * Create a plan file that does not exist yet. Refuses when one is already
 * there, or when the existing file is not empty/valid — a broken file is never
 * overwritten by a create.
 * @param file - absolute path.
 * @param title - plan name for the new file.
 * @returns `{ ok: true, rev }` or `{ ok: false, error }`.
 */
export async function createPlanFile(file, title = '') {
  const existing = await readPlanFile(file)
  if (existing.ok) return { ok: false, error: 'already-exists' }
  if (existing.error !== 'missing') return { ok: false, error: existing.error }
  return writePlanFile(file, emptyPlan(title))
}

/**
 * Read the plan, apply one operation, and write it back under the version the
 * read saw. The command surface (M3) and the model tool (M4) share this entry.
 * @param file - absolute path of the plan file.
 * @param op - the operation to apply.
 * @param options - `expectedVersion` overrides the version the read reported.
 * @returns `{ ok: true, rev, plan }` or `{ ok: false, error }`.
 */
export async function applyOpAndWrite(file, op, { expectedVersion } = {}) {
  // Repair is the one operation that has to run on a file validation rejects;
  // every other op needs a readable plan first.
  if (op !== null && typeof op === 'object' && op.op === 'repair') return repairPlanFile(file, { expectedVersion })
  const read = await readPlanFile(file)
  if (!read.ok) return { ok: false, error: read.error }
  const applied = applyOp(read.plan, op)
  if (!applied.ok) return { ok: false, error: applied.error }
  return writePlanFile(file, applied.plan, { expectedVersion: expectedVersion ?? read.version })
}

/**
 * Build an id generator that avoids every existing id in the plan.
 * @param plan - the plan the generator is for.
 * @returns a function producing short unique ids.
 */
export function defaultNextId(plan) {
  const taken = new Set(allItems(plan).map(item => item.id))
  for (const group of plan.groups) taken.add(group.id)
  return () => {
    for (;;) {
      const id = `t${randomBytes(3).toString('hex')}`
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
  }
}

/**
 * Read and validate a plan file.
 * @param file - absolute path.
 * @returns `{ ok: true, plan, text, version }`; `version` is the file's stat
 *   version when the backend reports one, for the pre-write check.
 */
export async function readPlanFile(file) {
  let text
  let version
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await stat(file).catch(() => undefined)
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: false, error: 'missing' }
      return { ok: false, error: `read-failed: ${error?.message ?? String(error)}` }
    }
    const after = await stat(file).catch(() => undefined)
    const beforeVer = before === undefined ? undefined : `${before.size}:${before.mtimeMs}`
    const afterVer = after === undefined ? undefined : `${after.size}:${after.mtimeMs}`
    if (beforeVer !== undefined && beforeVer === afterVer) {
      version = beforeVer
      break
    }
    // Concurrent modification during read: retry once, then poison version so
    // any subsequent write refuses to overwrite instead of skipping the check.
    version = before !== undefined || after !== undefined ? 'stale' : undefined
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `invalid-json: ${error.message}`, text }
  }
  const checked = validatePlan(parsed)
  if (!checked.ok) return { ok: false, error: `invalid-plan: ${checked.errors.join('; ')}`, text }
  return { ok: true, plan: checked.plan, text, version }
}

/**
 * Write a plan atomically: a sibling temp file, then a rename over the target.
 * @param file - absolute path.
 * @param plan - the plan to write; `rev` is incremented here.
 * @param options - `expectedVersion` comes from `readPlanFile`; when the file
 *   changed since, the write is refused instead of overwriting.
 * @returns `{ ok: true, rev, plan }` or `{ ok: false, error }`.
 */
export async function writePlanFile(file, plan, { expectedVersion } = {}) {
  if (expectedVersion !== undefined) {
    const info = await stat(file).catch(() => undefined)
    const current = info === undefined ? undefined : `${info.size}:${info.mtimeMs}`
    if (current !== expectedVersion) {
      return { ok: false, error: 'stale: 文件自上次读取后已变化，请重读后再改' }
    }
  }
  const next = { ...structuredClone(plan), rev: plan.rev + 1 }
  const checked = validatePlan(next)
  if (!checked.ok) return { ok: false, error: `invalid-plan: ${checked.errors.join('; ')}` }
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(checked.plan, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    return { ok: false, error: `write-failed: ${error?.message ?? String(error)}` }
  }
  return { ok: true, rev: checked.plan.rev, plan: checked.plan }
}

/**
 * Repair a file that `readPlanFile` rejects: parse it as-is, rebuild what can be
 * trusted, and write the result back. Refuses two cases on purpose — missing
 * file (nothing to repair) and broken JSON (a text problem, not a shape one).
 * @param file - absolute path.
 * @param options - `expectedVersion` for the pre-write stale check.
 * @returns `{ ok: true, rev, plan, notes }` or `{ ok: false, error, notes? }`.
 */
export async function repairPlanFile(file, { expectedVersion } = {}) {
  const before = await stat(file).catch(() => undefined)
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, error: 'missing' }
    return { ok: false, error: `read-failed: ${error?.message ?? String(error)}` }
  }
  const after = await stat(file).catch(() => undefined)
  const beforeVer = before === undefined ? undefined : `${before.size}:${before.mtimeMs}`
  const afterVer = after === undefined ? undefined : `${after.size}:${after.mtimeMs}`
  const version = beforeVer !== undefined && beforeVer === afterVer
    ? beforeVer
    : (before !== undefined || after !== undefined ? 'stale' : undefined)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `invalid-json: ${error.message}（JSON 坏了没法自动修，请手工改）` }
  }
  const repaired = repairPlan(parsed)
  if (!repaired.ok) return { ok: false, error: `repair-failed: ${repaired.error}`, notes: repaired.notes }
  if (repaired.notes.length === 0 && !validatePlan(parsed).ok) {
    repaired.notes.push('已清理不合法字段')
  }
  // Nothing to drop: leave the file alone, so a stray repair click is a no-op.
  if (repaired.notes.length === 0) return { ok: true, rev: repaired.plan.rev, plan: repaired.plan, notes: [] }
  const written = await writePlanFile(file, repaired.plan, { expectedVersion: expectedVersion ?? version })
  return { ...written, notes: repaired.notes }
}
