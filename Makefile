.DEFAULT_GOAL := check
.PHONY: check lint typecheck build test-source test npm-audit security

# The shared quality targets (hooks, tools, secrets, osv, workflow-audit, sast)
# arrive from the contracts repository as a checksummed snapshot; `make inputs`
# in the backend refreshes it, and nothing edits it here.
include vendor/quality/quality.mk

security: secrets workflow-audit osv npm-audit

# The whole gate: what to run before a pull request, and what CI's checks job
# runs. The browser suite (make test) needs a contracts directory and
# Playwright's browsers, so it runs in its own job when CI names an archive.
check: lint typecheck build test-source security

node_modules: package.json package-lock.json
	npm ci --no-audit --no-fund
	@touch $@

# ESLint's recommended JavaScript and TypeScript rules (eslint.config.js) over
# the source, the tests and the build scripts.
lint: node_modules
	npx --no-install eslint --max-warnings 0 .

typecheck: node_modules
	npm run check

# build.mjs enforces the emitted bundle budgets and cookie-mode separation; a
# budget change requires a specification change first.
build: node_modules
	npm run build

test-source: node_modules
	npm run test:source

test: node_modules
	npm test

npm-audit:
	npm audit --audit-level=moderate --package-lock-only
