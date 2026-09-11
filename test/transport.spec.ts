// The transport, queue-stub, budget and schema cases.
// T13, T13b, T16, T17, T18, T19, T20, T22, T25.

import { test, expect, validateAgainstSchema } from './fixtures'
import { SITE_ORIGIN } from './harness/site'
import { lifecycle, hide } from './harness/browser'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// The pre-load queue stub, verbatim. It ships in the PAGE's own bundle and never inline --
// the CSP-safety rule carries neither 'unsafe-inline' nor a nonce.
const STUB = `window.jelto = window.jelto || function () { (window.jelto.q = window.jelto.q || []).push(arguments) }`

test('T13 — a call buffered by §1\'s stub is drained once after load', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.asset('/app.js', STUB + `\nwindow.jelto('event', 'signup', { plan: 'pro' })\nwindow.__queued = window.jelto.q.length`)
  site.defaults({ head: '<script src="/app.js"></script>' })
  await site.goto('/')

  expect(await page.evaluate(() => (window as unknown as { __queued: number }).__queued)).toBe(1)

  const events = await mockd.awaitEvents(2)
  const signups = events.filter((e) => e.n === 'signup')
  expect(signups).toHaveLength(1)
  expect(signups[0]!.props).toEqual({ plan: 'pro' })
  // Draining empties the queue, so a stub loaded twice does not re-send.
  expect(await page.evaluate(() => window.jelto.q?.length ?? 0)).toBe(0)
  expect(await page.evaluate(() => typeof window.jelto)).toBe('function')
})

test('T13 — a null or non-array-like entry in the pre-load queue is skipped without throwing, and the pageview still sends', async ({
  page,
  site,
  mockd,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await lifecycle(page)
  await page.addInitScript(() => {
    ;(window as unknown as { jelto: unknown }).jelto = { q: [null, 5] }
  })
  await site.install()
  site.defaults({})
  await site.goto('/')

  const events = await mockd.awaitEvents(1)
  expect(events.some((e) => e.n === 'pageview')).toBe(true)
  expect(errors).toEqual([])
})

test('T13b — without the stub, window.jelto is undefined before load and the page\'s own call throws', async ({
  page,
  site,
  mockd,
}) => {
  await lifecycle(page)
  await site.install()
  site.asset(
    '/app.js',
    `window.__before = typeof window.jelto
     try { window.jelto('event', 'signup') ; window.__threw = 'no' }
     catch (e) { window.__threw = e.constructor.name }`,
  )
  site.defaults({ head: '<script src="/app.js"></script>' })
  await site.goto('/')

  const probe = await page.evaluate(() => ({
    before: (window as unknown as { __before: string }).__before,
    threw: (window as unknown as { __threw: string }).__threw,
  }))
  expect(probe.before).toBe('undefined')
  expect(probe.threw).toBe('TypeError')

  const events = await mockd.awaitEvents(1)
  expect(events.filter((e) => e.n === 'signup')).toHaveLength(0)
})

test('T16 — a 500 is not retried and logs nothing', async ({ page, site, mockd }) => {
  const errors: string[] = []
  // What the snippet must never do is log or throw. A failed HTTP request
  // also produces "Failed to load resource: …" from Chromium's own network
  // stack, with the request URL as its location and no JS frame at all -- it is
  // emitted for `fetch`, for `sendBeacon` and for an `<img>` alike, and no
  // client code can suppress it. So the assertion is the one the rule actually
  // makes: nothing whose location is jelto.js, and no uncaught error.
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && m.location().url.includes('jelto.js')) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await mockd.mode('500')
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/')

  await new Promise((r) => setTimeout(r, 4_000))
  expect(await mockd.requests()).toHaveLength(1)
  expect(errors).toEqual([])
})

test('T16 — a refused connection is not retried and logs nothing', async ({ page, site, mockd }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await mockd.down()
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<button data-jelto-event="signup">go</button>' })
  await site.goto('/')
  await page.click('button')
  await new Promise((r) => setTimeout(r, 3_000))

  // A failed fetch logs to the console from the network stack itself, which
  // the snippet cannot suppress; the snippet itself must never THROW
  // into the page or log anything of its own.
  expect(errors).toEqual([])
})

test('T17 — 50 clicks in 1 s: at most 50 events in at most 3 requests', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<button id="b" data-jelto-event="tap">go</button>' })
  await site.goto('/')
  await mockd.awaitEvents(1)
  const before = (await mockd.requests()).length

  await page.evaluate(async () => {
    const button = document.getElementById('b')!
    for (let i = 0; i < 50; i++) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 15))
    }
  })
  await new Promise((r) => setTimeout(r, 2_000))

  const taps = (await mockd.events()).filter((e) => e.n === 'tap')
  expect(taps.length).toBe(50)
  expect((await mockd.requests()).length - before).toBeLessThanOrEqual(3)
})

for (const character of ['x', '界']) {
  test(`batches valid ${character === 'x' ? 'ASCII' : 'multibyte'} events within the wire byte limit`, async ({ page, site, mockd }) => {
    await lifecycle(page)
    await site.install()
    site.defaults({ attrs: { autoPageview: 'off' } })
    await site.goto('/')
    await page.evaluate(value => {
      for (let index = 0; index < 100; index++) {
        window.jelto('event', 'custom', { index, a: value.repeat(200), b: value.repeat(200), c: value.repeat(200) })
      }
    }, character)
    const events = await mockd.awaitEvents(100, 10000)
    expect(events.map(event => event.props?.index)).toEqual(Array.from({ length: 100 }, (_, index) => index))
    expect(new Set(events.map(event => event.id)).size).toBe(100)
    for (const event of events) {
      for (const key of ['a', 'b', 'c']) expect(event.props?.[key]).toBe(character.repeat(200))
    }
    const bodies = await mockd.bodies()
    expect(bodies.length).toBeGreaterThan(1)
    for (const body of bodies) {
      expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(65536)
      expect(JSON.parse(body).e.length).toBeLessThanOrEqual(100)
    }
    validateAgainstSchema(bodies)
  })
}

for (const atHead of [false, true]) {
  test(`one oversized event at the ${atHead ? 'head' : 'middle'} does not discard or strand valid events`, async ({ page, site, mockd }) => {
    await lifecycle(page)
    await site.install()
    site.defaults({ attrs: { autoPageview: 'off' } })
    await site.goto('/')
    await page.evaluate(head => {
      if (!head) window.jelto('event', 'before')
      window.jelto('event', 'oversized', { value: 'x'.repeat(65536) })
      window.jelto('event', 'after')
    }, atHead)
    const names = atHead ? ['after'] : ['before', 'after']
    expect((await mockd.awaitEvents(names.length)).map(event => event.n)).toEqual(names)
    for (const body of await mockd.bodies()) expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(65536)
  })
}

for (const malformed of ['bigint', 'circular']) {
  test(`${malformed} custom properties cannot poison neighboring valid events`, async ({ page, site, mockd }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(String(error)))
    await lifecycle(page)
    await site.install()
    site.defaults({ attrs: { autoPageview: 'off' } })
    await site.goto('/')
    await page.evaluate(kind => {
      const props: Record<string, unknown> = {}
      props.value = kind === 'bigint' ? 1n : props
      window.jelto('event', 'before')
      window.jelto('event', 'malformed', props)
      window.jelto('event', 'after')
    }, malformed)
    expect((await mockd.awaitEvents(2)).map(event => event.n)).toEqual(['before', 'after'])
    expect(errors).toEqual([])
    validateAgainstSchema(await mockd.bodies())
  })
}

test('queued custom events retain their accepted properties when the page reuses the object', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { autoPageview: 'off' } })
  await site.goto('/')
  await page.evaluate(() => {
    const props: Record<string, unknown> = { plan: 'free' }
    window.jelto('event', 'before', props)
    props.plan = 'paid'
    window.jelto('event', 'after', props)
    // Mutation after enqueue must not make either accepted event unserializable.
    props.value = props
  })
  const events = await mockd.awaitEvents(2)
  expect(events.map(event => event.props)).toEqual([{ plan: 'free' }, { plan: 'paid' }])
  validateAgainstSchema(await mockd.bodies())
})

test('T18 — with fetch absent, sendBeacon carries the batch', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).fetch
    const real = navigator.sendBeacon.bind(navigator)
    const counter = { n: 0 }
    ;(window as unknown as Record<string, unknown>).__beacons = counter
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null): boolean => {
      counter.n++
      return real(url, data)
    }
  })
  await site.install()
  site.defaults({})
  await site.goto('/')

  const events = await mockd.awaitEvents(1)
  expect(events.map((e) => e.n)).toEqual(['pageview'])
  expect(await page.evaluate(() => (window as unknown as { __beacons: { n: number } }).__beacons.n)).toBeGreaterThan(0)
})

test('T19 — a pending batch is delivered on visibilitychange -> hidden', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ attrs: { autoPageview: 'off' } })
  await site.goto('/')

  await page.evaluate(() => window.jelto('event', 'queued'))
  await hide(page)
  const events = await mockd.awaitEvents(1, 700)
  expect(events.map((e) => e.n)).toContain('queued')
})

test('T20 — the bundle is within its gzipped budget', () => {
  // The approved shared-source ceiling.
  const BUDGET = 3300
  const bundle = readFileSync(path.resolve(here, '../dist/jelto.js'))
  const gzipped = gzipSync(bundle, { level: 9 }).length
  console.log(`T20: ${bundle.length} B raw, ${gzipped} B gzipped of ${BUDGET}`)
  expect(gzipped).toBeLessThanOrEqual(BUDGET)
})

test('T22 — every request body validates against spec/wire-v1.schema.json', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({
    attrs: { memory: 'on' },
    body:
      '<a id="dl" href="/dl/App.pkg">d</a>' +
      '<a id="out" href="https://twitter.com/x">o</a>' +
      '<button id="tag" data-jelto-event="signup" data-jelto-event-plan="pro">t</button>',
  })
  await site.goto('/download?utm_source=producthunt&utm_medium=social', {
    from: 'https://news.ycombinator.com/item?id=1',
  })
  await mockd.awaitEvents(1)

  await page.evaluate(() => document.getElementById('tag')!.click())
  await page.evaluate(() => document.getElementById('dl')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })))
  await page.evaluate(() => document.getElementById('out')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })))
  await page.evaluate(() => window.jelto('event', 'custom', { n: 1, ok: true, s: 'x' }))
  await page.evaluate(() => history.pushState({}, '', '/pricing'))
  await mockd.awaitEvents(6)
  await hide(page)
  await new Promise((r) => setTimeout(r, 500))

  const bodies = await mockd.bodies()
  const names = (await mockd.events()).map((e) => e.n)
  expect(names).toContain('pageview')
  expect(names).toContain('click:download')
  expect(names).toContain('click:outbound')
  expect(names).toContain('signup')
  expect(names).toContain('engagement')
  validateAgainstSchema(bodies)
})

test('T25 — a stop response halts sending, and it is the client holding off', async ({ page, site, mockd }) => {
  await lifecycle(page)
  await mockd.mode('stop:60:web')
  await site.install()
  site.defaults({ body: '<button id="b" data-jelto-event="tap">go</button>' })
  await site.goto('/')
  await mockd.awaitEvents(1)

  // Back to `ok`: anything that arrives from here on is the CLIENT still
  // sending, not the server still refusing.
  await mockd.mode('ok')
  const before = (await mockd.requests()).length
  for (let i = 0; i < 3; i++) {
    await page.click('#b')
    await new Promise((r) => setTimeout(r, 400))
  }
  await new Promise((r) => setTimeout(r, 1_500))
  expect((await mockd.requests()).length).toBe(before)
  expect(page.url()).toBe(SITE_ORIGIN + '/')
})
