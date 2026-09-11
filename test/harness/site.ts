// Intercept fixture pages at multiple origins so real browser same-origin, referrer and
// mixed-content rules apply without a separate server per hostname.

import type { Page, Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const SITE_ORIGIN = 'https://site.example'
export const CDN = 'https://cdn.jelto.example/jelto.js'
/** Cookie mode must use its distinct shipped filename. */
export const CDN_COOKIE = 'https://cdn.jelto.example/jelto.cookie.js'

/** Each served URL and the built file it answers with. Served from disk so
 *  every case runs against the bytes `make snippet` would ship, not a rebuilt
 *  approximation of them. */
const BUNDLES: Record<string, string> = {
  [CDN]: path.resolve(here, '../../dist/jelto.js'),
  [CDN_COOKIE]: path.resolve(here, '../../dist/jelto.cookie.js'),
  'https://cdn.jelto.example/jelto.goals.js': path.resolve(here, '../../dist/jelto.goals.js'),
  'https://cdn.jelto.example/jelto.checkout.js': path.resolve(here, '../../dist/jelto.checkout.js'),
  'https://cdn.jelto.example/jelto.crossdomain.js': path.resolve(here, '../../dist/jelto.crossdomain.js'),
  'https://cdn.jelto.example/jelto.entry.js': path.resolve(here, '../../dist/jelto.entry.js'),
}

export const PRODUCT = 'prd_8f3kq2m9x1'

/** One page of the fixture site. */
export interface PageSpec {
  /** Deferred relay bootstrap must precede the core's first pageview. */
  before?: string
  /** `data-*` attributes on the snippet tag, without the `data-` prefix. */
  attrs?: Record<string, string | true>
  /** Extra markup in `<head>`, AFTER the snippet tag. A pre-load caller
   *  (T13, T49) goes here: an inline script runs at parse time, the deferred
   *  snippet does not. */
  head?: string
  body?: string
  /** false serves the page with no snippet tag at all (a referring page). */
  snippet?: boolean
  /** Which built bundle this page's tag points at. Defaults to `Site.bundle`,
   *  which defaults to `CDN` -- so every case keeps running against
   *  `jelto.js` and only `jelto.js` without saying so. */
  src?: string
}

export class Site {
  private readonly pages = new Map<string, PageSpec>()
  private readonly assets = new Map<string, string>()
  private fallback: PageSpec = {}

  /**
   * Default scenarios exercise jelto.js. Cookie-specific cases opt into CDN_COOKIE
   * without weakening cookieless storage guarantees.
   */
  bundle: string = CDN

  constructor(
    private readonly page: Page,
    readonly endpoint: string,
  ) {}

  /** Applied to every page that has no registration of its own. */
  defaults(spec: PageSpec): void {
    this.fallback = spec
  }

  /** Registers one exact URL (or a path on the default origin). */
  register(url: string, spec: PageSpec): void {
    this.pages.set(this.absolute(url), spec)
  }

  /**
   * Registers a JavaScript file served from the SITE's own origin -- what the queue-stub
   * rule means by the page installing the queue stub "in its own bundle, a file
   * served from the page's own origin, which `script-src 'self'` already
   * allows". T13 and T49b need it to be that and not an inline script.
   */
  asset(path: string, javascript: string): void {
    this.assets.set(this.absolute(path), javascript)
  }

  private absolute(url: string): string {
    return /^[a-z]+:/.test(url) ? url : SITE_ORIGIN + url
  }

  /**
   * Install routes before navigation. Override Playwright’s default webdriver flag so
   * ordinary scenarios can send; automation-exclusion cases opt back in.
   */
  async install(options: { webdriver?: boolean; automation?: '_phantom' | '__nightmare' | 'Cypress' } = {}): Promise<void> {
    await this.page.addInitScript(
      (o: { webdriver: boolean; automation: string }) => {
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => o.webdriver, configurable: true })
        if (o.automation) (window as unknown as Record<string, unknown>)[o.automation] = {}
      },
      { webdriver: options.webdriver === true, automation: options.automation ?? '' },
    )
    await this.page.route('**/*', (route) => this.serve(route))
  }

  private serve(route: Route): void {
    const url = route.request().url()
    if (url.startsWith(new URL(this.endpoint).origin)) {
      // The endpoint is mockd and must really be reached.
      void route.continue()
      return
    }
    const bundle = BUNDLES[url]
    if (bundle !== undefined) {
      void route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: readFileSync(bundle, 'utf8'),
      })
      return
    }
    const withoutQuery = url.split('#')[0]!.split('?')[0]!
    const asset = this.assets.get(withoutQuery)
    if (asset !== undefined) {
      void route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: asset })
      return
    }
    const spec = this.pages.get(url) ?? this.pages.get(withoutQuery) ?? this.fallback
    void route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: this.html(spec) })
  }

  private html(spec: PageSpec): string {
    const attrs: Record<string, string | true> = { product: PRODUCT, endpoint: this.endpoint, ...(spec.attrs ?? {}) }
    const tag =
      spec.snippet === false
        ? ''
        : '<script defer ' +
          Object.entries(attrs)
            .map(([k, v]) => (v === true ? `data-${kebab(k)}` : `data-${kebab(k)}="${escapeAttr(String(v))}"`))
            .join(' ') +
          ` src="${spec.src ?? this.bundle}"></script>`
    return (
      '<!doctype html><html><head><meta charset="utf-8"><title>jelto fixture</title>' +
      (spec.before ?? '') +
      tag +
      (spec.head ?? '') +
      '</head><body>' +
      (spec.body ?? '') +
      '</body></html>'
    )
  }

  /**
   * Navigate through a real referring page and link so document.referrer obeys browser
   * referrer policy.
   */
  async goto(url: string, options: { from?: string } = {}): Promise<void> {
    const target = this.absolute(url)
    if (!options.from) {
      await this.page.goto(target, { waitUntil: 'load' })
      return
    }
    this.register(options.from, { snippet: false, body: `<a id="jelto-nav" href="${escapeAttr(target)}">go</a>` })
    await this.page.goto(options.from, { waitUntil: 'load' })
    await Promise.all([this.page.waitForURL(target), this.page.click('#jelto-nav')])
  }
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
