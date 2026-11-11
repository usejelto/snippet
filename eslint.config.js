// ESLint for the snippet source, its tests and the build scripts. `make lint`
// runs it; `tsc` (`npm run check`) owns type errors, so this config adds the
// recommended JavaScript and TypeScript rules on top.
import js from '@eslint/js'
import globals from 'globals'
import ts from 'typescript-eslint'

export default ts.config(
  // Build output, test reports and vendored snapshots (their producers lint them).
  { ignores: ['dist/', 'vendor/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ts.configs.recommended,
  {
    // The snippet runs in the visitor's browser.
    files: ['src/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Build, measurement and source-check scripts, the Playwright suite and its
    // configuration all run in Node.
    files: ['*.mjs', '*.js', '*.ts', 'checks/**', 'test/**'],
    languageOptions: { globals: { ...globals.node } },
  },
)
