/**
 * Where a board lives.
 *
 * Two boards can exist at once:
 *
 * - the **public** board is a workspace file (`<workspace>/todolist.json`) and
 *   follows the workspace;
 * - the **private** board is anchored to the Session, not to the workspace, so
 *   it lives under the DeepSeek Harness home and survives a change of working
 *   directory: `$DSH_HOME/dsh-todo/<session-id>/private.json`.
 *
 * The private path is derived from the Session id alone — no user-supplied path
 * is ever part of it — so it cannot be redirected. The home is resolved the way
 * the Harness itself resolves it (`$DSH_HOME`, else `~/.dsh`), because a plugin
 * cannot import the Harness module that does this.
 */
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable that overrides the Harness home, as the Harness reads it. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Directory name of the default Harness home under the OS home. */
export const DSH_HOME_DIR = '.dsh'

/** Directory under the Harness home that holds every private board. */
export const BOARD_DIR = 'dsh-todo'

/** File name of one Session's private board. */
export const PRIVATE_FILE = 'private.json'

/**
 * Expand `~`, `~/` and `~\` against the OS home, mirroring the Harness.
 * @param value - configured path.
 * @param home - the OS home directory.
 * @returns the expanded path, or the value unchanged when it has no tilde prefix.
 */
export function expandHomePath(value, home = homedir()) {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2))
  return value
}

/**
 * Resolve the Harness home: `$DSH_HOME` when set, else `~/.dsh`.
 *
 * A blank `$DSH_HOME` counts as unset, so a stray empty variable can never
 * resolve the boards to the current directory.
 * @param env - environment to read (defaults to `process.env`).
 * @param home - the OS home directory.
 * @returns the absolute home path.
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env?.[DSH_HOME_ENV] === 'string' ? env[DSH_HOME_ENV].trim() : ''
  const selected = configured === '' ? join(home, DSH_HOME_DIR) : configured
  return resolve(expandHomePath(selected, home))
}

/**
 * Whether a Session id is safe to use as one path segment.
 *
 * Session ids are opaque strings produced by the Harness; this guard is what
 * keeps a crafted id from becoming a path traversal or a reserved device name.
 * @param sessionId - the candidate.
 * @returns whether it may name a directory.
 */
export function isBoardSessionId(sessionId) {
  if (typeof sessionId !== 'string') return false
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)
}

/**
 * The directory holding one Session's private board.
 * @param sessionId - the Session id.
 * @param options - `env` / `home` overrides (tests).
 * @returns the absolute directory, or undefined for an unusable id.
 */
export function privateBoardDir(sessionId, options = {}) {
  if (!isBoardSessionId(sessionId)) return undefined
  const home = options.dshHome ?? resolveDshHome(options.env ?? process.env, options.osHome ?? homedir())
  return join(home, BOARD_DIR, sessionId)
}

/**
 * The private board file of one Session.
 * @param sessionId - the Session id.
 * @param options - `env` / `home` overrides (tests).
 * @returns the absolute file path, or undefined for an unusable id.
 */
export function privateBoardFile(sessionId, options = {}) {
  const dir = privateBoardDir(sessionId, options)
  return dir === undefined ? undefined : join(dir, PRIVATE_FILE)
}

/**
 * Whether anything exists at a path (a broken board still counts as existing).
 * @param path - absolute path, or undefined.
 * @returns whether it can be stat'ed.
 */
export async function fileExists(path) {
  if (typeof path !== 'string' || path === '') return false
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}
