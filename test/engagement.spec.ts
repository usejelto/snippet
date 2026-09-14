// Engagement tests: the monotonic timer and the scroll-reach pixel maximum.
// T33, T34, T35, T35b, T35c, T36, T37, T38, T39, T39b, T39c, T40.
//
// Every case here runs on Playwright's fake clock. Engaged time accumulates from
// `performance.now()`, which `page.clock.install()` fakes along with
// `setTimeout`, `setInterval` and `requestAnimationFrame` -- so a 45-second
// scenario is 45 faked seconds and the assertion on `e` is exact rather than
// tolerant of a loaded machine. `runFor` also drives the snippet's own 1 s
// batch tick, which is why every test advances the clock before reading.

import { test, expect } from './fixtures'
import { SITE_ORIGIN } from './harness/site'
import { lifecycle, show, hide, blur, focus, pagehide, setDocumentHeight } from './harness/browser'
import type { WireEvent } from './harness/mockd'

const TALL = '<div id="pad"></div>'

async function boot(
  page: import('@playwright/test').Page,
  site: import('./harness/site').Site,
  spec: { attrs?: Record<string, string | true>; body?: string } = {},
): Promise<void> {
  await page.clock.install()
  await lifecycle(page)
  await site.install()
  site.defaults({ body: TALL, ...spec })
  await site.goto('/')
  await page.clock.runFor(1_000)
}

const engagements = (events: WireEvent[]): WireEvent[] => events.filter((e) => e.n === 'engagement')

/**
 * Scrolls and lets the scroll-reach sampler actually sample.
 *
 * Two clocks are in play and both have to turn. The `scroll` event is
 * dispatched by the browser's own pipeline in REAL time, so a real wait is
 * needed before it exists at all; the handler then coalesces through
 * `requestAnimationFrame`, which `clock.install()` fakes, so the fake clock has
 * to be advanced before that callback runs. Advancing only the fake clock
 * samples nothing, and the pixel maximum then still reads one viewport --
 * which is what made T34 report 33.
 */
async function scrollTo(page: import('@playwright/test').Page, y: number | 'bottom'): Promise<void> {
  await page.evaluate((target: number | 'bottom') => {
    window.scrollTo(0, target === 'bottom' ? document.documentElement.scrollHeight : target)
  }, y)
  await page.waitForTimeout(120)
  await page.clock.runFor(120)
}

test('T33 — hidden time is not engaged time, and a stale terminal beacon is suppressed', async ({
  page,
  site,
  mockd,
}) => {
  await boot(page, site)
  const pv = (await mockd.awaitEvents(1))[0]!.id

  await page.clock.runFor(24_000) // 25 s visible in total, with the 1 s above
  await hide(page)
  await page.clock.runFor(20_000) // 20 s in the background
  await pagehide(page)
  await page.clock.runFor(1_000)

  const rows = engagements(await mockd.awaitEvents(2))
  expect(rows).toHaveLength(1)
  expect(rows[0]!.pv).toBe(pv)
  expect(rows[0]!.e).toBeGreaterThanOrEqual(24_500)
  expect(rows[0]!.e).toBeLessThanOrEqual(25_500)
  expect(rows[0]!.i).toBe(false)
})

test('T34 — the pixel maximum never decreases: down and back up is still 100', async ({ page, site, mockd }) => {
  await boot(page, site)
  await setDocumentHeight(page, 3)

  await scrollTo(page, 'bottom')
  await scrollTo(page, 0)
  await hide(page)
  await page.clock.runFor(1_000)

  const rows = engagements(await mockd.awaitEvents(2))
  expect(rows).toHaveLength(1)
  expect(rows[0]!.sd).toBe(100)
})

test('T35 — a page shorter than the viewport reads 100 from the start', async ({ page, site, mockd }) => {
  await boot(page, site, { body: '<p>short</p>' })
  await page.clock.runFor(5_000)
  await hide(page)
  await page.clock.runFor(1_000)

  const rows = engagements(await mockd.awaitEvents(2))
  expect(rows).toHaveLength(1)
  expect(rows[0]!.sd).toBe(100)
})

test('T35b — a document that grew is divided by the height at SEND time: sd = 14', async ({ page, site, mockd }) => {
  await boot(page, site)
  await page.clock.runFor(1_000)
  await setDocumentHeight(page, 7)
  await page.clock.runFor(9_000)
  await hide(page)
  await page.clock.runFor(1_000)

  const rows = engagements(await mockd.awaitEvents(2))
  expect(rows).toHaveLength(1)
  // A percentage frozen at load would say 100.
  expect(rows[0]!.sd).toBe(14)
})

test('T35c — sd DECREASES for one pv when the document grew between beacons', async ({ page, site, mockd }) => {
  await boot(page, site, { body: '<p>one viewport</p>' })
  await page.clock.runFor(3_000)
  await hide(page)
  await page.clock.runFor(500)

  let rows = engagements(await mockd.awaitEvents(2))
  expect(rows).toHaveLength(1)
  expect(rows[0]!.sd).toBe(100)

  await show(page)
  await setDocumentHeight(page, 5)
  await page.clock.runFor(4_000)
  await hide(page)
  await page.clock.runFor(1_000)

  rows = engagements(await mockd.awaitEvents(3))
  expect(rows).toHaveLength(2)
  // The case that discriminates the two reductions: a snippet that still
  // clamps sends 100 here.
  expect(rows[1]!.sd).toBe(20)
  expect(rows[1]!.pv).toBe(rows[0]!.pv)
})

test('T36 — two engagements for one pv, both totals, neither a delta', async ({ page, site, mockd }) => {
  await boot(page, site)
  await setDocumentHeight(page, 4)
  await page.clock.runFor(4_000)
  await hide(page)
  await page.clock.runFor(500)

  await show(page)
  await scrollTo(page, 'bottom')
  await page.clock.runFor(4_000)
  await hide(page)
  await page.clock.runFor(1_000)

  const rows = engagements(await mockd.awaitEvents(3))
  expect(rows).toHaveLength(2)
  expect(rows[0]!.pv).toBe(rows[1]!.pv)
  expect(rows[1]!.e!).toBeGreaterThanOrEqual(rows[0]!.e!)
  expect(rows[1]!.sd!).toBeGreaterThanOrEqual(rows[0]!.sd!)
  // A delta would restart near zero; a total does not.
  expect(rows[1]!.e!).toBeGreaterThanOrEqual(7_500)
})

test('T37 — hide, show, hide again with nothing changed sends only one engagement', async ({ page, site, mockd }) => {
  await boot(page, site)
  await page.clock.runFor(4_000)
  await hide(page)
  await page.clock.runFor(500)
  // "no scroll and no FOCUS in between": the tab became visible while the
  // window did not regain focus, so the engaged-time clock -- visible AND focused --
  // never restarted and `e` is genuinely unchanged. Without that, a few milliseconds
  // of reading accrue and a second row is correctly sent.
  await show(page, { focus: false })
  await hide(page)
  await page.clock.runFor(1_500)

  const rows = engagements(await mockd.awaitEvents(2))
  expect(rows).toHaveLength(1)
})

test('T38 — on an SPA path change the engagement is on the wire BEFORE the new pageview', async ({
  page,
  site,
  mockd,
}) => {
  await boot(page, site)
  await setDocumentHeight(page, 3)
  await scrollTo(page, 'bottom')
  await page.clock.runFor(4_000)

  await page.evaluate(() => history.pushState({}, '', '/pricing'))
  await page.clock.runFor(1_500)

  const events = await mockd.awaitEvents(3)
  const names = events.map((e) => e.n)
  expect(names).toEqual(['pageview', 'engagement', 'pageview'])
  expect(events[1]!.pv).toBe(events[0]!.id)
  expect(events[2]!.u).toBe(SITE_ORIGIN + '/pricing')

  // The new pageview starts e and sd at zero under a new pv.
  await page.clock.runFor(4_000)
  await hide(page)
  await page.clock.runFor(1_000)
  const rows = engagements(await mockd.awaitEvents(4))
  expect(rows).toHaveLength(2)
  expect(rows[1]!.pv).toBe(events[2]!.id)
  expect(rows[1]!.e!).toBeLessThan(rows[0]!.e! + 6_000)
})

test('T39 — a blurred window is not engaged time', async ({ page, site, mockd }) => {
  await boot(page, site)
  await page.clock.runFor(4_000)
  await blur(page)
  await page.clock.runFor(30_000)
  await focus(page)
  await page.clock.runFor(1_000)
  await hide(page)
  await page.clock.runFor(1_000)

  // Three events: the pageview, the engagement the blur flushes (4 s of engaged
  // time, above the 3 s floor T39c sets) and the engagement the hide flushes.
  // Waiting for two could return before the hide's row arrived and read the
  // blur's 4 s as the final figure.
  const rows = engagements(await mockd.awaitEvents(3))
  expect(rows).toHaveLength(2)
  const last = rows[rows.length - 1]!
  expect(last.e!).toBeLessThan(10_000)
  expect(last.e!).toBeGreaterThanOrEqual(5_500)
})

test('T39b — the beacon goes out AT the blur, not at close', async ({ page, site, mockd }) => {
  await boot(page, site)
  await page.clock.runFor(19_000)
  await blur(page)
  await page.clock.runFor(200)

  const rows = engagements(await mockd.awaitEvents(2, 3_000))
  expect(rows, 'an engagement at the blur, before any pagehide').toHaveLength(1)
  expect(rows[0]!.e!).toBeGreaterThanOrEqual(19_500)
  expect(rows[0]!.e!).toBeLessThanOrEqual(20_500)
})

test('T39c — three blur/refocus cycles inside 2 s send nothing, and the time is not lost', async ({
  page,
  site,
  mockd,
}) => {
  await boot(page, site)
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(600)
    await blur(page)
    await page.clock.runFor(50)
    await focus(page)
  }
  await page.clock.runFor(1_500)
  expect(engagements(await mockd.events())).toHaveLength(0)

  await hide(page)
  await page.clock.runFor(1_000)
  const rows = engagements(await mockd.awaitEvents(2))
  expect(rows).toHaveLength(1)
  // It rides the next flush: ~1 s of boot + 3 x 600 ms of reading.
  expect(rows[0]!.e!).toBeGreaterThanOrEqual(2_500)
})

test('T40 — every engagement body is schema-shaped', async ({ page, site, mockd }) => {
  await boot(page, site)
  await setDocumentHeight(page, 2)
  await scrollTo(page, 'bottom')
  await page.clock.runFor(5_000)
  await hide(page)
  await page.clock.runFor(1_000)

  const rows = engagements(await mockd.awaitEvents(2))
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(row.pv).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(row.e!).toBeGreaterThanOrEqual(0)
    expect(row.e!).toBeLessThanOrEqual(1_800_000)
    expect(row.sd!).toBeGreaterThanOrEqual(0)
    expect(row.sd!).toBeLessThanOrEqual(100)
    expect(row.i).toBe(false)
    expect(Number.isInteger(row.e)).toBe(true)
    expect(Number.isInteger(row.sd)).toBe(true)
  }
})
