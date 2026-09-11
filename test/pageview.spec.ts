// The pageview, skip-rule and lifecycle cases.
// T1, T1b, T1c, T1d, T2, T3, T4, T5c, T14, T14b, T15, T41, T42, T43, T44.

import { test, expect } from './fixtures'
import { SITE_ORIGIN } from './harness/site'
import { lifecycle, show, pageshow, pagehide, stubReferrer } from './harness/browser'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
) as { version: string }
const CLIENT_VERSION = 'web/' + pkg.version

test('T1 — a plain load sends one pageview with u (no fragment), r, w, l and v', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/docs#section', { from: 'https://news.ycombinator.com/item?id=1' })

  const events = await mockd.awaitEvents(1)
  expect(events).toHaveLength(1)
  const e = events[0]!
  expect(e.n).toBe('pageview')
  expect(e.s).toBe('web')
  expect(e.u).toBe(SITE_ORIGIN + '/docs')
  expect(e.r).toBe(await page.evaluate(() => document.referrer))
  expect(e.w).toBe(await page.evaluate(() => screen.width))
  expect(e.l).toBe(await page.evaluate(() => navigator.language))
  expect(e.v).toBe(CLIENT_VERSION)
  expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(e.id).not.toBe('00000000-0000-0000-0000-000000000000')
})

test('T1b — a background tab sends nothing until visibilitychange', async ({ page, site, mockd }) => {
  await lifecycle(page, { startHidden: true })
  await site.install()
  site.defaults({})
  await site.goto('/')

  expect(await mockd.quiet(1_500)).toHaveLength(0)
  await show(page)
  const events = await mockd.awaitEvents(1)
  expect(events.map((e) => e.n)).toEqual(['pageview'])
})

test('T1c — a bfcache restore sends a second pageview on pageshow', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/')
  await mockd.awaitEvents(1)

  // A real bfcache round trip hides the page before it restores it, so the
  // outgoing pageview's engagement goes out at `pagehide` and the
  // restore is a clean second pageview.
  await pagehide(page)
  await pageshow(page, true)
  const events = await mockd.awaitEvents(3)
  const pageviews = events.filter((e) => e.n === 'pageview')
  expect(pageviews).toHaveLength(2)
  expect(pageviews[0]!.id).not.toBe(pageviews[1]!.id)
})

test('T1d — a same-origin referrer is sent whole and absolute', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/pricing', { from: SITE_ORIGIN + '/features' })

  const events = await mockd.awaitEvents(1)
  expect(events[0]!.r).toBe(SITE_ORIGIN + '/features')
  // Not trimmed to a path: §5.1 rejects the whole event for a relative `r`.
  expect(events[0]!.r).toMatch(/^https?:\/\//)
})

test('T1d — an empty referrer sends no r field at all', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/')

  const events = await mockd.awaitEvents(1)
  expect(await page.evaluate(() => document.referrer)).toBe('')
  expect(events[0]).not.toHaveProperty('r')
})

test('T1d — an android-app:// referrer sends no r field at all', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await stubReferrer(page, 'android-app://com.reddit.frontpage')
  await site.install()
  site.defaults({})
  await site.goto('/')

  const events = await mockd.awaitEvents(1)
  expect(await page.evaluate(() => document.referrer)).toBe('android-app://com.reddit.frontpage')
  expect(events[0]).not.toHaveProperty('r')
})

for (const origin of ['https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://foo.local']) {
  test(`T2 — nothing is sent from ${origin}`, async ({ page, site, mockd }) => {
    await lifecycle(page)
    await site.install()
    site.defaults({ body: '<a id="dl" href="/App.pkg">dl</a>' })
    await site.goto(origin + '/')
    await page.click('#dl').catch(() => undefined)

    expect(await mockd.quiet(1_500)).toHaveLength(0)
  })
}

test('T3 — navigator.webdriver true sends nothing', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install({ webdriver: true })
  site.defaults({})
  await site.goto('/')

  expect(await mockd.quiet(1_500)).toHaveLength(0)
})

test('T3 — window.Cypress sends nothing', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install({ automation: 'Cypress' })
  site.defaults({})
  await site.goto('/')

  expect(await mockd.quiet(1_500)).toHaveLength(0)
})

test('T4 — data-exclude: /admin/** and /p/* skip, /p/x/y does not', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { exclude: '/admin/**,/p/*' } })

  await site.goto('/admin/a/b')
  expect(await mockd.quiet(1_200)).toHaveLength(0)

  await site.goto('/p/x')
  expect(await mockd.quiet(1_200)).toHaveLength(0)

  await site.goto('/p/x/y')
  const events = await mockd.awaitEvents(1)
  expect(events.map((e) => e.u)).toEqual([SITE_ORIGIN + '/p/x/y'])
})

test('T5c — data-allow-localhost sends the pageview from http://localhost:3000', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { allowLocalhost: true } })
  await site.goto('http://localhost:3000/')

  const events = await mockd.awaitEvents(1)
  expect(events.map((e) => [e.n, e.u])).toEqual([['pageview', 'http://localhost:3000/']])
})

test('T14 — pushState sends a second pageview ~300 ms later; replaceState to the same path sends nothing', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/')
  await mockd.awaitEvents(1)

  await page.evaluate(() => history.pushState({}, '', '/pricing'))
  const events = await mockd.awaitEvents(2)
  const second = events.find((e) => e.n === 'pageview' && e.u === SITE_ORIGIN + '/pricing')
  expect(second, 'the SPA pageview for /pricing').toBeDefined()
  expect(second!.r).toBe(SITE_ORIGIN + '/')

  await page.evaluate(() => history.replaceState({}, '', '/pricing'))
  const after = await mockd.quiet(1_500)
  expect(after.filter((e) => e.n === 'pageview')).toHaveLength(2)
})

test('T14b — data-spa="off": pushState sends nothing', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { spa: 'off' } })
  await site.goto('/')
  await mockd.awaitEvents(1)

  await page.evaluate(() => history.pushState({}, '', '/pricing'))
  const events = await mockd.quiet(1_500)
  expect(events.map((e) => e.u)).toEqual([SITE_ORIGIN + '/'])
})

test('T15 — data-hash: the fragment is in u and hashchange sends a pageview', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { hash: true } })
  await site.goto('/app')
  await mockd.awaitEvents(1)

  await page.evaluate(() => {
    location.hash = '#/docs'
  })
  const events = await mockd.awaitEvents(2)
  const hashed = events.filter((e) => e.n === 'pageview').map((e) => e.u)
  expect(hashed).toContain(SITE_ORIGIN + '/app#/docs')
})

test('T41 — data-auto-pageview="off": nothing on load or pushState, two manual pageviews, engagement between them', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { autoPageview: 'off' } })
  await site.goto('/')
  expect(await mockd.quiet(1_200)).toHaveLength(0)

  await page.evaluate(() => window.jelto('pageview'))
  await mockd.awaitEvents(1)

  await page.evaluate(() => history.pushState({}, '', '/pricing'))
  expect((await mockd.quiet(1_200)).filter((e) => e.n === 'pageview')).toHaveLength(1)

  await page.evaluate(() => window.jelto('pageview', { u: '/pricing' }))
  const events = await mockd.awaitEvents(3)

  const names = events.map((e) => e.n)
  expect(names.filter((n) => n === 'pageview')).toHaveLength(2)
  // The outgoing pageview's engagement is on the wire BEFORE the
  // pageview that replaces it.
  const engagement = names.indexOf('engagement')
  expect(engagement, 'an engagement for the first pv').toBeGreaterThan(-1)
  expect(engagement).toBeLessThan(names.lastIndexOf('pageview'))
  expect(events[engagement]!.pv).toBe(events[0]!.id)
})

test('T42 — a root-relative u is resolved and put on the wire absolute', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { autoPageview: 'off' } })
  await site.goto('/')

  await page.evaluate(() => window.jelto('pageview', { u: '/:masked/alfa' }))
  const events = await mockd.awaitEvents(1)
  expect(events.map((e) => e.u)).toEqual([SITE_ORIGIN + '/:masked/alfa'])
})

test('T43 — B2 is applied to a supplied path too', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { autoPageview: 'off', exclude: '/admin/**' } })
  await site.goto('/')

  await page.evaluate(() => window.jelto('pageview', { u: '/admin/x' }))
  expect(await mockd.quiet(1_500)).toHaveLength(0)
})

test('T44 — data-auto-pageview="off" suppresses only pageviews', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({
    attrs: { autoPageview: 'off' },
    body: '<button data-jelto-event="signup">go</button><a id="dl" href="/dl/App.pkg">dl</a>',
  })
  await site.goto('/')

  await page.click('button')
  await page.click('#dl')
  const events = await mockd.awaitEvents(2)
  expect(events.map((e) => e.n).sort()).toEqual(['click:download', 'signup'])
  expect(events.some((e) => e.n === 'pageview')).toBe(false)
})
