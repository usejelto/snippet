// Scans every emitted bundle in dist/ (built by build.mjs) for the forbidden eval(/
// new Function( tokens. This is a behavioral check on the actual output, independent of
// the scan build.mjs performs on itself — dist/ only exists after `node build.mjs`
// has run, so this check is a no-op (not a failure) when it hasn't.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const distDir = new URL('../dist/', import.meta.url)

const FORBIDDEN = [
  ['eval(', /\beval\s*\(/],
  ['new Function(', /\bnew\s+Function\s*\(/],
]

test('every file emitted to dist/ is free of eval( and new Function(', () => {
  if (!existsSync(distDir)) {
    // dist/ is a build artifact; nothing to scan before `node build.mjs` runs.
    return
  }
  const files = readdirSync(distDir).filter((f) => f.endsWith('.js'))
  assert.ok(files.length > 0, 'expected at least one emitted bundle in dist/')
  for (const file of files) {
    const text = readFileSync(new URL(file, distDir), 'utf8')
    for (const [name, re] of FORBIDDEN) {
      assert.ok(!re.test(text), `${file} contains forbidden ${name}`)
    }
  }
})
