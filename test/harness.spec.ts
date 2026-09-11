import { test, expect } from './fixtures'

test('harness: the page is served, the bundle loads, and the endpoint is reachable', async ({ page, site, mockd }) => {
  await site.install()
  site.defaults({ body: '<p>hi</p>' })
  await site.goto('/')
  expect(await page.evaluate(() => location.href)).toBe('https://site.example/')
  expect(await page.evaluate(() => navigator.webdriver)).toBe(false)
  const status = await page.evaluate(async (ep) => {
    const r = await fetch(ep, {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({
        v: 1,
        p: 'prd_8f3kq2m9x1',
        e: [{ n: 'pageview', s: 'web', u: location.href, id: crypto.randomUUID() }],
      }),
    })
    return r.status
  }, mockd.endpoint)
  expect(status).toBe(202)
  const events = await mockd.awaitEvents(1)
  expect(events.map((e) => e.n)).toEqual(['pageview'])
})

test('harness: a real cross-origin referrer', async ({ page, site }) => {
  await site.install()
  site.defaults({})
  await site.goto('/x', { from: 'https://news.ycombinator.com/item?id=1' })
  expect(await page.evaluate(() => document.referrer)).toBe('https://news.ycombinator.com/')
})

test('harness: a same-origin referrer is the whole URL', async ({ page, site }) => {
  await site.install()
  site.defaults({})
  await site.goto('/pricing', { from: 'https://site.example/features' })
  expect(await page.evaluate(() => document.referrer)).toBe('https://site.example/features')
})

test('harness: page.clock fakes performance.now, which B16 accumulates from', async ({ page, site }) => {
  await page.clock.install()
  await site.install()
  site.defaults({})
  await site.goto('/')
  const before = await page.evaluate(() => performance.now())
  await page.clock.runFor(30_000)
  const after = await page.evaluate(() => performance.now())
  expect(after - before).toBeGreaterThan(25_000)
})
