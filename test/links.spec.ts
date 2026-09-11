// spec/snippet.md §4 — the click cases.
// T5, T5b, T6, T7, T8, T9, T10, T11, T11b, T11c, T12, T21, T23, T24, T26.

import { test, expect } from './fixtures'
import { SITE_ORIGIN } from './harness/site'
import { lifecycle } from './harness/browser'

const DOWNLOAD = '<a id="dl" href="/dl/App.pkg">download</a>'

test('T5 — a download click sends click:download and appends the UTM cohort', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: DOWNLOAD })
  await site.goto('/download?utm_source=producthunt&utm_medium=social')
  await mockd.awaitEvents(1)

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#dl')])
  expect(page.url()).toBe(SITE_ORIGIN + '/dl/App.pkg?jl=producthunt~social')

  const click = (await mockd.awaitEvents(2)).find((e) => e.n === 'click:download')
  expect(click, 'a click:download event').toBeDefined()
  expect(click!.props).toEqual({ file: 'App.pkg' })
  expect(click!.u).toBe(SITE_ORIGIN + '/download?utm_source=producthunt&utm_medium=social')
})

test('T5b — ?ref= is the same precedence as utm_source', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: DOWNLOAD })
  await site.goto('/download?ref=producthunt')

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#dl')])
  expect(page.url()).toBe(SITE_ORIGIN + '/dl/App.pkg?jl=producthunt')
})

test('T6 — with no UTM, an external referrer becomes ref:<host>', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: DOWNLOAD })
  await site.goto('/download', { from: 'https://news.ycombinator.com/item?id=1' })

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#dl')])
  expect(page.url()).toBe(SITE_ORIGIN + '/dl/App.pkg?jl=ref:news.ycombinator.com')
})

test('T7 — an internal referrer adds no jl, and the download is still sent', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: DOWNLOAD })
  await site.goto('/download', { from: SITE_ORIGIN + '/features' })

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#dl')])
  expect(page.url()).toBe(SITE_ORIGIN + '/dl/App.pkg')

  const events = await mockd.awaitEvents(2)
  expect(events.some((e) => e.n === 'click:download')).toBe(true)
})

test('T8 — an href that already carries jl is left untouched', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<a id="dl" href="/dl/App.pkg?jl=custom">download</a>' })
  await site.goto('/download?utm_source=producthunt')

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#dl')])
  expect(page.url()).toBe(SITE_ORIGIN + '/dl/App.pkg?jl=custom')
})

test('a persistent download link recomputes its attribution and preserves page-authored changes', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: DOWNLOAD })
  await site.goto('/download?utm_source=first')
  const hrefs = await page.evaluate(() => {
    const link = document.getElementById('dl') as HTMLAnchorElement
    const click = () => {
      link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
      return link.href
    }
    const values = [click()]
    history.replaceState(null, '', '/download?utm_source=second')
    values.push(click())
    history.replaceState(null, '', '/download')
    values.push(click())
    link.href = '/dl/App.pkg?jl=customer'
    history.replaceState(null, '', '/download?utm_source=third')
    values.push(click(), click())
    return values
  })
  expect(hrefs).toEqual([
    SITE_ORIGIN + '/dl/App.pkg?jl=first',
    SITE_ORIGIN + '/dl/App.pkg?jl=second',
    SITE_ORIGIN + '/dl/App.pkg',
    SITE_ORIGIN + '/dl/App.pkg?jl=customer',
    SITE_ORIGIN + '/dl/App.pkg?jl=customer',
  ])
})

test('T9 — a GitHub release asset is a download, not an outbound click', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<a id="dl" href="https://github.com/x/y/releases/download/v1/App.dmg">download</a>' })
  await site.goto('/download?utm_source=producthunt')

  await Promise.all([page.waitForURL(/github\.com/), page.click('#dl')])
  expect(page.url()).toBe('https://github.com/x/y/releases/download/v1/App.dmg?jl=producthunt')

  const events = await mockd.awaitEvents(2)
  const click = events.find((e) => e.n === 'click:download' || e.n === 'click:outbound')
  expect(click!.n).toBe('click:download')
  expect(click!.props).toEqual({ file: 'App.dmg' })
})

test('T10 — a download attribute makes any href a download', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<a id="dl" href="/x" download>get</a>' })
  await site.goto('/')

  await page.click('#dl')
  const click = (await mockd.awaitEvents(2)).find((e) => e.n === 'click:download')
  expect(click, 'a click:download event').toBeDefined()
  expect(click!.props).toEqual({ file: 'x' })
})

test('T11 — a modifier click, a middle click and target=_blank are never intercepted', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await site.install()
  site.defaults({
    body:
      '<a id="meta" href="/dl/A.pkg">a</a>' +
      '<a id="aux" href="/dl/B.pkg">b</a>' +
      '<a id="blank" href="/dl/C.pkg" target="_blank">c</a>',
  })
  await site.goto('/download?utm_source=producthunt')
  await mockd.awaitEvents(1)

  // The new-tab modifier is Meta on macOS and Control on Linux/Windows.
  await page.click('#meta', { modifiers: ['ControlOrMeta'] })
  await page.click('#aux', { button: 'middle' })
  await page.click('#blank')

  // The page itself never navigated: none of the three was intercepted.
  expect(page.url()).toBe(SITE_ORIGIN + '/download?utm_source=producthunt')

  const hrefs = await page.evaluate(() =>
    ['meta', 'aux', 'blank'].map((id) => (document.getElementById(id) as HTMLAnchorElement).href),
  )
  expect(hrefs).toEqual([
    SITE_ORIGIN + '/dl/A.pkg?jl=producthunt',
    SITE_ORIGIN + '/dl/B.pkg?jl=producthunt',
    SITE_ORIGIN + '/dl/C.pkg?jl=producthunt',
  ])

  const events = await mockd.awaitEvents(4)
  const files = events.filter((e) => e.n === 'click:download').map((e) => e.props?.file)
  expect(files.sort()).toEqual(['A.pkg', 'B.pkg', 'C.pkg'])
})

test('T11b — a handler that preventDefaults before the snippet suppresses both the event and the rewrite', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await site.install()
  // An inline script in <head> runs at parse time; the snippet is `defer`, so
  // this listener is registered first, and a `window` capture listener runs
  // ahead of the snippet's `document` capture listener (B13).
  site.defaults({
    head: '<script>window.addEventListener("click", function (e) { e.preventDefault() }, true)</script>',
    body: DOWNLOAD,
  })
  await site.goto('/download?utm_source=producthunt')
  await mockd.awaitEvents(1)

  await page.click('#dl')
  const events = await mockd.quiet(1_500)
  expect(events.filter((e) => e.n === 'click:download')).toHaveLength(0)
  expect(await page.evaluate(() => (document.getElementById('dl') as HTMLAnchorElement).getAttribute('href'))).toBe(
    '/dl/App.pkg',
  )
})

test('T11c — a click on a span inside the anchor is handled by the parent walk', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<a id="dl" href="/dl/App.pkg"><span id="inner">download</span></a>' })
  await site.goto('/')

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#inner')])
  const click = (await mockd.awaitEvents(2)).find((e) => e.n === 'click:download')
  expect(click!.props).toEqual({ file: 'App.pkg' })
})

test('T12 — a link to another host is click:outbound with the hostname only', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<a id="out" href="https://twitter.com/jelto/status/1">t</a>' })
  await site.goto('/')

  await Promise.all([page.waitForURL(/twitter\.com/), page.click('#out')])
  const click = (await mockd.awaitEvents(2)).find((e) => e.n === 'click:outbound')
  expect(click, 'a click:outbound event').toBeDefined()
  expect(click!.props).toEqual({ url: 'twitter.com' })
})

test('T21 — a link added after load via innerHTML is still handled (delegation)', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<div id="host"></div>' })
  await site.goto('/')
  await mockd.awaitEvents(1)

  await page.evaluate(() => {
    document.getElementById('host')!.innerHTML = '<a id="dl" href="/dl/Late.pkg">late</a>'
  })
  await Promise.all([page.waitForURL(/\/dl\/Late\.pkg/), page.click('#dl')])

  const click = (await mockd.awaitEvents(2)).find((e) => e.n === 'click:download')
  expect(click!.props).toEqual({ file: 'Late.pkg' })
})

test('T23 — data-jelto-event and its props', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<button data-jelto-event="signup" data-jelto-event-plan="pro">go</button>' })
  await site.goto('/')

  await page.click('button')
  const signup = (await mockd.awaitEvents(2)).find((e) => e.n === 'signup')
  expect(signup, 'a signup event').toBeDefined()
  expect(signup!.props).toEqual({ plan: 'pro' })
  expect(signup!.s).toBe('web')
  expect(signup!.u).toBe(SITE_ORIGIN + '/')
})

test('T24 — a same-tab tagged link sends before navigating, within 300 ms', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<a id="cta" href="/thanks" data-jelto-event="cta">go</a>' })
  await site.goto('/')
  await mockd.awaitEvents(1)

  const started = Date.now()
  await Promise.all([page.waitForURL(SITE_ORIGIN + '/thanks'), page.click('#cta')])
  const elapsed = Date.now() - started

  const events = await mockd.awaitEvents(2)
  expect(events.some((e) => e.n === 'cta')).toBe(true)
  expect(elapsed, 'navigation delayed by at most 300 ms').toBeLessThan(1_200)
})

test('T26 — data-file-types="pkg": .zip is not a download and .pkg is', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({
    attrs: { fileTypes: 'pkg' },
    body: '<a id="zip" href="/dl/App.zip">z</a><a id="pkg" href="/dl/App.pkg">p</a>',
  })
  await site.goto('/')
  await mockd.awaitEvents(1)

  await page.evaluate(() => document.getElementById('zip')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect((await mockd.quiet(1_200)).filter((e) => e.n.startsWith('click:'))).toHaveLength(0)

  await Promise.all([page.waitForURL(/\/dl\/App\.pkg/), page.click('#pkg')])
  const events = await mockd.awaitEvents(2)
  expect(events.filter((e) => e.n === 'click:download').map((e) => e.props?.file)).toEqual(['App.pkg'])
})
