// Send pageview totals, never deltas: the server reduces engagement by pv using max(e)
// and the last sd (spec/metrics.md §4.1b).

import type { Config } from './types'
import { send, flush } from './send'

let pv = '' // the live pageview's `id`; '' once it has been replaced
let url = ''
let eng = 0 // engaged ms banked while the clock was last stopped
let mark = -1 // performance.now() when the clock started; -1 = stopped
let reach = 0 // B16's pixel maximum, NEVER a percentage
let sentE = 0 // `e` of the last engagement sent for this `pv`
let sentSd = -1 // its `sd`; -1 = none sent yet
let raf = 0

/** Engaged ms right now, whether or not the clock is running. */
function ms(): number {
  return mark < 0 ? eng : eng + performance.now() - mark
}

function start(): void {
  if (mark < 0 && document.visibilityState === 'visible' && document.hasFocus()) mark = performance.now()
}

function stop(): void {
  eng = ms()
  mark = -1
}

/** B16: `reach = max(reach, scrollY + innerHeight)`, in pixels. */
function sample(): void {
  const r = scrollY + innerHeight
  if (r > reach) reach = r
}

/**
 * Measure document height at send time. Including clientHeight makes short pages report
 * 100% scroll depth.
 */
function height(): number {
  const d = document.documentElement
  const b = document.body
  return Math.max(d.scrollHeight, d.offsetHeight, d.clientHeight, b.scrollHeight, b.offsetHeight, b.clientHeight, 1)
}

// `m`: 0 = a replacing pageview, 1 = hidden or `pagehide`, 2 = focus loss.
// Only 2 is volume-gated (B17); 1 and 2 flush at once (B7).
function fire(m: number): void {
  if (!pv) return
  sample()
  const e = Math.min(18e5, Math.round(ms()))
  // Scroll depth may decrease when the document grows; do not clamp it to a previous
  // value.
  const sd = Math.min(100, Math.round((reach / height()) * 100))
  if (e === sentE && sd === sentSd) return
  // Focus-loss flushes below the volume gate retain their time for the next flush.
  if (m === 2 && (sentSd < 0 || sd === sentSd) && e - sentE < 3000) return
  sentE = e
  sentSd = sd
  send({ n: 'engagement', u: url, pv, e, sd, i: false })
  if (m) flush(true)
}

/**
 * Use a monotonic clock while visible and focused. Blur must also check hasFocus():
 * switching applications need not fire visibilitychange.
 * Scroll sampling is passive and coalesced through requestAnimationFrame; height is
 * re-read at send time when ResizeObserver is unavailable.
 */
export function initEngage(_c: Config): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') start()
    else {
      stop()
      fire(1)
    }
  })
  addEventListener('pagehide', () => {
    stop()
    fire(1)
  })
  addEventListener('blur', () => {
    if (!document.hasFocus()) {
      stop()
      fire(2)
    }
  })
  addEventListener('focus', start)
  addEventListener(
    'scroll',
    () => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0
          sample()
        })
      }
    },
    { passive: true },
  )
}

/** Adopt only a pageview that was sent, so excluded pageviews never acquire engagement. */
export function pvStart(id: string, u: string): void {
  pv = id
  url = u
  eng = 0
  reach = 0
  sentE = 0
  sentSd = -1
  mark = -1
  start()
  sample()
}

/**
 * Flush the outgoing pageview without the focus-loss volume gate, then detach it before
 * its replacement is sent.
 */
export function pvEnd(): void {
  fire(0)
  pv = ''
}
