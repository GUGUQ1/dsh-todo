/**
 * Inspect one stored Session log without changing it.
 *
 * A Session is one `session.v4.jsonl.zstd` file: a header row first, then one
 * JSON event per line, compressed as zstd frames. The loader validates on read,
 * so a single malformed row (for example an `agent/inbox/spliced.inserted`
 * entry that is a string) makes the whole Session unreadable. This script says
 * whether that happened, and where.
 *
 * Usage:
 *   node tools/session-check.mjs <path/to/session.v4.jsonl.zstd>
 *   node tools/session-check.mjs --json <path>
 *
 * Needs `zstd` on PATH, or a Node with `zlib.zstdDecompressSync` (Node 22.15+).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/**
 * Decode the log file. The command-line decoder is preferred because a Session
 * log is many concatenated zstd frames (one per append) and Node's one-shot
 * decoder stops after the first frame; the fallback warns about that.
 * @param file - path to the compressed log.
 * @returns `{ text, decoder }`.
 */
function decode(file) {
  const result = spawnSync('zstd', ['-dc', file], { maxBuffer: 512 * 1024 * 1024 })
  if (result.error === undefined && result.status === 0) {
    return { text: result.stdout.toString('utf8'), decoder: 'zstd' }
  }
  try {
    return {
      text: zstdDecompressSync(readFileSync(file)).toString('utf8'),
      decoder: 'node zlib (first frame only — install zstd for a full check)',
    }
  } catch (error) {
    throw new Error(`cannot decode ${file}: ${error.message}`)
  }
}

/**
 * Validate the decoded log.
 * @param text - decoded JSONL.
 * @returns the findings.
 */
function check(text) {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  const problems = []
  const seen = new Map()
  let header
  let lastSeq = -1
  let spliced = 0
  let badInserted = 0
  for (const [index, line] of lines.entries()) {
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      problems.push(`line ${index + 1}: invalid JSON (${error.message})`)
      continue
    }
    if (header === undefined) {
      header = event
      continue
    }
    if (typeof event.seq !== 'number') {
      problems.push(`line ${index + 1}: event without a numeric seq (${String(event.type)})`)
      continue
    }
    if (seen.has(event.seq)) {
      problems.push(`line ${index + 1}: duplicate seq ${event.seq}`)
    } else {
      seen.set(event.seq, event.type)
    }
    if (event.seq !== lastSeq + 1) problems.push(`line ${index + 1}: seq ${event.seq} after ${lastSeq}`)
    lastSeq = event.seq
    if (event.type === 'agent/inbox/spliced') {
      spliced += 1
      const inserted = event.data?.inserted
      if (!Array.isArray(inserted)) {
        problems.push(`seq ${event.seq}: inserted is not an array`)
      } else {
        for (const item of inserted) {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            badInserted += 1
            problems.push(`seq ${event.seq}: inserted entry is ${item === null ? 'null' : Array.isArray(item) ? 'an array' : typeof item}`)
          }
        }
      }
    }
  }
  return {
    ok: problems.length === 0,
    header: header?.type,
    events: lines.length,
    seqRange: [0, lastSeq],
    spliced,
    badInserted,
    problems: problems.slice(0, 20),
  }
}

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const file = argv.find(argument => !argument.startsWith('--'))
if (file === undefined) {
  console.error('usage: node tools/session-check.mjs [--json] <session.v4.jsonl.zstd>')
  process.exit(2)
}
const decoded = decode(file)
const report = check(decoded.text)
const decoder = decoded.decoder
if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`file:    ${file}`)
  console.log(`decoder: ${decoder}`)
  console.log(`header:  ${report.header} (must be "session")`)
  console.log(`events:  ${report.events} (seq ${report.seqRange[0]}..${report.seqRange[1]})`)
  console.log(`spliced: ${report.spliced} events, ${report.badInserted} bad inserted entries`)
  console.log(`state:   ${report.ok ? 'OK' : 'PROBLEMS'}`)
  for (const problem of report.problems) console.log(`  - ${problem}`)
}
process.exitCode = report.ok ? 0 : 1
