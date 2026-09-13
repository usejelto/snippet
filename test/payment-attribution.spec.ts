import { test, expect } from './fixtures'
import { lifecycle, spyOnStorage, storageCalls } from './harness/browser'
import { PRODUCT } from './harness/site'

const helper = '<script defer data-environment="test" src="https://cdn.jelto.example/jelto.checkout.js"></script>'
const endpoint = `https://cdn.jelto.example/api/v1/attribution/${PRODUCT}`

for (const [field, value] of [['session_id', 'cs_test_fixture'], ['order_id', '123'], ['checkout_id', '11111111-1111-4111-8111-111111111111']]) {
  test(`payment return ${field} retains the original channel and pageview in this tab`, async ({ page, site }) => {
    await lifecycle(page)
    await site.install()
    const requests: Record<string, unknown>[] = []
    await page.route(endpoint, async route => {
      requests.push(route.request().postDataJSON())
      expect(route.request().headers()['referer']).toBeUndefined()
      await route.fulfill({ status: 202, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'https://site.example' }, body: '{"status":"accepted"}' })
    })
    site.defaults({ head: helper })
    await site.goto('/?utm_source=launch&utm_medium=social')
    const original = await page.evaluate(() => (window as unknown as { jelto(c: string): { pageviewId: string } }).jelto('context').pageviewId)
    await site.goto(`/welcome?${field}=${value}`)
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0]).toEqual({ environment: 'test', [field!]: value, cohort: 'launch~social', pageview_id: original })
  })
}

test('pre-load payment survives both scripts and automatic opt-out', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  const requests: Record<string, unknown>[] = []
  await page.route(endpoint, async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: 202, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': 'https://site.example' }, body: '{"status":"accepted"}' })
  })
  site.defaults({ head: `<script>window.jelto = function() { (window.jelto.q = window.jelto.q || []).push(arguments) }; window.jelto('payment', { email: 'buyer@example.com', provider: 'stripe', environment: 'test' });</script>${helper.replace('data-environment', 'data-disable-payments="true" data-payment-memory="off" data-environment')}` })
  await spyOnStorage(page)
  await site.goto('/?utm_source=launch&session_id=cs_test_fixture')
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0]).toEqual({ email: 'buyer@example.com', provider: 'stripe', environment: 'test', cohort: 'launch' })
  expect(await storageCalls(page)).toEqual([])
})

test('provider return with no retained context does not invent acquisition', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  const requests: unknown[] = []
  await page.route(endpoint, async route => { requests.push(route.request()); await route.abort() })
  site.defaults({ head: helper })
  await site.goto('/welcome?session_id=cs_test_fixture')
  await page.evaluate(() => (window as unknown as { jelto: (c: string, p: unknown) => void }).jelto('payment', { email: 'buyer@example.com' }))
  expect(requests).toEqual([])
})

test('an internal navigation links its own pageview without manufacturing Direct', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  const requests: Record<string, unknown>[] = []
  await page.route(endpoint, async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: 202, headers: { 'Access-Control-Allow-Origin': 'https://site.example' }, body: '{}' })
  })
  site.defaults({ head: helper.replace('data-environment', 'data-payment-memory="off" data-environment') })
  await page.goto('https://site.example/checkout', { referer: 'https://site.example/pricing' })
  await mockd.awaitEvents(1)
  const context = await page.evaluate(() => {
    const host = window as unknown as { jelto(c: string, value?: unknown): { pageviewId: string }; jeltoCheckoutMetadata(): Record<string, string> }
    const value = host.jeltoCheckoutMetadata()
    host.jelto('payment', { email: 'buyer@example.com', environment: 'test' })
    return { value, pageview: host.jelto('context').pageviewId }
  })
  expect(context.value).toEqual({ jelto_pageview: context.pageview })
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0]?.pageview_id).toBe(context.pageview)
  expect(requests[0]).not.toHaveProperty('cohort')
})
