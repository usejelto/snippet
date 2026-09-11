// Storage must never be accessed unless data-memory="on" (spec/snippet.md B15).

import type { Config } from './types'

let c: Config
/** Whether the latest cohort read used first-touch attribution. */
export let firstTouch = false
const KEY = 'jelto_first'

export function initCohort(x: Config): void {
  c = x
}

/** §3's `clean`: lower-case, keep `[a-z0-9._-]`, truncate the segment to 64. */
function clean(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64)
}

/** §3 without the memory branch: this page's own last touch, or `''`. */
function own(): string {
  const q = new URLSearchParams(location.search)
  const src = q.get('utm_source') || q.get('ref') || q.get('source') || q.get('via')
  if (src) {
    const m = q.get('utm_medium')
    const p = q.get('utm_campaign')
    return clean(src) + (m ? '~' + clean(m) + (p ? '~' + clean(p) : '') : '')
  }
  const linked = (window as unknown as { __jeltoAttribution?: () => { cohort: string; first: boolean } | undefined }).__jeltoAttribution?.()
  if (linked) {
    firstTouch = linked.first
    return linked.cohort
  }
  const r = document.referrer
  if (r) {
    const h = new URL(r).hostname
    if (h && h !== location.hostname) return 'ref:' + h
  }
  return ''
}

/** Today, `YYYY-MM-DD`, the form B15 stores. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Read first-touch memory only when enabled. Delete entries older than 30 days and
 * tolerate unavailable storage.
 */
function read(): { f: string; fd: string } | undefined {
  if (c.memory) {
    try {
      const v = localStorage.getItem(KEY) || ''
      const i = v.indexOf('|')
      if (i > 0) {
        const fd = v.slice(i + 1)
        if (Date.parse(fd) >= Date.parse(today()) - 2592e6) return { f: v.slice(0, i), fd }
        localStorage.removeItem(KEY)
      }
    } catch {}
  }
}

/**
 * Return the current download attribution label, or empty when unassigned. Valid
 * first-touch memory takes precedence over the current URL and referrer. Also serves
 * jelto('cohort').
 */
export function cohort(): string {
  const m = read()
  firstTouch = !!m
  return m ? m.f : own()
}

/**
 * Decorate a resolved download URL unless the customer already supplied jl or utm_source.
 * Append textually: URLSearchParams would encode the cohort’s required ~ separators.
 */
export function decorate(href: string): string {
  const i = href.indexOf('#')
  const base = i < 0 ? href : href.slice(0, i)
  if (/[?&](jl|utm_source)=/.test(base)) return href
  const l = cohort()
  if (!l) return href
  return (
    base +
    (base.indexOf('?') < 0 ? '?' : '&') +
    'jl=' +
    l +
    (firstTouch ? '&jt=first' : '') +
    (i < 0 ? '' : href.slice(i))
  )
}

/**
 * Read attribution for an outgoing event; expired entries are removed. Disabled memory
 * performs no storage access.
 */
export function memory(): { f?: string; fd?: string } {
  return read() || {}
}

/**
 * Remember a non-empty source after an accepted pageview. Never replace valid first-touch
 * memory; tolerate storage failures.
 */
export function remember(): void {
  if (!c.memory) return
  const l = own()
  if (l && !read()) {
    try {
      localStorage.setItem(KEY, l + '|' + today())
    } catch {}
  }
}
