import { test, expect, validateAgainstSchema } from './fixtures'
import { CDN, CDN_COOKIE } from './harness/site'
import { lifecycle, spyOnStorage, storageCalls } from './harness/browser'

const helpers = '<script defer src="https://cdn.jelto.example/jelto.goals.js"></script><script defer data-payment-memory="off" src="https://cdn.jelto.example/jelto.checkout.js"></script>'

for (const bundle of [CDN, CDN_COOKIE]) {
  test(`URL-only ignore suppresses tracking and storage in ${bundle}`, async ({ page, site, mockd }) => {
    await lifecycle(page)
    await spyOnStorage(page)
    await site.install()
    site.bundle = bundle
    site.defaults({ attrs: { memory: 'on' }, head: helpers, body: '<button data-jelto-event="signup" data-jelto-visible="pricing:seen">signup</button>' })
    await site.goto('/?jelto_ignore=1&utm_source=newsletter')
    await page.click('button')
    expect(await mockd.quiet(1200)).toHaveLength(0)
    expect(await storageCalls(page)).toEqual([])
    // The query flag is document-scoped, not a persistent browser preference.
    await site.goto('/?utm_source=newsletter')
    expect((await mockd.awaitEvents(1)).some(event => event.n === 'pageview')).toBe(true)
  })
}

test('visibility goals observe dynamic elements once and never scrape text', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.defaults({ head: helpers, body: '<div id="goal" data-jelto-visible="pricing:seen">private page text</div><div data-jelto-visible="invalid name">ignored</div>' })
  await site.goto('/')
  await mockd.awaitEvents(2)
  await page.evaluate(() => {
    const goal = document.getElementById('goal')!
    goal.remove()
    document.body.append(goal)
    const late = document.createElement('div')
    late.setAttribute('data-jelto-visible', 'checkout.seen')
    late.textContent = 'another private value'
    document.body.append(late)
  })
  const events = await mockd.awaitEvents(3)
  expect(events.filter(event => event.n === 'pricing:seen')).toHaveLength(1)
  expect(events.filter(event => event.n === 'checkout.seen')).toHaveLength(1)
  expect(events.some(event => event.n === 'invalid name')).toBe(false)
  for (const event of events.filter(event => event.n.endsWith('seen'))) {
    expect(event.props ?? {}).toEqual({})
    expect(event.i).toBe(false)
  }
  expect(await storageCalls(page)).toEqual([])
  validateAgainstSchema(await mockd.bodies())
})

test('checkout helper forwards cohort metadata to the three providers and preserves application references', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.defaults({ head: helpers, body: `
    <a id="stripe" data-jelto-checkout="stripe" href="https://buy.stripe.com/example">pay</a>
    <a id="existing" data-jelto-checkout="stripe" href="https://buy.stripe.com/example?client_reference_id=order_123">pay</a>
    <a id="lemon" data-jelto-checkout="lemonsqueezy" href="https://shop.lemonsqueezy.com/buy/example?checkout%5Bcustom%5D%5Border%5D=123">pay</a>
    <a id="polar" data-jelto-checkout="polar" href='https://polar.sh/checkout/example?metadata=%7B%22order%22%3A%22123%22%7D'>pay</a>
    <a id="untrusted" data-jelto-checkout="stripe" href="https://buy.stripe.com.evil.example/pay">pay</a>
    <a id="plain" href="https://buy.stripe.com/example">pay</a>` })
  await site.goto('/?utm_source=newsletter&utm_medium=email')
  await mockd.awaitEvents(1)
  const hrefs = await page.evaluate(() => {
    document.addEventListener('click', event => event.preventDefault())
    return ['stripe', 'existing', 'lemon', 'polar', 'untrusted', 'plain'].map(id => {
      const link = document.getElementById(id) as HTMLAnchorElement
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return link.href
    })
  })
  const stripeReference = new URL(hrefs[0]!).searchParams.get('client_reference_id')!
  expect(stripeReference).toMatch(/^jl1_/)
  expect(Buffer.from(stripeReference.slice(4), 'base64url').toString()).toBe('newsletter~email')
  expect(new URL(hrefs[1]!).searchParams.get('client_reference_id')).toBe('order_123')
  expect(new URL(hrefs[2]!).searchParams.get('checkout[custom][jelto_cohort]')).toBe('newsletter~email')
  expect(new URL(hrefs[2]!).searchParams.get('checkout[custom][order]')).toBe('123')
  expect(JSON.parse(new URL(hrefs[3]!).searchParams.get('metadata')!)).toEqual({ order: '123', jelto_cohort: 'newsletter~email' })
  expect(new URL(hrefs[4]!).search).toBe('')
  expect(new URL(hrefs[5]!).search).toBe('')
  expect(await storageCalls(page)).toEqual([])
})
