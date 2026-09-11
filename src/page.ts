import type { Config, EventOptions, PageContext, Props } from './types'
import { blocked, excluded, pagePath, pageUrl, urlPath } from './config'
import { send, stopped, uuid } from './send'
import { cohort, remember, firstTouch } from './cohort'
import { pvEnd, pvStart } from './engage'

let cfg: Config
/** Last accepted pageview URL, used for SPA deduplication and the next referrer. */
let cur = ''
let timer = 0
let pageviewId: string | null = null
let active = true

function context(): PageContext {
  return { active: active && !blocked(cfg) && !stopped(), pageviewId, url: cur }
}

function changed(): void { dispatchEvent(new Event('jelto:pageview')) }

/**
 * Initialize after other modules: this drains the queued API calls and may send the first
 * pageview. Automatic pageviews wait until visible; explicit calls keep the caller’s
 * timing.
 */
export function initPage(c: Config): void {
  cfg = c

  const g = window as unknown as Record<string, any>
  const stub = g.jelto
  g.jelto = api
  const buffered = stub && stub.q
  if (buffered) {
    for (const call of buffered) api.apply(0, call)
    buffered.length = 0
  }

  if (!c.autoPageview) return

  if (c.spa) {
    for (const k of ['pushState', 'replaceState'] as const) {
      const inner = history[k]
      history[k] = function (this: History, d: unknown, t: string, u?: string | URL | null): void {
        inner.call(this, d, t, u)
        moved()
      }
    }
    addEventListener('popstate', moved)
  }
  if (c.hash) addEventListener('hashchange', moved)
  addEventListener('pageshow', (e) => {
    if (e.persisted) pageview()
  })

  if (document.hidden) addEventListener('visibilitychange', shown)
  else pageview()
}

/** B1: a prerendered or background tab waits, and fires once. */
function shown(): void {
  if (!document.hidden) {
    removeEventListener('visibilitychange', shown)
    pageview()
  }
}

function api(cmd: string, a?: unknown, b?: unknown, options?: EventOptions): string | PageContext | { cohort: string; first: boolean } | void {
  try {
    if (cmd == 'event') send({ n: a as string, props: b as Props, i: options?.interactive })
    else if (cmd == 'pageview') pageview(a as { u?: string; r?: string })
    else if (cmd == 'context') return context()
    else if (cmd == 'cohort') return cohort()
    else if (cmd == 'attribution' && context().active) return { cohort: cohort(), first: firstTouch }
    else if (cmd == 'payment' && context().active) {
      const q = ((api as typeof api & { q?: unknown[] }).q ||= [])
      if (q.length < 20) q.push([cmd, a])
    }
  } catch {}
}

/** Wait for router URL/title updates before sending; unchanged URLs are deduplicated. */
function moved(): void {
  clearTimeout(timer)
  if (pageUrl(cfg) == cur && active) return
  // Cancel helper dwell immediately, before the existing route debounce.
  active = false
  changed()
  timer = setTimeout(() => {
    const u = pageUrl(cfg)
    // A router may leave and return before its URL settles. Preserve B9's
    // unchanged-page rule and resume the original helper context in that case.
    if (u == cur && pageviewId) { active = true; changed() }
    else pageview({ u, r: cur })
  }, 300)
}

/**
 * Resolve supplied URLs to absolute URLs and omit non-HTTP referrers to avoid rejecting
 * the whole event. Flush outgoing engagement before replacing the pageview; start new
 * engagement only after send succeeds.
 */
export function pageview(opts?: { u?: string; r?: string }): void {
  try {
    const o = opts || {}
    const u = o.u ? new URL(o.u, location.href).href : pageUrl(cfg)
    if (cur) pvEnd()
    active = !blocked(cfg) && !excluded(cfg, o.u ? urlPath(cfg, u) : pagePath(cfg)) && !stopped()
    pageviewId = null
    if (!active) { changed(); return }
    const r = o.r == null ? document.referrer : o.r
    const id = uuid()
    if (!send({
      n: 'pageview',
      id,
      u,
      r: /^https?:\/\//.test(r) ? r : undefined,
      w: screen.width,
    })) { active = false; changed(); return }
    // Write first-touch memory after sending, so newly stored attribution applies to
    // subsequent events (B15, T29).
    remember()
    cur = u
    pageviewId = id
    pvStart(id, u)
    changed()
  } catch {}
}
