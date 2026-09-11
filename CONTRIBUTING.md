# Contributing to Jelto browser snippet

Bug reports, corrections, examples and focused changes are welcome.
Participants follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Start a contribution

Search [existing issues](https://github.com/usejelto/snippet/issues) before opening one. Use a bug report for
reproducible failures, a feature request to explain a use case, or a blank issue
for questions and corrections. Discuss substantial changes before implementing
them; small fixes can go straight to a PR.

Send security reports privately as described in [SECURITY.md](SECURITY.md).
For setup and account help, see [SUPPORT.md](SUPPORT.md).

## Local development

Node 24 or later and Make. Browser tests need Playwright and a contracts directory.

Fork and clone this repository, create a branch from `main`, and run commands
from this repository's root. A standalone checkout contains its build inputs;
you do not need the private Jelto backend, and no instruction here should ask
you for it.

```sh
npm ci
npm run build
npm run check
JELTO_CONTRACTS_DIR=<path-to-contracts> npm test
```

One source tree builds every bundle. The cookie build is a separate build of the same source, never a second copy. Bundle budgets are enforced by `build.mjs`; changing one requires a specification change first.

Vendored inputs under `vendor/` are checked-in snapshots with recorded sources
and checksums. Do not edit them by hand; they are refreshed by an explicit
update command that reviews the pin diff.

## Review and acceptance

Keep changes focused and match the surrounding style. Add regression coverage
for behavior changes. Do not update an expected value just to match a failing
implementation.

Use a scoped Conventional Commit title, such as `fix(snippet): correct the
retry example`. Describe the problem, the resulting behavior, the related issue
or specification, compatibility impact, and the exact verification commands with
their results. State when a check was not run and why.

Use synthetic data in examples and reports. Never include credentials, customer
payloads or IP addresses. Contributions must preserve Jelto's privacy
boundaries: no IP storage or logging, and no row-level identifier that joins a
website visitor to an app install.

Taha Bozdemir reviews scope, correctness and compatibility, and decides whether
to merge. Review is best effort with no guaranteed turnaround.

## Licensing

Submit only work you have the right to contribute. Code, including the code
examples inside the prose, is contributed under the [MIT licence](LICENSE);
the explanatory prose in this repository is contributed under
[CC BY 4.0](LICENSE-DOCS.md). Preserve third-party notices and the Contributor
Covenant attribution. Jelto names, logos, mascots and original brand artwork are
excluded from both licences; no trademark rights are granted. No separate CLA or
DCO sign-off is required.
