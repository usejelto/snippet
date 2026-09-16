# Optional snippet helpers

The core remains dependency-free and defaults to no browser storage. Build with
`npm run build`; run `npm run check` and `npm test` for the Playwright contracts.
Core/cookie limits are 3320/3538 gzip bytes (spec/snippet.md v0.14 reserves 20 B for the version string); each optional helper is ≤2000.

Load deferred scripts in this order (omit helpers you do not enable):

```html
<script defer data-product="prd_8f3kq2m9x1"
  data-domains="site.example,shop.example"
  src="https://your-jelto-host.example/jelto.crossdomain.js"></script>
<script defer data-product="prd_8f3kq2m9x1"
  src="https://your-jelto-host.example/jelto.js"></script>
<script defer src="https://your-jelto-host.example/jelto.goals.js"></script>
<script defer data-product="prd_8f3kq2m9x1"
  src="https://your-jelto-host.example/jelto.entry.js"></script>
<script defer data-environment="live"
  data-entry-pages='[{"id":"pricing","host":"site.example","paths":["/pricing/**"]}]'
  src="https://your-jelto-host.example/jelto.checkout.js"></script>
```

Cross-domain bootstrap must precede the core so the first pageview observes the
incoming label. Both the referrer and destination host must appear in the
registered host list. Only bounded `jl`/`jt` attribution travels across hosts;
cookies and visitor identities remain separate. Explicit destination attribution
wins. Initialization exclusions, including `?jelto_ignore=1`, suppress collection.

The goals helper accepts explicit form attributes:

```html
<form data-jelto-event="signup" data-jelto-event-plan="pro">
  <input name="email" type="email" required>
  <button>Sign up</button>
</form>
```

A form event means browser validation passed, not that the server accepted the
submission. No field values, form data or element text are read. A tagged submit
button inside a tagged form does not count twice. Existing dynamic visibility
goals and tagged clicks continue through the core event dispatcher.

The entry helper reads the following checkout tag's configured groups. It matches
exact hosts and existing path globs (`*` one segment, `**` any depth), in configured
order, and captures the first eligible group. It uses a product-scoped
`jelto_entry_<product>` sessionStorage value containing only `id` and `at`, expiring
after 30 minutes. `data-payment-memory="off"` on checkout disables both checkout
and entry storage; only the current document's observed entry is then available.
Excluded pages do not capture entry groups or emit attribution claims.

`jeltoCheckoutMetadata()` adds `jelto_entry_page` when known, and return claims
send `entry_page`. Lemon Squeezy and Polar helpers include declared metadata.
Stripe's `jl1_`/`jf1_` client references remain cohort-only. Entry attribution for
Stripe uses server checkout metadata or a verified return claim; a static payment
link alone does not invent an entry group. Missing entry context remains unknown.

## Standalone development

This directory is the browser snippet extraction unit, separate from the
`@jelto/analytics` integration package. `npm ci`, `npm run build` and
`npm run check` run locally. For `npm test`, install the locked Playwright
browser and set `JELTO_CONTRACTS_DIR` to an extracted Jelto contracts **0.1.x**
archive. It supplies the mock server and wire validator; no backend source is
needed. Run `JELTO_CONTRACTS_DIR=/absolute/path/to/contracts npm test` from
this repository after installing the browser with `npx playwright install chromium`.
Production assembly consumes the six bundles in the local `dist/`.
`npm test` also runs local source guards from `checks/` before Playwright;
`npm run test:source` runs those guards without the browser or contracts tools.

## Specification references

Source comments cite `spec/wire-v1.md` (the wire contract: envelope, fields, statuses,
retry rules) and `spec/sdk-conformance.md` (the behavioural contract, whose `C…` and `W…`
identifiers name conformance scenarios). Neither file ships in this repository: both live in
the public contracts repository at <https://github.com/usejelto/contracts/tree/main/spec>.
A comment that states a rule in words and then cites a section is pointing at the normative
text for that rule.

## Licence

Code here is MIT ([LICENSE](LICENSE)); the explanatory prose in this repository
is CC BY 4.0 ([LICENSE-DOCS.md](LICENSE-DOCS.md)), and code examples inside it are
MIT. Jelto names, logos and original brand artwork are excluded from both.
