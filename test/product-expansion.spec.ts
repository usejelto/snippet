import { test, expect, validateAgainstSchema } from './fixtures'
import { PRODUCT, CDN_COOKIE } from './harness/site'
import { lifecycle, spyOnStorage, storageCalls } from './harness/browser'

const goals = '<script defer src="https://cdn.jelto.example/jelto.goals.js"></script>'
const relay = `<script defer data-product="${PRODUCT}" data-domains="site.example,shop.example" src="https://cdn.jelto.example/jelto.crossdomain.js"></script>`

test('tagged forms submit once after validation and never collect field contents', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.defaults({ head: goals + goals, body: `<form data-jelto-event="signup" data-jelto-event-plan="pro" onsubmit="event.preventDefault()">
    <input name="email" type="email" required><input name="password" type="password" value="sensitive-value">
    <button data-jelto-event="signup">Join</button></form>` })
  await site.goto('/')
  await mockd.awaitEvents(1)
  await page.click('button')
  expect((await mockd.quiet(1100)).filter(event => event.n === 'signup')).toHaveLength(0)
  await page.fill('[name=email]', 'private@example.com')
  await page.click('button')
  const events = await mockd.awaitEvents(2)
  expect(events.filter(event => event.n === 'signup')).toHaveLength(1)
  expect(events.find(event => event.n === 'signup')!.props).toEqual({ plan: 'pro' })
  expect(JSON.stringify(await mockd.bodies())).not.toContain('private@example.com')
  expect(JSON.stringify(await mockd.bodies())).not.toContain('sensitive-value')
  expect(await storageCalls(page)).toEqual([])
  validateAgainstSchema(await mockd.bodies())
})

test('dynamically inserted forms respect excluded SPA navigation', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { exclude: '/private/**' }, head: goals })
  await site.goto('/')
  await mockd.awaitEvents(1)
  await page.evaluate(() => {
    const form = document.createElement('form')
    form.dataset.jeltoEvent = 'signup'
    form.addEventListener('submit', event => event.preventDefault())
    document.body.append(form)
    form.requestSubmit()
  })
  await mockd.awaitEvents(2)
  await page.evaluate(() => history.pushState({}, '', '/private/account'))
  await page.waitForTimeout(350)
  await page.evaluate(() => document.querySelector('form')!.requestSubmit())
  expect((await mockd.quiet(1100)).filter(event => event.n === 'signup')).toHaveLength(1)
})

test('cross-domain links preserve only the cohort and destination first-page attribution', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.defaults({ before: relay, body: '<a id="next" href="https://shop.example/pricing?view=plans#buy">Next</a>' })
  await site.goto('/?utm_source=launch&utm_medium=email')
  await mockd.awaitEvents(1)
  await Promise.all([page.waitForURL(/shop.example/), page.click('#next')])
  expect(new URL(page.url()).searchParams.get('jl')).toBe('launch~email')
  expect(new URL(page.url()).searchParams.get('view')).toBe('plans')
  expect(new URL(page.url()).hash).toBe('#buy')
  expect(await page.evaluate(() => window.jelto('attribution'))).toEqual({ cohort: 'launch~email', first: false })
  await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pageview').length).toBe(2)
  const events = await mockd.events()
  expect(events.filter(event => event.n === 'pageview').at(-1)!.u).toContain('jl=launch%7Eemail')
  expect(await storageCalls(page)).toEqual([])
  expect(page.url()).not.toMatch(/(?:vid|sid|install|visitor|session)=/)
  validateAgainstSchema(await mockd.bodies())
})

test('cross-domain relay preserves first-touch labels while cookies remain host-only', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.bundle = CDN_COOKIE
  site.defaults({ attrs: { memory: 'on' }, before: relay, body: '<a href="https://shop.example/">Next</a>' })
  await site.goto('/?utm_source=launch')
  await mockd.awaitEvents(1)
  await Promise.all([page.waitForURL(/shop.example/), page.click('a')])
  expect(new URL(page.url()).searchParams.get('jt')).toBe('first')
  expect(await page.evaluate(() => window.jelto('attribution'))).toEqual({ cohort: 'launch', first: true })
  await expect.poll(async () => (await mockd.events()).filter(event => event.n === 'pageview').length).toBe(2)
  const views = (await mockd.events()).filter(event => event.n === 'pageview')
  expect(views[0]!.vid).not.toBe(views[1]!.vid)
  const cookies = (await page.context().cookies()).filter(cookie => cookie.name === 'jelto_vid')
  expect(cookies.map(cookie => cookie.domain).sort()).toEqual(['shop.example', 'site.example'])
})

test('relay respects explicit destination attribution, host allowlist and prevented clicks', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ before: relay, body: `
    <a id="outside" href="https://outside.example/">outside</a>
    <a id="explicit" href="https://shop.example/?utm_source=other">explicit</a>
    <a id="credentials" href="https://user:password@shop.example/">credentials</a>
    <a id="prevented" href="https://shop.example/">prevented</a>` })
  await site.goto('/?utm_source=launch')
  const values = await page.evaluate(() => {
    document.addEventListener('click', event => event.preventDefault())
    return ['outside', 'explicit', 'credentials', 'prevented'].map(id => {
      const element = document.getElementById(id) as HTMLAnchorElement
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      if (id === 'prevented') event.preventDefault()
      element.dispatchEvent(event)
      return element.href
    })
  })
  for (const value of values) expect(new URL(value).searchParams.has('jl')).toBe(false)
})

test('incoming labels require enabled helper, registered source and valid grammar', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  for (const [before, source, query] of [
    ['', 'https://site.example/', 'jl=launch'],
    [relay, 'https://outside.example/', 'jl=launch'],
    [relay, 'https://site.example/', 'jl=https%3A%2F%2Fprivate.example%2Fuser'],
    [relay, 'https://site.example/', 'jl=one&jl=two'],
    [relay, 'https://site.example/', 'jl=launch&jelto_ignore=1'],
  ]) {
    site.defaults({ before })
    await site.goto(`https://shop.example/?${query}`, { from: source })
    expect(await page.evaluate(() => typeof window.jelto === 'function' ? window.jelto('cohort') : undefined)).not.toBe('launch')
  }
})
