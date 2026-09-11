// Optional payment attribution. Only aggregate channel context is remembered;
// payment references and emails are sent to the provider-verifying intake.
export {}
type Context = { cohort: string; first: boolean }
type Metadata = { jelto_cohort?: string; jelto_jt?: 'first'; jelto_entry_page?: string }
type Payment = { email?: string; provider?: string; environment?: string; session_id?: string; order_id?: string; checkout_id?: string }
type API = ((command: string, value?: unknown) => unknown) & { q?: ArrayLike<unknown>[] }
const g = window as unknown as { jelto?: API; jeltoCheckoutMetadata?: () => Metadata; __jeltoEntry?: () => Metadata }
const tag = document.currentScript as HTMLScriptElement | null
const mainTag = document.querySelector<HTMLScriptElement>('script[data-product][src$="jelto.js"],script[data-product][src$="jelto.cookie.js"]')
const product = tag?.dataset.product || mainTag?.dataset.product
const api = g.jelto
const query = new URLSearchParams(location.search)
const initial = query.get('jelto_ignore') === '1' ? undefined : api?.('attribution') as Context | undefined
if (product && tag && api && typeof initial?.cohort === 'string' && !g.jeltoCheckoutMetadata) {
  const memory = tag.dataset.paymentMemory !== 'off'
  const key = 'jelto_payment_' + product
  const ttl = 1800000
  const enabled = () => !!api('attribution')
  const isProvider = (host: string) => /(^|\.)(stripe\.com|lemonsqueezy\.com|polar\.sh)$/.test(host)
  let saved: (Context & { at: number }) | null = null
  if (memory) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) || 'null')
      if (stored && typeof stored.cohort === 'string' && stored.cohort.length <= 512 && typeof stored.first === 'boolean' && stored.at <= Date.now() && stored.at > Date.now() - ttl) saved = stored
      else sessionStorage.removeItem(key)
    } catch {}
  }
  function remember(value: Context): Context {
    if (memory && (!saved || saved.cohort !== value.cohort || saved.first !== value.first || saved.at <= Date.now() - ttl)) {
      saved = { ...value, at: Date.now() }
      try { sessionStorage.setItem(key, JSON.stringify(saved)) } catch {}
    }
    return value
  }
  function context(): Context | null {
    if (!enabled()) return null
    const now = api!('attribution') as Context
    if (!now || typeof now.cohort !== 'string' || now.cohort.length > 512) return null
    const q = new URLSearchParams(location.search)
    const returning = ['session_id', 'order_id', 'checkout_id'].some(k => q.has(k))
    const provider = now.cohort.startsWith('ref:') && isProvider(now.cohort.slice(4))
    if (now.cohort && !provider) return remember(now)
    if (saved && saved.at > Date.now() - ttl) return saved
    if (!returning && !document.referrer) return remember(now)
    return null
  }
  context()
  function metadata(): Metadata {
    const value = context()
    return { ...(value?.cohort && { jelto_cohort: value.cohort, ...(value.first && { jelto_jt: 'first' as const }) }), ...g.__jeltoEntry?.() }
  }
  g.jeltoCheckoutMetadata = metadata
  let endpoint = ''
  try {
    const url = new URL(tag.dataset.paymentEndpoint || '/api/v1/attribution/' + product, tag.src)
    if (/^https?:$/.test(url.protocol)) endpoint = url.href
  } catch {}
  const environment = tag.dataset.environment || 'live'
  const sent = new Set<string>()
  function payment(value: unknown): void {
    try {
      if (!endpoint || !value || typeof value !== 'object' || !enabled()) return
      const input = value as Payment
      const channel = context()
      const entry_page = g.__jeltoEntry?.().jelto_entry_page
      if (!channel && !entry_page) return
      const body = JSON.stringify({ provider: input.provider, environment: input.environment || environment, email: input.email, session_id: input.session_id, order_id: input.order_id, checkout_id: input.checkout_id, cohort: channel?.cohort, entry_page, ...(channel?.first && { jt: 'first' }) })
      if (body.length > 4096 || sent.has(body) || sent.size >= 20) return
      sent.add(body)
      let tries = 0
      const deliver = () => {
        if (!enabled()) return
        fetch(endpoint, { method: 'POST', body, credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).then(response => {
          if (response.status === 429 || response.status >= 500) {
            const after = response.headers.get('Retry-After') || ''
            retry(Number(after) * 1000 || Date.parse(after) - Date.now() || 0)
          }
        }).catch(() => retry())
      }
      const retry = (delay = 0) => ++tries < 3 && delay <= 300000 && setTimeout(deliver, Math.max(tries * 1000, delay))
      deliver()
    } catch {}
  }
  // Preserve the third argument of existing custom event calls.
  g.jelto = function(command: string, ...args: unknown[]) {
    if (command === 'payment') payment(args[0])
    else return (api as (...args: unknown[]) => unknown)(command, ...args)
  } as API
  const pending = api.q || []
  api.q = []
  try {
    for (const call of pending) if (call[0] === 'payment') payment(call[1])
  } catch {}
  if (tag.dataset.disablePayments !== 'true' && mainTag?.dataset.disablePayments !== 'true') {
    const fields = ['session_id', 'order_id', 'checkout_id'] as const
    const patterns = [/^cs_(live|test)_[A-Za-z0-9]{1,240}$/, /^[1-9][0-9]{0,19}$/, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i]
    if (fields.filter(k => query.has(k)).length === 1) {
      fields.forEach((field, index) => {
        const value = query.get(field) || ''
        if (query.getAll(field).length === 1 && patterns[index]!.test(value) && (index !== 0 || value.startsWith('cs_' + environment + '_')) && (index !== 2 || value.replace(/[-0]/g, ''))) payment({ [field]: value })
      })
    }
  }
  const decorated = new WeakMap<HTMLAnchorElement, { before: string; after: string }>()
  function decorate(event: Event): void {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-jelto-checkout]') : null
    if (!link) return
    try {
      const previous = decorated.get(link)
      if (previous && link.href === previous.after) link.href = previous.before
      const before = link.href
      const value = metadata()
      if (!value.jelto_cohort && !value.jelto_entry_page) return
      const url = new URL(link.href)
      if (url.protocol !== 'https:') return
      const provider = link.dataset.jeltoCheckout
      const params = url.searchParams
      const host = url.hostname
      if (provider === 'stripe' && /^(buy|checkout)\.stripe\.com$/.test(host)) {
        if (value.jelto_cohort && !params.has('client_reference_id')) {
          const bytes = new TextEncoder().encode(value.jelto_cohort)
          const reference = (value.jelto_jt === 'first' ? 'jf1_' : 'jl1_') + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
          if (reference.length <= 200) params.set('client_reference_id', reference)
        }
      } else if (/^lemon_?squeezy$/.test(provider!) && host.endsWith('.lemonsqueezy.com')) {
        for (const [key, data] of Object.entries(value)) params.set(`checkout[custom][${key}]`, data)
      } else if (provider === 'polar' && (host === 'polar.sh' || host === 'sandbox.polar.sh')) {
        const existing: unknown = JSON.parse(params.get('metadata') || '{}')
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return
        params.set('metadata', JSON.stringify({ ...existing, ...value }))
      } else return
      link.href = url.href
      decorated.set(link, { before, after: link.href })
    } catch {}
  }
  document.addEventListener('click', decorate, true)
  document.addEventListener('auxclick', decorate, true)
}
