// Run node measure.mjs to measure each rule group’s marginal gzip cost by replacing its
// exports with no-ops. Costs do not sum to the total because gzip shares a dictionary and
// stubs retain call sites.

import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
    rules: 'B14 B16 B17  engagement: the monotonic timer, the pixel maximum, the six triggers',
    stub: `import type { Config } from './types'
export function initEngage(_c: Config): void {}
export function pvStart(_id: string, _u: string): void {}
export function pvEnd(): void {}`,
  },
  {
    file: 'cohort.ts',
    rules: 'B15 B19 §3  the cohort computation, attribution memory, the checkout accessor',
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
    rules: 'B3 B4 B5 B13  download, outbound and tagged clicks, by delegation',
    stub: `import type { Config } from './types'
export function initLinks(_c: Config): void {}`,
  },
  {
    file: 'page.ts',
    rules: 'B1 B6 B9 B10 B18  the pageview, the jelto() API, SPA and hash routing',
    stub: `import type { Config } from './types'
export function initPage(_c: Config): void {}
export function pageview(_o?: { u?: string; r?: string }): void {}`,
  },
  {
    file: 'send.ts',
    rules: 'B7 B8 B11 B12  the batch, the transport, the kill switch, the event id',
    stub: `import type { Config, Outgoing } from './types'
export function uuid(): string { return '' }
export function initSend(_c: Config): void {}
export function send(_ev: Outgoing): void {}
export function flush(_force?: boolean): void {}`,
  },
  {
    file: 'config.ts',
    rules: 'B2 §1  the data-* attributes and the page-wide skip rules',
    stub: `import type { Config } from './types'
export function readConfig(): Config | null { return null }
export function blocked(_c: Config): boolean { return true }
export function excluded(_c: Config, _p: string): boolean { return false }
export function pageUrl(_c: Config): string { return location.href }
export function pagePath(_c: Config): string { return location.pathname }
export function urlPath(_c: Config, a: string): string { return a }`,
  },
]

function build(dir) {
  execFileSync('node', [path.join(dir, 'build.mjs'), '--budget', '100000000'], { cwd: dir, stdio: 'ignore' })
  const raw = readFileSync(path.join(dir, 'dist/jelto.js'))
  return { raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length }
}

const whole = build(here)
process.stdout.write(
  `\nspec/snippet.md §1 — where the bytes went\n\n` +
    `  the whole snippet${' '.repeat(21)}${String(whole.raw).padStart(6)} B raw   ${String(whole.gzip).padStart(5)} B gzipped\n` +
    `  spec/snippet.md §1's budget${' '.repeat(12)}${' '.repeat(6)}         ${String(3000).padStart(5)} B gzipped\n\n` +
    `  MARGINAL COST of each rule group — what removing it alone would save.\n` +
    `  These do not sum to the total: gzip shares one dictionary across the file,\n` +
    `  and every stubbed build still carries the call sites of what it removed.\n\n`,
)

for (const group of GROUPS) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jelto-measure-'))
  for (const item of ['src', 'build.mjs', 'package.json', 'node_modules']) {
    cpSync(path.join(here, item), path.join(dir, item), { recursive: true, dereference: false, verbatimSymlinks: true })
  }
  writeFileSync(path.join(dir, 'src', group.file), group.stub)
  const without = build(dir)
  const cost = whole.gzip - without.gzip
  process.stdout.write(
    `  ${group.file.padEnd(12)} ${String(cost).padStart(5)} B gzipped   ${group.rules}\n`,
  )
}

process.stdout.write(
  `\n  The floor is not zero: an empty index.ts still builds to an IIFE with the\n` +
    `  shared types erased, so the residue below the last row is the wrapper.\n\n`,
)
