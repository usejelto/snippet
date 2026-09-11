import type { Config, Ev, Outgoing } from './types'
import { blocked, pageUrl } from './config'
import { memory } from './cohort'
import { initVid, vid } from './vid'

let cfg: Config
const q: Ev[] = []
/**
 * Monotonic send time prevents wall-clock corrections from stalling the throttle. The
 * server’s until timestamp remains a wall-clock instant.
 */
let last = -1e9
let until = 0

export function stopped(): boolean { return Date.now() < until }

/**
 * The fallback fixes the UUID version and variant bits, so even all-zero random bytes
 * cannot produce the forbidden nil UUID.
 */
export function uuid(): string {
  return (
    crypto.randomUUID?.() ||
    ('' + 1e7 + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (d) =>
      (+d ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+d / 4)))).toString(16),
    )
  )
}

/**
 * Initialize before pageviews can be queued. Listen for visibilitychange on window so
 * document-level engagement handlers enqueue before its terminal flush.
 */
export function initSend(c: Config): void {
  cfg = c
  // Read cookie identity before the first event; this branch is removed from the
  // cookieless build.
  if (__JELTO_COOKIE__) initVid()
  setInterval(flush, 1000)
  const t = (): void => flush(true)
  addEventListener('pagehide', t)
  addEventListener('visibilitychange', () => {
    if (document.hidden) t()
  })
}

/**
 * Queue an event with common wire fields and current attribution. Return false on errors
 * or when sending is disabled; never throw into the host page.
 */
export function send(ev: Outgoing): boolean {
  try {
    // A terminal engagement belongs to its previous, eligible pageview.
    if (stopped() || (ev.n !== 'engagement' && blocked(cfg))) return false
    const e: Ev = {
      ...ev,
      id: ev.id || uuid(),
      t: Date.now(),
      s: 'web',
      v: __JELTO_VERSION__,
      l: navigator.language,
      u: ev.u || pageUrl(cfg),
    }
    if (cfg.hash) e.h = 1
    // Omit vid when cookies are refused; a fresh identifier per pageview would inflate
    // unique visitors.
    if (__JELTO_COOKIE__) {
      const v = vid()
      if (v) e.vid = v
    }
    // Snapshot while admitting the event. Invalid JSON values never enter the
    // queue, and later caller mutations cannot poison a pending batch.
    q.push(JSON.parse(JSON.stringify({ ...e, ...memory() })))
    return true
  } catch {}
  return false
}

/**
 * Send the first click immediately, then batch subsequent clicks until the next tick.
 * Terminal flushes bypass throttling so engagement is not stranded when focus or
 * visibility changes. Each batch is attempted once, without retries.
 */
export function flush(force?: boolean, count = Math.min(q.length, 100)): void {
  try {
    const now = performance.now()
    if (!q.length || Date.now() < until || (!force && now - last < 1000)) return
    // Wire §2 limits both event count and UTF-8 bytes, including the envelope.
    const body = JSON.stringify({ v: 1, p: cfg.product, e: q.slice(0, count) })
    if (new Blob([body]).size > 65536) {
      // At most seven attempts for 100 events. Keep the original throttle
      // until a batch fits, and leave the remainder for later ticks.
      if (count > 1) flush(force, count >> 1)
      else q.shift() // One oversized event cannot strand its valid neighbors.
      return
    }
    last = now
    q.splice(0, count)
    // B7: `sendBeacon` only when `fetch` is absent. No headers, so the body
    // goes as `text/plain;charset=UTF-8` (wire §1) and the POST stays a CORS
    // simple request with no preflight.
    if (typeof fetch == 'function') {
      fetch(cfg.endpoint, { method: 'POST', keepalive: true, body })
        .then((r) => r.text())
        .then(stop, hush)
    } else navigator.sendBeacon(cfg.endpoint, body)
  } catch {}
}

function hush(): void {}

/** wire §8: a `web`-scoped `stop` halts sending until `until` (Unix seconds). */
function stop(text: string): void {
  try {
    const s = (JSON.parse(text) as { stop?: { until: number; scope: string } }).stop
    if (s && s.scope == 'web') {
      until = s.until * 1000
      dispatchEvent(new Event('jelto:pageview'))
    }
  } catch {}
}
