import type { Config, Outgoing, Props } from './types'
import { send, flush } from './send'
import { decorate } from './cohort'

let c: Config
const rewritten = new WeakMap<HTMLAnchorElement, [string, string]>()

function fire(ev: Outgoing): void {
  send(ev)
  flush()
}

function click(ev: MouseEvent): void {
  // B3: `preventDefault()` before us means no event and no rewrite (T11b).
  // `auxclick` also fires for the secondary button, which is not a click.
  if (ev.defaultPrevented || ev.button > 1) return
  const t = ev.target as Element | null
  if (!t || !t.closest) return

  const a = t.closest('a[href]') as HTMLAnchorElement | null
  const tag = t.closest('[data-jelto-event]:not(form)') as HTMLElement | null
  // Preserve modifier, middle-button and new-tab navigation.
  const other = ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button === 1 || a?.target === '_blank'

  let dl = false
  if (a) {
    const p = a.pathname
    const lower = p.toLowerCase()
    dl = a.hasAttribute('download') || c.fileTypes.some((x) => lower.endsWith('.' + x))
    if (dl) {
      fire({ n: 'click:download', props: { file: p.split('/').pop() || '' } })
      // Update the href during capture; the browser’s default navigation reads it
      // afterward. Recompute our own decoration when a persistent SPA link is
      // clicked again, while preserving changes made by the page itself.
      const previous = rewritten.get(a)
      const before = previous?.[1] === a.href ? previous[0] : a.href
      a.href = decorate(before)
      rewritten.set(a, [before, a.href])
    } else if (a.hostname && a.hostname !== location.hostname) {
      fire({ n: 'click:outbound', props: { url: a.hostname } })
    }
  }

  // Tagged forms report submission through the optional goals helper. Their
  // submit control must not report a second goal on its preceding click.
  if (tag && !((tag as HTMLButtonElement).type === 'submit' && (tag as HTMLButtonElement).form?.hasAttribute('data-jelto-event'))) {
    const n = tag.getAttribute('data-jelto-event')
    if (n) {
      const props: Props = {}
      for (const at of tag.attributes) {
        if (at.name.indexOf('data-jelto-event-') === 0) props[at.name.slice(17)] = at.value
      }
      fire({ n, props })
      // Tagged same-tab links wait up to 300 ms for sending; downloads are never delayed.
      if (a && !other && !dl) {
        ev.preventDefault()
        const href = a.href
        setTimeout(() => {
          location.href = href
        }, 300)
      }
    }
  }
}

/**
 * Delegate capture listeners so dynamically inserted links are covered. Click flushes
 * remain throttled by send.ts; download navigation relies on keepalive and is never
 * delayed.
 */
export function initLinks(x: Config): void {
  c = x
  document.addEventListener('click', click, true)
  document.addEventListener('auxclick', click, true)
}
