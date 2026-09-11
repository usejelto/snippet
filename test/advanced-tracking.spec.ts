import { test, expect, validateAgainstSchema } from './fixtures'
import { CDN, CDN_COOKIE, SITE_ORIGIN } from './harness/site'
import { hide, lifecycle, show, spyOnStorage, storageCalls } from './harness/browser'

const helper = '<script defer src="https://cdn.jelto.example/jelto.goals.js"></script>'
const goal = '<section id="goal" data-jelto-visible="pricing:seen" style="height:100px">private page text</section>'

for (const bundle of [CDN, CDN_COOKIE]) {
  test(`invalid explicit endpoint disables all initialization in ${bundle}`, async ({ page, site, mockd }) => {
    await lifecycle(page)
    await spyOnStorage(page)
    await page.addInitScript(() => {
      const counters = { intersection: 0, mutation: 0 }
      ;(window as unknown as { __observers: typeof counters }).__observers = counters
      const Intersection = window.IntersectionObserver
      window.IntersectionObserver = class extends Intersection {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { super(callback, options); counters.intersection++ }
      }
      const Mutation = window.MutationObserver
      window.MutationObserver = class extends Mutation {
        constructor(callback: MutationCallback) { super(callback); counters.mutation++ }
      }
    })
    await site.install()
    site.bundle = bundle
    for (const endpoint of ['', 'http://[', 'javascript:alert(1)', 'https://user:pass@track.example/e', '/e#fragment']) {
      site.defaults({ attrs: { endpoint, memory: 'on' }, head: helper, body: goal })
      await site.goto('/')
      expect(await page.evaluate(() => typeof window.jelto)).toBe('undefined')
      expect(await page.evaluate(() => (window as unknown as { __observers: unknown }).__observers)).toEqual({ intersection: 0, mutation: 0 })
      expect(await storageCalls(page)).toEqual([])
    }
    expect(await mockd.quiet(200)).toEqual([])
  })
}

test('relative endpoint is resolved against the page and context is only a pageview identity', async ({ page, site }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  const bodies: string[] = []
  await page.route(`${SITE_ORIGIN}/custom-events`, async route => {
    bodies.push(route.request().postData()!)
    await route.fulfill({ status: 202, body: '{}' })
  })
  site.defaults({ attrs: { endpoint: '../custom-events' } })
  await site.goto('/nested/page')
  await expect.poll(() => bodies.length).toBe(1)
  const first = JSON.parse(bodies[0]!).e[0]
  expect(await page.evaluate(() => window.jelto('context'))).toEqual({ active: true, pageviewId: first.id, url: `${SITE_ORIGIN}/nested/page` })
  expect(await storageCalls(page)).toEqual([])
  validateAgainstSchema(bodies)
})

test('visibility delay cancels on hiding and helper duplication cannot duplicate delivery', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ head: helper + helper, body: goal.replace('style=', 'data-jelto-visible-threshold="0.8" data-jelto-visible-delay="600" style=') })
  await site.goto('/')
  await page.waitForTimeout(150)
  await hide(page)
  await page.waitForTimeout(700)
  expect((await mockd.events()).filter(event => event.n === 'pricing:seen')).toHaveLength(0)
  await show(page)
  await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pricing:seen').length).toBe(1)
  await hide(page); await show(page)
  await page.waitForTimeout(700)
  const events = (await mockd.events()).filter(event => event.n === 'pricing:seen')
  expect(events).toHaveLength(1)
  expect(events[0]!.i).toBe(false)
  expect(events[0]!.props).toBeUndefined()
  validateAgainstSchema(await mockd.bodies())
})

test('zero visibility threshold observes entry from an adjacent edge and cancels dwell on leaving it', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ head: helper, body: goal.replace('style="height:100px"', 'data-jelto-visible-threshold="0" data-jelto-visible-delay="600" style="position:fixed;top:100vh;left:0;height:100px;width:100px"') })
  await site.goto('/')
  // At this boundary native IntersectionObserver reports isIntersecting=true
  // with ratio=0. A threshold of exactly zero emits no later crossing when the
  // target moves further in, so rejecting that first record alone loses it.
  await page.waitForTimeout(700)
  expect((await mockd.events()).filter(event => event.n === 'pricing:seen')).toHaveLength(0)
  await page.locator('#goal').evaluate(element => { (element as HTMLElement).style.top = 'calc(100vh - 1px)' })
  await page.waitForTimeout(200)
  await page.locator('#goal').evaluate(element => { (element as HTMLElement).style.top = '100vh' })
  await page.waitForTimeout(1200)
  expect((await mockd.events()).filter(event => event.n === 'pricing:seen')).toHaveLength(0)
  await page.locator('#goal').evaluate(element => { (element as HTMLElement).style.top = 'calc(100vh - 1px)' })
  await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pricing:seen').length).toBe(1)
  expect((await mockd.events()).find(event => event.n === 'pricing:seen')!.i).toBe(false)
  validateAgainstSchema(await mockd.bodies())
})

for (const navigation of ['spa', 'hash', 'manual'] as const) {
  test(`visibility resets for an accepted ${navigation} pageview`, async ({ page, site, mockd }) => {
    await lifecycle(page)
    await site.install()
    site.defaults({ attrs: navigation === 'hash' ? { hash: true } : navigation === 'manual' ? { autoPageview: 'off' } : {}, head: helper, body: goal })
    await site.goto('/')
    if (navigation === 'manual') await page.evaluate(() => window.jelto('pageview'))
    await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pricing:seen').length).toBe(1)
    await page.evaluate(kind => {
      if (kind === 'hash') location.hash = '/pricing'
      else if (kind === 'manual') window.jelto('pageview')
      else history.pushState({}, '', '/pricing')
    }, navigation)
    await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pricing:seen').length).toBe(2)
    const pageviews = (await mockd.events()).filter(event => event.n === 'pageview')
    expect(pageviews).toHaveLength(2)
    expect(pageviews[0]!.id).not.toBe(pageviews[1]!.id)
    validateAgainstSchema(await mockd.bodies())
  })
}

test('excluded SPA suspends visibility and ends previous engagement before resuming', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { exclude: '/admin/**' }, head: helper, body: goal })
  await site.goto('/')
  await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pricing:seen').length).toBe(1)
  await page.evaluate(() => history.pushState({}, '', '/admin/private'))
  expect(await page.evaluate(() => (window.jelto('context') as { active: boolean }).active)).toBe(false)
  await page.waitForTimeout(1200)
  const excluded = await mockd.events()
  expect(excluded.filter(event => event.n === 'pageview')).toHaveLength(1)
  expect(excluded.filter(event => event.n === 'engagement')).toHaveLength(1)
  await page.evaluate(() => history.pushState({}, '', '/pricing'))
  await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pricing:seen').length).toBe(2)
})
