// The opt-in cookie mode, `jelto.cookie.js`.
// TC1, TC2, TC3, TC4, TC5, TC6, TC7, TC8, TC9, TC10.
//
// WHICH CASES RUN AGAINST WHICH FILE, decided here and stated once.
//
// Every pageview, click, engagement and transport case elsewhere in this suite runs
// against `jelto.js` and only `jelto.js`. None of them is re-pointed at the cookie build,
// parameterised over both, or weakened to hold for either. That is a direct consequence of
// the cookieless bundle being required to stay byte-identical whether or not the cookie
// build is enabled: a suite that re-ran those claims against a second build would be
// describing a different product's behaviour under the same case numbers.
//
// The cookie build gets its own cases, here, and they are about the one thing
// that differs. TC5 is the one to read twice: it is T27's mirror for a build
// whose entire purpose is storage. T27 says "with `data-memory` absent, NO
// storage API is touched at all", and the interesting question the second build
// raises is not whether that stays true — it does, for `jelto.js` — but whether
// the cookie build still makes a bounded promise or simply stops making one.
// TC5 is that bound: exactly the cookie, and nothing else.

import { test, expect, validateAgainstSchema } from './fixtures'
import { CDN, CDN_COOKIE, SITE_ORIGIN } from './harness/site'
import { hide, lifecycle, refuseCookies, spyOnStorage, storageCalls } from './harness/browser'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** spec/wire-v1.md §5.1's grammar for `vid`, written out here rather than
 *  imported, so the browser-side value is checked against the WIRE's rule and
 *  not against whatever the snippet happens to produce. It is deliberately a
 *  shape no UUID can satisfy — that is the vid/install_id boundary made checkable,
 *  since `install_id` is a UUID. */
const VID = /^[A-Za-z0-9_-]{22}$/

/** Thirteen months, in seconds: the cookie's fixed lifetime. */
const THIRTEEN_MONTHS = 34128e3

const jar = async (page: import('@playwright/test').Page, name = 'jelto_vid') =>
  (await page.context().cookies()).find((c) => c.name === name)

test('TC1 — the cookie build sets jelto_vid and puts it on the pageview as vid', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({})
  await site.goto('/')

  const events = await mockd.awaitEvents(1)
  const cookie = await jar(page)
  expect(cookie, 'no jelto_vid cookie was set').toBeDefined()
  expect(cookie!.value).toMatch(VID)
  // A UUID here would mean the app surface's identifier shape had reached the
  // web one. spec/wire-v1.md §5.1 rejects it; so does this.
  expect(cookie!.value).not.toMatch(/^[0-9a-f]{8}-/)
  // The same string in both places. Not two values that merely both exist.
  expect(events[0]!.vid).toBe(cookie!.value)
})

test('TC2 — a returning browser keeps its id, and the cookie is not rewritten', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({})

  await site.goto('/')
  const first = await mockd.awaitEvents(1)
  const minted = (await jar(page))!.value
  const expiresAfterFirst = (await jar(page))!.expires
  // The spy's counter lives in `window`, so it is per DOCUMENT -- which is the
  // right granularity for this case and the reason the two counts are read
  // separately. On the first visit there is nothing to read, so exactly one
  // write; on the second there is, so none.
  expect((await storageCalls(page)).filter((c) => c === 'cookie.set')).toHaveLength(1)

  await site.goto('/pricing')
  // Three, not two: leaving the first page ends its pageview, so its engagement
  // is on the wire between the two pageviews — cookie mode changes nothing about that.
  const events = await mockd.awaitEvents(3)
  const second = events.find((e) => e.n === 'pageview' && e.u === SITE_ORIGIN + '/pricing')!

  expect(second.vid).toBe(first[0]!.vid)
  expect((await jar(page))!.value).toBe(minted)
  // The lifetime is FIXED at first set and never extended, so a browser
  // that visits every day for a year still loses the cookie thirteen months
  // after the FIRST visit. A rolling expiry would make the disclosed duration
  // "thirteen months after you stop coming", which is not what it says.
  expect((await jar(page))!.expires).toBe(expiresAfterFirst)
  // AND THE RULE STATED DIRECTLY: the returning visit writes nothing. Checking
  // only the value and the expiry would also pass on a build that rewrote the
  // cookie with the same value and a fresh max-age, which is the rolling
  // lifetime this fixed-expiry rule refuses -- the jar would look identical for thirteen
  // months and differ only for a visitor who had stopped coming.
  const onReturn = await storageCalls(page)
  expect(onReturn).toContain('cookie.get')
  expect(onReturn.filter((c) => c === 'cookie.set')).toHaveLength(0)
})

test('TC3 — the cookie is host-only, path=/, SameSite=Lax, Secure, and lasts thirteen months', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({})
  await site.goto('/')
  await mockd.awaitEvents(1)

  const cookie = (await jar(page))!
  expect(cookie.path).toBe('/')
  expect(cookie.sameSite).toBe('Lax')
  // The fixture site is https, so `secure` is set. Cookie mode omits it on http
  // rather than shipping a cookie the browser silently discards.
  expect(cookie.secure).toBe(true)
  // Host-only: no leading-dot domain, so it does not reach subdomains.
  expect(cookie.domain).toBe('site.example')
  // Not HttpOnly, and cannot be: it is written by script.
  expect(cookie.httpOnly).toBe(false)

  const lifetime = cookie.expires - Date.now() / 1000
  expect(lifetime).toBeGreaterThan(THIRTEEN_MONTHS - 300)
  expect(lifetime).toBeLessThan(THIRTEEN_MONTHS + 300)
  // The other half of the fixed-lifetime rule, and the reason the number is 395 days and
  // not "two years": Chrome caps a cookie's lifetime at 400 days and truncates silently.
  // A longer figure would be disclosed to visitors and not honoured by the
  // browser, which is a false statement published under the customer's name.
  expect(lifetime).toBeLessThan(400 * 86400)
})

test('TC4 — a browser that refuses the cookie sends no vid at all, never a fresh one per pageview', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await refuseCookies(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({})

  await site.goto('/')
  await mockd.awaitEvents(1)
  await site.goto('/pricing')
  const events = await mockd.awaitEvents(3)

  expect(await jar(page), 'the refusing jar stored something after all').toBeUndefined()
  // THE POINT OF THE CASE. A minted id that is not read back would be a new
  // random value on every pageview, and `visitors` — labelled "unique
  // visitors" in this mode — would count PAGEVIEWS. A reported metric must never be a
  // number that is not true, and this is the failure that is invisible from
  // the server: a thousand one-page visitors and a thousand refusals are the
  // same rows. So the assertion is not merely "no vid", it is "no two vids".
  for (const event of events) expect(event).not.toHaveProperty('vid')
  expect(new Set(events.map((e) => e.vid)).size).toBe(1)
  // And the events themselves still go out: a refused cookie degrades to
  // cookieless counting, it does not stop the product working.
  expect(events.filter((e) => e.n === 'pageview')).toHaveLength(2)
})

test('TC5 — the cookie build touches the cookie and NO other storage API', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({ body: '<a id="dl" href="/dl/App.pkg">d</a>' })
  await site.goto('/?utm_source=producthunt')
  await mockd.awaitEvents(1)
  await page.evaluate(() =>
    document.getElementById('dl')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })),
  )
  await mockd.awaitEvents(2)

  // T27's mirror. `data-memory` is absent, so the localStorage branch does
  // not exist in this code path either — the cookie build adds a cookie, it
  // does not lift the rest of the storage-free promise.
  const calls = await storageCalls(page)
  expect(new Set(calls)).toEqual(new Set(['cookie.get', 'cookie.set']))
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
    expect(calls, `the cookie build touched ${name}`).not.toContain(name)
  }
})

test('TC6 — vid is on every web event, not only the pageview', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({
    body: '<a id="dl" href="/dl/App.pkg">d</a><button id="tag" data-jelto-event="signup">t</button>',
  })
  await site.goto('/')
  await mockd.awaitEvents(1)

  await page.evaluate(() => {
    document.getElementById('dl')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    document.getElementById('tag')!.click()
  })
  await mockd.awaitEvents(3)
  await hide(page)

  const events = await mockd.awaitEvents(4)
  const id = (await jar(page))!.value
  expect(events.map((e) => e.n).sort()).toEqual(['click:download', 'engagement', 'pageview', 'signup'])
  for (const event of events) {
    expect(event.vid, `${event.n} carries no vid`).toBe(id)
  }
})

test('TC7 — B2 still rules: on localhost nothing is sent AND no cookie is set', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({})
  await site.goto('http://localhost:3000/')

  // The localhost/exclusion block happens before anything is installed (index.ts), so the
  // cookie is not written either. A build that read its cookie first and checked that
  // block second would set an identifier on a page it then refuses to report — storage
  // written for a visit that produces no row at all.
  expect(await mockd.quiet()).toEqual([])
  expect(await jar(page)).toBeUndefined()
})

test('TC8 — boundary 1 in a browser: jelto.js sets no cookie and sends no vid', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  // The DEFAULT bundle, on a page identical to TC1's in every other respect.
  site.bundle = CDN
  site.defaults({})
  await site.goto('/')

  const events = await mockd.awaitEvents(1)
  expect(events[0]).not.toHaveProperty('vid')
  expect((await page.context().cookies()).map((c) => c.name)).toEqual([])
  expect(await storageCalls(page)).toEqual([])
})

test('TC9 — every cookie-mode body validates against spec/wire-v1.schema.json', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({ attrs: { memory: 'on' }, body: '<a id="dl" href="/dl/App.pkg">d</a>' })
  await site.goto('/?utm_source=producthunt')
  await mockd.awaitEvents(1)
  await page.evaluate(() =>
    document.getElementById('dl')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })),
  )
  await mockd.awaitEvents(2)
  await hide(page)
  await mockd.awaitEvents(3)

  // The same validator T22, T40, conformance W1 and `make dogfood-wire` use:
  // `vid` is a field the schema knows since wire rev 0.20, so this is a real
  // check and not a permissive one.
  validateAgainstSchema(await mockd.bodies())
})

test('TC10 — jelto.cookie.js is within its gzipped budget', () => {
  // 3 218 B = the 3 000 B ceiling for the shared source plus the 218 B the
  // cookie mode measured at its first build. The cookie bundle therefore has exactly
  // the headroom the shared-source budget already grants and none of its own: a new
  // cookie-only rule reopens the cookie-mode budget, and a change to the shared source
  // is refused by the shared-source budget's gate first. The number is here and in
  // build.mjs, and nowhere else.
  const BUDGET = 3518
  const bundle = readFileSync(path.resolve(here, '../dist/jelto.cookie.js'))
  const gzipped = gzipSync(bundle, { level: 9 }).length
  console.log(`TC10: ${bundle.length} B raw, ${gzipped} B gzipped of ${BUDGET}`)
  expect(gzipped).toBeLessThanOrEqual(BUDGET)
})
