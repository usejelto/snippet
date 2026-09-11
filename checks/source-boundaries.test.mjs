// Keep snippet source guards local; frontend tests cover disclosure behavior.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const build = () => readFileSync(new URL('../build.mjs', import.meta.url), 'utf8')

test('tracking modes share one entry point and helpers are separate optional bundles', () => {
  const source = build()
  assert.ok(source.includes('src/index.ts'))
  assert.ok(source.includes("file: 'jelto.js'"))
  assert.ok(source.includes("file: 'jelto.cookie.js'"))
  assert.equal(source.match(/src\/index\.ts/g)?.length ?? 0, 1)
  assert.ok(source.includes("const extensions = ['goals', 'checkout', 'crossdomain', 'entry']"))
  assert.ok(source.includes('__JELTO_COOKIE__'))
})

test('cookie access is confined to vid.ts and build guards verify both emitted modes', () => {
  const directory = new URL('../src/', import.meta.url)
  const files = readdirSync(directory).filter(name => name.endsWith('.ts'))
  assert.ok(files.length > 0)
  const touching = files.filter(name => /document\s*\.\s*cookie/.test(readFileSync(new URL(name, directory), 'utf8')))
  assert.deepEqual(touching, ['vid.ts'])
  assert.ok(build().includes('DEFAULT build and carries cookie code'))
  assert.ok(build().includes('COOKIE build and does not carry cookie mode'))
})

test('the FORBIDDEN eval/new Function scan and the storage-token check also cover the optional extension bundles', () => {
  const source = build()
  const extLoop = source.slice(source.indexOf("const extensions = ['goals', 'checkout', 'crossdomain', 'entry']"))
  assert.ok(/for \(const \[fname, re\] of FORBIDDEN\)/.test(extLoop), 'extension bundles are scanned for eval(/new Function(')
  assert.ok(/indexedDB/.test(extLoop), 'extension bundles are checked for indexedDB use')
  assert.ok(/\\bcaches\\b/.test(extLoop) || /caches/.test(extLoop), 'extension bundles are checked for caches use')
})

test('a non-numeric or missing --budget value throws instead of silently disabling the budget gate', () => {
  const source = build()
  assert.ok(/if \(budgetFlag !== -1 && !Number\.isFinite\(OVERRIDE\)\) throw new Error/.test(source))
})

test('node build.mjs --budget nonsense exits non-zero instead of passing NaN through the gate', () => {
  const result = spawnSync(process.execPath, [new URL('../build.mjs', import.meta.url).pathname, '--budget', 'nonsense'])
  assert.notEqual(result.status, 0)
})
