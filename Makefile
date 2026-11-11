.DEFAULT_GOAL := check
.PHONY: check typecheck build test-source test npm-audit security

# The shared quality targets (hooks, tools, secrets, osv, workflow-audit, sast)
# arrive from the contracts repository as a checksummed snapshot; `make inputs`
# in the backend refreshes it, and nothing edits it here.
include vendor/quality/quality.mk

security: secrets workflow-audit
