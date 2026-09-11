// Optional aggregate entry groups. No URL/path or person identifier is stored.
import { excluded } from './config'
import type { Config, PageContext } from './types'

type Group = { id: string; host: string; paths: string[] }
type Entry = { id: string; at: number }
type Metadata = { jelto_entry_page?: string }
const g = window as unknown as { jelto?: (command: string) => unknown; __jeltoEntry?: () => Metadata }
const tag = document.currentScript as HTMLScriptElement | null
const checkout = document.querySelector<HTMLScriptElement>('script[src$="jelto.checkout.js"]')
const main = document.querySelector<HTMLScriptElement>('script[data-product][src$="jelto.js"],script[data-product][src$="jelto.cookie.js"]')
const product = tag?.dataset.product
const context = (): PageContext | undefined => {
  try { return g.jelto?.('context') as PageContext | undefined } catch { return undefined }
}
if (product && product === main?.dataset.product && checkout && context()?.active && !g.__jeltoEntry) {
  let groups: Group[] = []
  try {
    const values: unknown = JSON.parse(checkout.dataset.entryPages || '[]')
    if (Array.isArray(values) && values.length <= 50) groups = values.filter((value): value is Group => {
      const group = value as Group | null
      return !!group && typeof group.id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(group.id) && typeof group.host === 'string' && Array.isArray(group.paths) && group.paths.length <= 20 && group.paths.every(path => typeof path === 'string' && path.startsWith('/') && path.length <= 2048)
    })
  } catch {}
  const memory = checkout.dataset.paymentMemory !== 'off'
  const key = 'jelto_entry_' + product
  const ttl = 1800000
  let saved: Entry | undefined
  if (memory) {
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null') as Entry | undefined } catch {}
  }
  g.__jeltoEntry = () => {
    const page = context()
    if (!page?.active || !page.pageviewId) return {}
    const now = Date.now()
    if (saved && (!Number.isFinite(saved.at) || saved.at > now || saved.at <= now - ttl || !groups.some(group => group.id === saved!.id))) {
      saved = undefined
      if (memory) { try { sessionStorage.removeItem(key) } catch {} }
    }
    if (!saved) {
      try {
        const url = new URL(page.url)
        const path = url.pathname + (main!.hasAttribute('data-hash') ? url.hash : '')
        const group = groups.find(group => group.host === url.hostname && excluded({ exclude: group.paths } as Config, path))
        if (group) {
          saved = { id: group.id, at: now }
          if (memory) { try { sessionStorage.setItem(key, JSON.stringify(saved)) } catch {} }
        }
      } catch {}
    }
    return saved ? { jelto_entry_page: saved.id } : {}
  }
  g.__jeltoEntry()
  addEventListener('jelto:pageview', g.__jeltoEntry)
}
