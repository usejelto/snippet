// Read snippet configuration from its script tag (spec/snippet.md §1).

import type { Config } from './types'

/** B3's default download extensions, replaced wholesale by `data-file-types`. */
const FILE_TYPES = 'dmg pkg zip exe msi appimage deb rpm tar.gz snap'

/** Return null when data-product is missing, disabling initialization. */
export function readConfig(): Config | null {
  const el = document.currentScript as HTMLScriptElement | null
  const d = el?.dataset
  if (!d?.product) return null
  let endpoint = 'https://in.jelto.io/v1/e'
  if ('endpoint' in d) {
    try {
      if (!d.endpoint?.trim()) return null
      const url = new URL(d.endpoint, location.href)
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.href.includes('#')) return null
      endpoint = url.href
    } catch { return null }
  }
  return {
    product: d.product,
    endpoint,
    hash: 'hash' in d,
    spa: d.spa !== 'off',
    exclude: split(d.exclude || ''),
    fileTypes: split((d.fileTypes || FILE_TYPES).toLowerCase()).map((t) => t.replace(/^\./, '')),
    allowLocalhost: 'allowLocalhost' in d,
    memory: d.memory === 'on',
    autoPageview: d.autoPageview !== 'off',
  }
}

function split(v: string): string[] {
  return v.split(/[,\s]+/).filter(Boolean)
}

/**
 * Check page-wide exclusions before installing any listeners, timers, storage access or
 * history wrappers. Supplied and SPA URLs are checked separately by excluded().
 */
export function blocked(c: Config): boolean {
  if (new URLSearchParams(location.search).get('jelto_ignore') === '1') return true
  const w = window as unknown as Record<string, unknown>
  if (navigator.webdriver || w._phantom || w.__nightmare || w.Cypress) return true
  if (location.protocol === 'file:') return true
  const h = location.hostname
  if (
    !c.allowLocalhost &&
    (/^localhost$/.test(h) || /^127(\.\d+){0,2}\.\d+$/.test(h) || /^\[::1?\]$/.test(h) || /\.local$/.test(h))
  ) {
    return true
  }
  return excluded(c, pagePath(c))
}

/**
 * Path globs match one segment with * and any depth with **. Protect ** with a NUL before
 * expanding single stars.
 */
export function excluded(c: Config, path: string): boolean {
  for (const pattern of c.exclude) {
    const source =
      '^' +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\0')
        .replace(/\*/g, '[^/]*')
        .replace(/\0/g, '.*') +
      '$'
    if (new RegExp(source).test(path)) return true
  }
  return false
}

/** Return an absolute page URL, retaining the fragment only in hash mode. */
export function pageUrl(c: Config): string {
  return c.hash ? location.href : location.href.split('#')[0]!
}

/** The string B2's globs are matched against: pathname, plus hash in hash mode. */
export function pagePath(c: Config): string {
  return location.pathname + (c.hash ? location.hash : '')
}

/** The same, for an absolute URL that is not `location` -- B18's supplied `u`. */
export function urlPath(c: Config, absolute: string): string {
  const u = new URL(absolute)
  return u.pathname + (c.hash ? u.hash : '')
}
