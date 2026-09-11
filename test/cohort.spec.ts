// The checkout hand-off accessor (jelto('cohort')).
// T45, T46, T47, T48, T49, T49b.

import { test, expect } from './fixtures'
import { lifecycle } from './harness/browser'

const STUB = `window.jelto = window.jelto || function () { (window.jelto.q = window.jelto.q || []).push(arguments) }`

test('T45 — no UTM and no referrer returns the empty string', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/')

  expect(await page.evaluate(() => window.jelto('cohort'))).toBe('')
})

test('T46 — the UTM cohort is the same string T5 puts in jl', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({ body: '<a id="dl" href="/dl/App.pkg">d</a>' })
  await site.goto('/download?utm_source=producthunt&utm_medium=social')

  expect(await page.evaluate(() => window.jelto('cohort'))).toBe('producthunt~social')

  // The same value, from the same computation, on the link the click handler rewrites.
  await page.evaluate(() =>
    document.getElementById('dl')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })),
  )
  // The RESOLVED href, which is what the navigation uses and what T5 pins as
  // the navigation URL. The download-decoration rule says "append `jl` to the href"; it
  // does not require a relative attribute to stay relative, and writing back the absolute
  // form is what `a.href = …` does.
  const href = await page.evaluate(() => (document.getElementById('dl') as HTMLAnchorElement).href)
  expect(href).toBe('https://site.example/dl/App.pkg?jl=producthunt~social')
})

test('T47 — an external referrer with no UTM returns ref:<host>', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.defaults({})
  await site.goto('/download', { from: 'https://news.ycombinator.com/item?id=1' })

  expect(await page.evaluate(() => window.jelto('cohort'))).toBe('ref:news.ycombinator.com')
})

test('T48 — under memory, the remembered first touch wins over today\'s own source', async ({ page, site }) => {
  await lifecycle(page)
  await page.clock.setFixedTime(new Date('2026-08-05T10:00:00Z'))
  await page.addInitScript(() => localStorage.setItem('jelto_first', 'producthunt|2026-08-01'))
  await site.install()
  site.defaults({ attrs: { memory: 'on' } })
  await site.goto('/?utm_source=google')

  expect(await page.evaluate(() => window.jelto('cohort'))).toBe('producthunt')
})

test('T49 — without the stub, a pre-load call throws exactly as T13b', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.asset(
    '/app.js',
    `window.__before = typeof window.jelto
     try { window.__value = window.jelto('cohort'); window.__threw = 'no' }
     catch (e) { window.__threw = e.constructor.name }`,
  )
  site.defaults({ head: '<script src="/app.js"></script>' })
  await site.goto('/?utm_source=producthunt')

  const probe = await page.evaluate(() => ({
    before: (window as unknown as { __before: string }).__before,
    threw: (window as unknown as { __threw: string }).__threw,
    value: (window as unknown as { __value?: unknown }).__value,
  }))
  expect(probe.before).toBe('undefined')
  expect(probe.threw).toBe('TypeError')
  expect(probe.value).toBeUndefined()
})

test('T49b — with the stub, the call is queued and never returns a label', async ({ page, site }) => {
  await lifecycle(page)
  await site.install()
  site.asset('/app.js', STUB + `\nwindow.__value = window.jelto('cohort')`)
  site.defaults({ head: '<script src="/app.js"></script>', attrs: { autoPageview: 'off' } })
  await site.goto('/?utm_source=producthunt')

  // The pre-load queue stub pushes onto `q` and does not return the push, so the
  // answer is `undefined`. What the checkout accessor's contract makes normative is the part
  // that holds for any stub the page might write: never a label. Through v0.9 this rule said
  // "the stub's push() result, an integer", which that stub does not
  // return -- corrected in v0.10, and this is the case that found it.
  const value = await page.evaluate(() => (window as unknown as { __value: unknown }).__value)
  expect(value).toBeUndefined()
  expect(typeof value).not.toBe('string')
  expect(await page.evaluate(() => window.jelto.q?.length ?? 0)).toBe(0)
  // And after load the real accessor answers with the label.
  expect(await page.evaluate(() => window.jelto('cohort'))).toBe('producthunt')
})
