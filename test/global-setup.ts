// Builds the two things every test needs before the first one runs: the
// snippet bundle itself, and the `mockd` binary spec/snippet.md §4 names as
// the endpoint.
//
// The bundle is built rather than assumed present, because a suite that
// silently tested yesterday's dist would be worse than one that failed.

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contractsDirectory } from './contracts'

const here = path.dirname(fileURLToPath(import.meta.url))
export const SNIPPET_DIR = path.resolve(here, '..')

export default function globalSetup(): void {
  // Built with the budget lifted, deliberately. §4 makes the budget a TEST
  // CASE -- T20, in test/transport.spec.ts -- and a global setup that refused
  // to build an over-budget bundle would report one failure ("setup failed")
  // where the suite has fifty-nine other answers to give. `make snippet` is
  // the target that enforces it; T20 is the case that measures it.
  execFileSync('node', ['build.mjs', '--budget', '1000000'], { cwd: SNIPPET_DIR, stdio: 'inherit' })

  const work = mkdtempSync(path.join(tmpdir(), 'jelto-snippet-'))
  const mockd = path.join(work, 'mockd')
  execFileSync('go', ['build', '-o', mockd, './spec/conformance/mockd'], {
    cwd: contractsDirectory(),
    stdio: 'inherit',
  })
  process.env.JELTO_MOCKD_BIN = mockd
}
