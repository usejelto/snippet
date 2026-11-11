// Knip: files nothing imports, unused exports and dependencies, and
// dependencies used but not declared. `make deadcode` runs it. Tests count as
// users. Everything a tool loads without an import is named here, with why.
import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    // build.mjs hands these to esbuild by path: src/index.ts builds jelto.js
    // and jelto.cookie.js, and each extension builds its optional bundle.
    'src/index.ts',
    'src/{goals,checkout,crossdomain,entry}-extension.ts',
    // The marginal-cost report, run by hand (`node measure.mjs`).
    'measure.mjs',
    // The source and bundle checks `npm run test:source` hands to node --test.
    'checks/*.test.mjs',
  ],
  // Knip's Node test-runner plugin is off: its default patterns make every file
  // under test/ an entry, whose exports Knip never checks, the Playwright
  // harness included. The node --test files are named above instead.
  node: false,
  // src/global.d.ts declares the constants esbuild defines at build time; tsc
  // loads it through tsconfig.json's include, and Knip leaves declarations be.
  project: ['src/**/*.ts', 'test/**/*.ts', 'checks/**/*.mjs', '*.{js,mjs,ts}'],
  // The Playwright suite runs the contracts repository's Go mock server and
  // wire checker with `go run`; Go is a system toolchain, not a dependency.
  ignoreBinaries: ['go'],
  // `make format-check` runs it through npx; Knip reads package.json scripts,
  // not the Makefile.
  ignoreDependencies: ['prettier'],
}

export default config
