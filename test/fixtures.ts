// The Playwright fixtures every test case uses: one mockd for the run, one Site
// per test, and the schema check T22 and T40 apply to whatever was recorded.

import { test as base, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Mockd } from './harness/mockd'
import { Site } from './harness/site'
import { contractsDirectory } from './contracts'

interface Worker {
  mockdServer: Mockd
}

interface Fixtures {
  mockd: Mockd
  site: Site
}

export const test = base.extend<Fixtures, Worker>({
  mockdServer: [
    async ({}, use) => {
      const server = await Mockd.start()
      await use(server)
      await server.stop()
    },
    { scope: 'worker' },
  ],

  mockd: async ({ mockdServer }, use) => {
    await mockdServer.reset()
    await use(mockdServer)
  },

  site: async ({ page, mockd }, use) => {
    const site = new Site(page, mockd.endpoint)
    await use(site)
  },
})

export { expect }

/**
 * T22 and T40: "every request body validates against
 * `spec/wire-v1.schema.json`".
 *
 * It runs `spec/wirecheck` -- the SAME validator `spec/conformance`'s W1 uses
 * and the same one `make dogfood-wire` runs over a week of real SDK traffic.
 * A second copy compiled here in TypeScript could drift from the schema the
 * server is held equal to, and then the snippet's evidence would be against a
 * validator nothing else ran. The shared package prevents that drift for
 * both SDK and snippet captures.
 *
 * The capture format is `spec/sdk-conformance.md` C17's: one `jelto: POST `
 * line per body, unaltered.
 */
export function validateAgainstSchema(bodies: string[]): void {
  expect(bodies.length, 'no request body to validate').toBeGreaterThan(0)
  const dir = mkdtempSync(path.join(tmpdir(), 'jelto-wire-'))
  const capture = path.join(dir, 'capture.log')
  writeFileSync(capture, bodies.map((b) => 'jelto: POST ' + b).join('\n') + '\n')
  try {
    execFileSync('go', ['run', './spec/wirecheck/dogfood', '-capture', capture], {
      cwd: contractsDirectory(),
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string }
    throw new Error(`spec/wire-v1.schema.json rejected a body:\n${e.stdout ?? ''}${e.stderr ?? ''}`)
  }
}
