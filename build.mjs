// Build both tracking modes from one source and verify their emitted bytes and budgets.
// Budgets are defined by the shared-source and cookie-mode ceilings below; measure.mjs
// reports per-rule costs.
// esbuild emits a dependency-free IIFE without a loader or preload shim.
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import esbuild from 'esbuild'
import { minify } from 'terser'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'))

// Both modes share one build-time client version. Cookie mode is identified by the
// event’s vid, not its version.
const CLIENT_VERSION = 'web/' + pkg.version

// The budget override exercises the guard in tests and applies to both variants.
const budgetFlag = process.argv.indexOf('--budget')
const OVERRIDE = budgetFlag === -1 ? null : Number(process.argv[budgetFlag + 1])
if (budgetFlag !== -1 && !Number.isFinite(OVERRIDE)) throw new Error('--budget needs a number')

const VARIANTS = [
  {
    file: 'jelto.js',
    cookie: false,
    // spec/snippet.md §1 v0.14: 3 300 for the code plus 20 B reserved for the version string.
    budget: 3320,
    rule: 'core bundle budget',
    what: 'the default build, cookieless',
  },
  {
    file: 'jelto.cookie.js',
    cookie: true,
    // Shared-source ceiling plus the measured 218-byte cookie-mode cost (§7.3).
    budget: 3538,
    rule: 'cookie-mode bundle budget',
    what: 'the opt-in cookie mode',
  },
]

const outdir = path.join(here, 'dist')
mkdirSync(outdir, { recursive: true })

let failed = false
const fail = (line) => {
  process.stderr.write(line)
  failed = true
}

const built = []
for (const variant of VARIANTS) {
  const outfile = path.join(outdir, variant.file)
  const result = await esbuild.build({
    entryPoints: [path.join(here, 'src/index.ts')],
    outfile,
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['safari16', 'chrome109', 'firefox115', 'edge109'],
    legalComments: 'none',
    define: {
      __JELTO_VERSION__: JSON.stringify(CLIENT_VERSION),
      // Keep this a literal so esbuild removes cookie code from the cookieless bundle.
      __JELTO_COOKIE__: String(variant.cookie),
    },
    metafile: true,
    logLevel: 'warning',
  })
  // A build-only compression pass leaves room for transport correctness under
  // the existing caps. Keep safe defaults and preserve property names: dataset,
  // browser, and wire fields are public contracts. esbuild still enforces targets.
  const compressed = await minify(readFileSync(outfile, 'utf8'), {
    ecma: 2020,
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
  })
  if (!compressed.code) throw new Error(`minification produced no ${variant.file}`)
  const raw = Buffer.from(compressed.code + '\n')
  writeFileSync(outfile, raw)
  built.push({
    ...variant,
    raw,
    gzipped: gzipSync(raw, { level: 9 }).length,
    inputs: result.metafile.outputs[path.relative(process.cwd(), outfile)]?.inputs ?? {},
  })
}

// Check CSP constraints on emitted bytes, which behavioral tests cannot establish.
const FORBIDDEN = [
  ['eval(', /\beval\s*\(/],
  ['new Function(', /\bnew\s+Function\s*\(/],
]

// Verify that only the cookie bundle contains cookie code.
const COOKIE_CODE = /document\s*\.\s*cookie/
const COOKIE_NAME = /jelto_vid/
const COOKIE_MODULE = /(^|\/)vid\.ts$/

// Derive expectations from the filename independently of the build flag, so a
// misconfigured variant cannot validate itself.
const promisesCookie = (file) => /\.cookie\./.test(file)

for (const b of built) {
  const text = b.raw.toString('utf8')
  for (const [name, re] of FORBIDDEN) {
    if (re.test(text)) fail(`make snippet: the CSP-safety rule forbids ${name} in the emitted ${b.file}\n`)
  }

  const hasCode = COOKIE_CODE.test(text)
  const hasName = COOKIE_NAME.test(text)
  // The module graph, independently of the bytes: a cookie written as
  // `d['cookie']` would slip the regex above and not this.
  const hasModule = Object.keys(b.inputs).some((f) => COOKIE_MODULE.test(f))

  if (promisesCookie(b.file)) {
    if (!hasCode || !hasName || !hasModule) {
      fail(
        `make snippet: ${b.file} is the COOKIE build and does not carry cookie mode ` +
          `(document.cookie: ${hasCode}, ${'jelto_vid'}: ${hasName}, src/vid.ts in graph: ${hasModule}).\n` +
          `  It is the cookieless bundle under the cookie name. A site loading this file publishes\n` +
          `  that it sets a cookie, so shipping it setting none is a false statement made under\n` +
          `  the customer's name and cached for a day.\n`,
      )
    }
  } else if (hasCode || hasName || hasModule) {
    fail(
      `make snippet: ${b.file} is the DEFAULT build and carries cookie code ` +
        `(document.cookie: ${hasCode}, ${'jelto_vid'}: ${hasName}, src/vid.ts in graph: ${hasModule}).\n` +
        `  The cookieless bundle must be byte-identical whether or not the cookie build is\n` +
        `  enabled. __JELTO_COOKIE__ must be a literal \`false\` here so esbuild folds the branch\n` +
        `  and drops the module.\n`,
    )
  }

  const budget = OVERRIDE ?? b.budget
  const pct = ((b.gzipped / budget) * 100).toFixed(1)
  process.stdout.write(
    `  ${b.file.padEnd(44)}${String(b.raw.length).padStart(8)} B raw   (${b.what})\n` +
      `  ${' '.repeat(42)}${String(b.gzipped).padStart(8)} B gzipped of ${budget} B (${b.rule}) — ${pct} %\n`,
  )
  if (b.gzipped > budget) {
    fail(
      `make snippet: ${b.file} is over its ${b.rule} by ${b.gzipped - budget} B.\n` +
        `  The number is re-argued in the SPEC against this measurement, in its own commit.\n` +
        `  It is not raised here to match what the code turned out to weigh.\n`,
    )
  }
}

const [plain, cookie] = built
process.stdout.write(
  `  ${'cookie mode costs'.padEnd(44)}${String(cookie.raw.length - plain.raw.length).padStart(8)} B raw\n` +
    `  ${' '.repeat(42)}${String(cookie.gzipped - plain.gzipped).padStart(8)} B gzipped\n`,
)

// Reject extra chunks and sourcemaps: each mode must ship as one script.
const extensions = ['goals', 'checkout', 'crossdomain', 'entry']
for (const name of extensions) {
  const file = `jelto.${name}.js`
  const outfile = path.join(outdir, file)
  await esbuild.build({ entryPoints: [path.join(here, `src/${name}-extension.ts`)], outfile,
    bundle: true, minify: true, format: 'iife', target: ['safari16', 'chrome109', 'firefox115'], legalComments: 'none' })
  const compressed = await minify(readFileSync(outfile, 'utf8'), { ecma: 2020, compress: { passes: 2 }, mangle: true, format: { comments: false } })
  if (!compressed.code) throw new Error(`minification produced no ${file}`)
  const raw = Buffer.from(compressed.code + '\n')
  writeFileSync(outfile, raw)
  const text = raw.toString('utf8')
  const size = gzipSync(raw, { level: 9 }).length
  const budget = name === 'checkout' ? 2250 : 2000
  process.stdout.write(`  ${file}: ${size} B gzipped (optional, budget ${budget} B)\n`)
  for (const [fname, re] of FORBIDDEN) {
    if (re.test(text)) fail(`make snippet: the CSP-safety rule forbids ${fname} in the emitted ${file}\n`)
  }
  // Checkout may retain bounded channel context and its pageview reference in this tab; the visibility
  // helper remains storage-free.
  if (size > budget || COOKIE_CODE.test(text) || /localStorage|indexedDB|\bcaches\b/.test(text) || (!['checkout', 'entry'].includes(name) && /sessionStorage/.test(text))) fail(`${file} violates extension size/storage contract\n`)
}
const expected = new Set([...VARIANTS.map((v) => v.file), ...extensions.map(name => `jelto.${name}.js`)])
const stray = readdirSync(outdir).filter((f) => !expected.has(f))
if (stray.length > 0) {
  fail(`make snippet: dist carries more than ${[...expected].join(' and ')}: ${stray.join(', ')}\n`)
}

if (failed) process.exit(1)

// Metafile sizes are pre-minify source bytes; they rank modules but do not sum to shipped
// size.
for (const b of built) {
  process.stdout.write(`    ${b.file}\n`)
  const rows = Object.entries(b.inputs).sort((x, y) => y[1].bytesInOutput - x[1].bytesInOutput)
  for (const [file, { bytesInOutput }] of rows) {
    process.stdout.write(`      ${path.basename(file).padEnd(14)} ${String(bytesInOutput).padStart(6)} B in output (pre-gzip)\n`)
  }
}

void statSync
