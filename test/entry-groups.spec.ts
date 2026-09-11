import { test, expect } from './fixtures'
import { PRODUCT } from './harness/site'
import { lifecycle, spyOnStorage, storageCalls } from './harness/browser'

const groups = JSON.stringify([
  { id: 'pricing', host: 'site.example', paths: ['/pricing/**'] },
  { id: 'broad', host: 'site.example', paths: ['/**'] },
  { id: 'other_host', host: 'other.example', paths: ['/**'] },
])
const entry = `<script defer data-product="${PRODUCT}" src="https://cdn.jelto.example/jelto.entry.js"></script>`
const checkout = `<script defer data-environment="test" data-entry-pages='${groups}' src="https://cdn.jelto.example/jelto.checkout.js"></script>`
const endpoint = `https://cdn.jelto.example/api/v1/attribution/${PRODUCT}`
const metadata = () => (window as unknown as { jeltoCheckoutMetadata: () => Record<string, string> }).jeltoCheckoutMetadata()

test('entry groups choose configured order and retain only an id and timestamp across checkout return', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  const requests: Record<string, unknown>[] = []
  await page.route(endpoint, async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: 202, headers: { 'Access-Control-Allow-Origin': 'https://site.example' }, body: '{}' })
  })
  site.defaults({ head: entry + checkout })
  await site.goto('/pricing/private-customer?utm_source=launch')
  expect(await page.evaluate(metadata)).toEqual({ jelto_cohort: 'launch', jelto_entry_page: 'pricing' })
  const stored = await page.evaluate(product => JSON.parse(sessionStorage.getItem('jelto_entry_' + product)!), PRODUCT)
  expect(Object.keys(stored).sort()).toEqual(['at', 'id'])
  expect(stored.id).toBe('pricing')
  expect(JSON.stringify(stored)).not.toContain('private-customer')
  await site.goto('/thanks?session_id=cs_test_fixture')
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0]).toEqual({ environment: 'test', session_id: 'cs_test_fixture', cohort: 'launch', entry_page: 'pricing' })
})

test('entry memory off is storage-free and observes only the current document', async ({ page, site }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.defaults({ head: entry + checkout.replace('data-environment', 'data-payment-memory="off" data-environment') })
  await site.goto('/pricing/start')
  expect(await page.evaluate(metadata)).toEqual({ jelto_entry_page: 'pricing' })
  await site.goto('/other')
  expect(await page.evaluate(metadata)).toEqual({ jelto_entry_page: 'broad' })
  expect(await storageCalls(page)).toEqual([])
})

test('expired or removed entry groups cannot be replayed as configured attribution', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ head: entry + checkout })
  await site.goto('/pricing/start')
  await page.evaluate(product => sessionStorage.setItem('jelto_entry_' + product, JSON.stringify({ id: 'pricing', at: Date.now() - 1800001 })), PRODUCT)
  await site.goto('/other')
  expect((await page.evaluate(metadata)).jelto_entry_page).toBe('broad')
  await page.evaluate(product => sessionStorage.setItem('jelto_entry_' + product, JSON.stringify({ id: 'removed_group', at: Date.now() })), PRODUCT)
  await site.goto('/pricing/start')
  expect((await page.evaluate(metadata)).jelto_entry_page).toBe('pricing')
})

test('entry capture follows eligible SPA pageviews and ignores excluded paths', async ({ page, site }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  const narrow = JSON.stringify([{ id: 'pricing', host: 'site.example', paths: ['/pricing/**'] }])
  site.defaults({ attrs: { exclude: '/private/**' }, head: entry + checkout.replace(groups, narrow).replace('data-environment', 'data-payment-memory="off" data-environment') })
  await site.goto('/start')
  expect(await page.evaluate(metadata)).toEqual({})
  await page.evaluate(() => history.pushState({}, '', '/pricing/plans'))
  await page.waitForTimeout(350)
  await page.evaluate(() => history.pushState({}, '', '/other'))
  await page.waitForTimeout(350)
  expect((await page.evaluate(metadata)).jelto_entry_page).toBe('pricing')
  await page.evaluate(() => history.pushState({}, '', '/private/account'))
  await page.waitForTimeout(350)
  expect(await page.evaluate(metadata)).toEqual({})
  expect(await storageCalls(page)).toEqual([])
})

test('entry-only metadata reaches Lemon Squeezy and Polar without inventing Stripe references', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ head: entry + checkout, body: `
    <a id="lemon" data-jelto-checkout="lemonsqueezy" href="https://shop.lemonsqueezy.com/buy/x">pay</a>
    <a id="polar" data-jelto-checkout="polar" href="https://polar.sh/checkout/x">pay</a>
    <a id="stripe" data-jelto-checkout="stripe" href="https://buy.stripe.com/x">pay</a>` })
  await site.goto('/pricing/start')
  const hrefs = await page.evaluate(() => {
    document.addEventListener('click', event => event.preventDefault())
    return ['lemon', 'polar', 'stripe'].map(id => {
      const link = document.getElementById(id) as HTMLAnchorElement
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return link.href
    })
  })
  expect(new URL(hrefs[0]!).searchParams.get('checkout[custom][jelto_entry_page]')).toBe('pricing')
  expect(JSON.parse(new URL(hrefs[1]!).searchParams.get('metadata')!)).toEqual({ jelto_entry_page: 'pricing' })
  expect(new URL(hrefs[2]!).searchParams.has('client_reference_id')).toBe(false)
})

test('unmatched hosts and excluded initialization cannot create entry memory', async ({ page, site }) => {
  await lifecycle(page)
  await spyOnStorage(page)
  await site.install()
  site.defaults({ head: entry + checkout })
  await site.goto('https://unregistered.example/pricing/start')
  expect(await page.evaluate(metadata)).toEqual({})
  expect(await page.evaluate(product => sessionStorage.getItem('jelto_entry_' + product), PRODUCT)).toBeNull()
  await site.goto('/pricing/start?jelto_ignore=1')
  expect(await storageCalls(page)).toEqual([])
})
