// Drive visibility, focus and bfcache states through browser properties and events before
// scripts load; headless navigation cannot reliably produce them. Keep the snippet’s
// clock and lifecycle logic intact.

import type { Page } from '@playwright/test'

declare global {
  interface Window {
    /** The snippet's own API. `q` is the pre-load queue stub, which the
     *  PAGE installs and the snippet drains -- never the other way round. */
    jelto: ((...args: unknown[]) => unknown) & { q?: IArguments[] }
    __jelto: {
      show(withFocus?: boolean): void
      hide(): void
      blur(): void
      focus(): void
      pagehide(): void
      pageshow(persisted: boolean): void
    }
  }
}

/**
 * Installs the controls. `startHidden` puts the document in the state a
 * prerendered or background tab loads in (T1b), before the deferred snippet
 * has run.
 */
export async function lifecycle(page: Page, options: { startHidden?: boolean } = {}): Promise<void> {
  await page.addInitScript((startHidden: boolean) => {
    let hidden = startHidden
    let focused = !startHidden
    Object.defineProperty(Document.prototype, 'visibilityState', {
      get: () => (hidden ? 'hidden' : 'visible'),
      configurable: true,
    })
    Object.defineProperty(Document.prototype, 'hidden', { get: () => hidden, configurable: true })
    Document.prototype.hasFocus = () => focused
    // The real `visibilitychange` is fired AT `document` and BUBBLES, which is
    // what lets a window-level listener see it -- and the snippet has one
    // (send.ts's terminal flush). A non-bubbling synthetic event would be
    // invisible to it and every "the batch went out on hide" assertion would
    // fail for a reason that is the harness's, not the snippet's.
    const visibility = (): void => {
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    }
    window.__jelto = {
      show(withFocus?: boolean) {
        hidden = false
        focused = withFocus !== false
        visibility()
      },
      hide() {
        hidden = true
        focused = false
        visibility()
      },
      blur() {
        focused = false
        window.dispatchEvent(new Event('blur'))
      },
      focus() {
        focused = true
        window.dispatchEvent(new Event('focus'))
      },
      pagehide() {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
      },
      pageshow(persisted: boolean) {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }))
      },
    }
  }, options.startHidden === true)
}

/**
 * Visibility can return without window focus. Preserve that distinction so the engagement
 * clock does not accrue time.
 */
export const show = (page: Page, options: { focus?: boolean } = {}): Promise<void> =>
  page.evaluate((withFocus: boolean) => window.__jelto.show(withFocus), options.focus !== false)
export const hide = (page: Page): Promise<void> => page.evaluate(() => window.__jelto.hide())
export const blur = (page: Page): Promise<void> => page.evaluate(() => window.__jelto.blur())
export const focus = (page: Page): Promise<void> => page.evaluate(() => window.__jelto.focus())
export const pagehide = (page: Page): Promise<void> => page.evaluate(() => window.__jelto.pagehide())
export const pageshow = (page: Page, persisted = true): Promise<void> =>
  page.evaluate((p: boolean) => window.__jelto.pageshow(p), persisted)

/**
 * Makes the document `n` viewports tall, or shorter than one. Scroll depth divides by
 * the height measured at send time, so a test that grows the page must grow
 * something a real layout would report -- this sets an explicit pixel height
 * on a block in the body rather than touching any of the height APIs that computation reads.
 */
export async function setDocumentHeight(page: Page, viewports: number): Promise<void> {
  await page.evaluate((n: number) => {
    let filler = document.getElementById('jelto-filler')
    if (!filler) {
      filler = document.createElement('div')
      filler.id = 'jelto-filler'
      document.body.appendChild(filler)
    }
    document.documentElement.style.margin = '0'
    document.body.style.margin = '0'
    filler.style.height = Math.round(window.innerHeight * n) + 'px'
  }, viewports)
}

/**
 * Overrides `document.referrer`. T1d's third arm needs
 * `android-app://com.reddit.frontpage`, which Chrome on Android produces from
 * an `EXTRA_REFERRER` and which no navigation on a desktop browser can create.
 * The snippet reads `document.referrer` either way.
 */
export async function stubReferrer(page: Page, value: string): Promise<void> {
  await page.addInitScript((referrer: string) => {
    Object.defineProperty(Document.prototype, 'referrer', { get: () => referrer, configurable: true })
  }, value)
}

/**
 * Install storage spies before page scripts. Both cookieless and cookie-mode tests use
 * the same coverage.
 */
export async function spyOnStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: string[] = []
    ;(window as unknown as Record<string, unknown>).__storage = calls
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(Document.prototype, 'cookie', {
      get() {
        calls.push('cookie.get')
        return cookie.get!.call(this)
      },
      set(v: string) {
        calls.push('cookie.set')
        cookie.set!.call(this, v)
      },
      configurable: true,
    })
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
      const real = (window as unknown as Record<string, unknown>)[name]
      Object.defineProperty(window, name, {
        get() {
          calls.push(name)
          return real
        },
        configurable: true,
      })
    }
  })
}

/** What the spy above recorded, oldest first. */
export const storageCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __storage: string[] }).__storage)

/**
 * A browser that silently REFUSES cookies: the setter runs and stores nothing,
 * which is what third-party blocking, partitioned storage and a visitor's own
 * setting all look like from inside the page. TC4's subject.
 */
export async function refuseCookies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(Document.prototype, 'cookie', {
      get() {
        return cookie.get!.call(this)
      },
      set() {},
      configurable: true,
    })
  })
}
