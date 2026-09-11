// Optional cross-domain links carry aggregate attribution, never visitor identity.
import { validCohort } from './attribution-label'

type Attribution = { cohort: string; first: boolean }
type API = (command: string) => unknown
const tag = document.currentScript as HTMLScriptElement | null
const main = document.querySelector<HTMLScriptElement>('script[data-product][src$="jelto.js"],script[data-product][src$="jelto.cookie.js"]')
const hostWindow = window as unknown as { jelto?: API; __jeltoCrossdomain?: boolean; __jeltoAttribution?: () => Attribution | undefined }
const context = (): Attribution | undefined => {
  try { return hostWindow.jelto?.('attribution') as Attribution | undefined } catch { return undefined }
}
const domains = (tag?.dataset.domains || '').split(',').slice(0, 20).filter(host => host.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host))
if (tag?.dataset.product && tag.dataset.product === main?.dataset.product && new URLSearchParams(location.search).get('jelto_ignore') !== '1' && !hostWindow.__jeltoCrossdomain) {
  hostWindow.__jeltoCrossdomain = true
  // Load before the core so its first pageview and optional attribution memory
  // see the same validated label. A disabled/missing helper creates no relay.
  hostWindow.__jeltoAttribution = () => {
    try {
      const source = new URL(document.referrer)
      const params = new URLSearchParams(location.search)
      const cohort = params.get('jl') || ''
      if (/^https?:$/.test(source.protocol) && source.hostname !== location.hostname && domains.includes(source.hostname) && domains.includes(location.hostname) && params.getAll('jl').length === 1 && validCohort(cohort)) return { cohort, first: params.get('jt') === 'first' }
    } catch {}
  }
  const rewritten = new WeakMap<HTMLAnchorElement, { before: string; after: string }>()
  function decorate(event: MouseEvent): void {
    if (event.defaultPrevented || event.button > 1) return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (!link) return
    const previous = rewritten.get(link)
    if (previous && link.href === previous.after) link.href = previous.before
    const value = context()
    if (!value || !validCohort(value.cohort)) return
    try {
      const url = new URL(link.href)
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hostname === location.hostname || !domains.includes(url.hostname)) return
      if (['jl', 'utm_source', 'ref', 'source', 'via'].some(key => url.searchParams.has(key))) return
      const before = link.href
      url.searchParams.set('jl', value.cohort)
      if (value.first) url.searchParams.set('jt', 'first')
      link.href = url.href
      rewritten.set(link, { before, after: link.href })
    } catch {}
  }
  let started = false
  const start = () => {
    if (started || !context()) return
    started = true
    document.addEventListener('click', decorate, true)
    document.addEventListener('auxclick', decorate, true)
  }
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
  // Dynamic SDK scripts can finish after DOMContentLoaded.
  main?.addEventListener('load', start, { once: true })
}
