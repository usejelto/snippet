// Attribution memory and the storage-free promise when memory is disabled.
// T27, T28, T29, T30, T31, T32.

import { test, expect } from './fixtures'
import { SITE_ORIGIN } from './harness/site'
import { lifecycle, spyOnStorage, storageCalls } from './harness/browser'

/** Seeds the attribution-memory entry before the snippet runs. */
async function seed(page: import('@playwright/test').Page, value: string): Promise<void> {
  await page.addInitScript((v: string) => {
    try {
      localStorage.setItem('jelto_first', v)
    } catch {
      /* the T32 arm installs a throwing localStorage; seeding is not its subject */
    }
  }, value)
}

test('T27 — with data-memory absent, no storage API is touched at all', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.defaults({ body: '<a id="dl" href="/dl/App.pkg">d</a>' })
  await site.goto('/?utm_source=producthunt')
  await mockd.awaitEvents(1)
  await page.evaluate(() => document.getElementById('dl')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })))
  await mockd.awaitEvents(2)

  expect(await storageCalls(page)).toEqual([])
})

test('T28 — first touch is stored, then carried as f/fd and as jl=…&jt=first', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await page.clock.setFixedTime(new Date('2026-08-01T10:00:00Z'))
  await site.install()
  site.defaults({ attrs: { memory: 'on' }, body: '<a id="dl" href="/dl/App.pkg">d</a>' })

  await site.goto('/?utm_source=producthunt')
  await mockd.awaitEvents(1)
  expect(await page.evaluate(() => localStorage.getItem('jelto_first'))).toBe('producthunt|2026-08-01')

  await page.clock.setFixedTime(new Date('2026-08-02T10:00:00Z'))
  await site.goto('/pricing')
  // Three, not two: leaving the first page ends its pageview, so its engagement
  // is on the wire between the two pageviews.
  const events = await mockd.awaitEvents(3)
  const pricing = events.find((e) => e.n === 'pageview' && e.u === SITE_ORIGIN + '/pricing')!
  expect(pricing.f).toBe('producthunt')
  expect(pricing.fd).toBe('2026-08-01')

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#dl')])
  expect(page.url()).toBe(SITE_ORIGIN + '/dl/App.pkg?jl=producthunt&jt=first')
})

test('T29 — an entry 31 days old is deleted, sends no f, and is replaced by this page\'s source', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await page.clock.setFixedTime(new Date('2026-09-01T10:00:00Z'))
  await seed(page, 'producthunt|2026-08-01')
  await site.install()
  site.defaults({ attrs: { memory: 'on' } })
  await site.goto('/?utm_source=google')

  const events = await mockd.awaitEvents(1)
  expect(events[0]).not.toHaveProperty('f')
  expect(await page.evaluate(() => localStorage.getItem('jelto_first'))).toBe('google|2026-09-01')
})

test('T30 — no source and no referrer stores nothing and sends no f', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { memory: 'on' } })
  await site.goto('/')

  const events = await mockd.awaitEvents(1)
  expect(events[0]).not.toHaveProperty('f')
  expect(await page.evaluate(() => localStorage.getItem('jelto_first'))).toBeNull()
})

test('T31 — a valid entry is never overwritten; the page\'s own source still reaches u', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await page.clock.setFixedTime(new Date('2026-08-05T10:00:00Z'))
  await seed(page, 'producthunt|2026-08-01')
  await site.install()
  site.defaults({ attrs: { memory: 'on' } })
  await site.goto('/?utm_source=google')

  const events = await mockd.awaitEvents(1)
  expect(await page.evaluate(() => localStorage.getItem('jelto_first'))).toBe('producthunt|2026-08-01')
  expect(events[0]!.f).toBe('producthunt')
  expect(events[0]!.fd).toBe('2026-08-01')
  expect(events[0]!.u).toBe(SITE_ORIGIN + '/?utm_source=google')
})

test('T32 — a localStorage that throws behaves as memory off, with no error', async ({ page, site, mockd }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await lifecycle(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
      configurable: true,
    })
  })
  await site.install()
  site.defaults({ attrs: { memory: 'on' }, body: '<a id="dl" href="/dl/App.pkg">d</a>' })
  await site.goto('/?utm_source=producthunt')

  const events = await mockd.awaitEvents(1)
  expect(events[0]!.n).toBe('pageview')
  expect(events[0]).not.toHaveProperty('f')
  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#dl')])
  // Last touch still works: only the memory branch is unavailable.
  expect(page.url()).toBe(SITE_ORIGIN + '/dl/App.pkg?jl=producthunt')
  expect(errors).toEqual([])
})
