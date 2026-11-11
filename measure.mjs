// Run node measure.mjs to measure each rule group’s marginal gzip cost by replacing its
// exports with no-ops. Costs do not sum to the total because gzip shares a dictionary and
// stubs retain call sites.

import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, symlinkSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// One row per module, with the spec rules it implements. The stub keeps every
// exported signature so the rest of the bundle still compiles and esbuild does
// not tree-shake a call site away with it.
const GROUPS = [
  {
    file: 'engage.ts',
    rules: 'engagement: the monotonic timer, the pixel maximum, the six triggers',
    stub: `import type { Config } from './types'
export function initEngage(_c: Config): void {}
export function pvStart(_id: string, _u: string): void {}
export function pvEnd(): void {}`,
  },
  {
    file: 'cohort.ts',
    rules: 'the cohort computation, attribution memory, the checkout accessor',
    stub: `import type { Config } from './types'
export function initCohort(_c: Config): void {}
export function cohort(): string { return '' }
export const firstTouch = false
export function decorate(href: string): string { return href }
export function memory(): { f?: string; fd?: string } { return {} }
export function remember(): void {}`,
  },
  {
    file: 'links.ts',
    rules: 'download, outbound and tagged clicks, by delegation',
    stub: `import type { Config } from './types'
export function initLinks(_c: Config): void {}`,
  },
  {
    file: 'page.ts',
    rules: 'the pageview, the jelto() API, SPA and hash routing',
    stub: `import type { Config } from './types'
export function initPage(_c: Config): void {}
export function pageview(_o?: { u?: string; r?: string }): void {}`,
  },
  {
    file: 'send.ts',
    rules: 'the batch, the transport, the kill switch, the event id',
    // initSend keeps the cookie-mode wiring: without vid.ts in its graph the cookie
    // bundle fails build.mjs's cookie guard, and the cookieless bundle measured here
    // folds the branch away either way. send() reports success and stopped() reports
    // no kill switch, so the pageview path behind them stays in the bundle.
    stub: `import type { Config, Outgoing } from './types'
import { initVid } from './vid'
export function stopped(): boolean { return false }
export function uuid(): string { return '' }
export function initSend(_c: Config): void { if (__JELTO_COOKIE__) initVid() }
export function send(_ev: Outgoing): boolean { return true }
export function flush(_force?: boolean, _count?: number): void {}`,
  },
  {
    file: 'config.ts',
    rules: 'the data-* attributes and the page-wide skip rules',
    // A config that is present and not blocked: a null or blocked one lets the minifier
    // drop every init call behind it, so the row would weigh the whole bundle and the
    // cookie bundle would lose vid.ts and fail build.mjs's cookie guard.
    stub: `import type { Config } from './types'
export function readConfig(): Config | null { return {} as Config }
export function blocked(_c: Config): boolean { return false }
export function excluded(_c: Config, _p: string): boolean { return false }
export function pageUrl(_c: Config): string { return location.href }
export function pagePath(_c: Config): string { return location.pathname }
export function urlPath(_c: Config, a: string): string { return a }`,
  },
]

// Stubbed copies are measured, not judged: the override lifts the size budget while
// every other build.mjs guard still runs, so a build that fails here is broken.
function build(dir) {
  execFileSync('node', [path.join(dir, 'build.mjs'), '--budget', '100000000'], { cwd: dir, stdio: 'ignore' })
  const raw = readFileSync(path.join(dir, 'dist/jelto.js'))
  return { raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length }
}

// The budgets are the ones build.mjs enforces, not a copy kept here: the unmodified tree
// builds once with nothing overridden and build.mjs prints every bundle against its
// budget. An over-budget tree is still measured, which is when this report matters, and
// the exit status still says it is over.
const enforced = spawnSync('node', [path.join(here, 'build.mjs')], { cwd: here, encoding: 'utf8' })
if (enforced.error) throw enforced.error
process.stdout.write(`\ncore bundle budget — where the bytes went\n\n${enforced.stdout}`)
process.stderr.write(enforced.stderr)
if (enforced.status !== 0) process.exitCode = 1

const whole = build(here)
process.stdout.write(
  `\n  the whole snippet${' '.repeat(21)}${String(whole.raw).padStart(6)} B raw   ${String(whole.gzip).padStart(5)} B gzipped   (jelto.js)\n\n` +
    `  MARGINAL COST of each rule group — what removing it alone would save.\n` +
    `  These do not sum to the total: gzip shares one dictionary across the file,\n` +
    `  and every stubbed build still carries the call sites of what it removed.\n\n`,
)

for (const group of GROUPS) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jelto-measure-'))
  try {
    for (const item of ['src', 'build.mjs', 'package.json']) {
      cpSync(path.join(here, item), path.join(dir, item), { recursive: true })
    }
    // Linked, not copied: build.mjs only resolves esbuild and terser from it.
    symlinkSync(path.join(here, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
    writeFileSync(path.join(dir, 'src', group.file), group.stub)
    const without = build(dir)
    const cost = whole.gzip - without.gzip
    process.stdout.write(
      `  ${group.file.padEnd(12)} ${String(cost).padStart(5)} B gzipped   ${group.rules}\n`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

process.stdout.write(
  `\n  The floor is not zero: an empty index.ts still builds to an IIFE with the\n` +
    `  shared types erased, so the residue below the last row is the wrapper.\n\n`,
)
