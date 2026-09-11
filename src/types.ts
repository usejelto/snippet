// Web event fields from spec/wire-v1.md §3 and §5.1; app-only fields are excluded.

export type PropValue = string | number | boolean
export type Props = Record<string, PropValue>

export interface EventOptions { interactive?: boolean }
/** Page lifecycle only; never a visitor identifier or a storage read. */
export interface PageContext { active: boolean; pageviewId: string | null; url: string }

/** One event on the wire. §3's common fields plus §5.1's web fields. */
export interface Ev {
  /** §3 `id`: UUIDv7 where available, else v4 (B12). Never the nil UUID. */
  id: string
  /** §3 `n`: `^[a-z0-9_:.-]{1,64}$`. */
  n: string
  /** §3 `t`: ms epoch, whole. */
  t: number
  s: 'web'
  /** Build-time client version, used for server-side rejection diagnostics. */
  v: string
  /** Absolute HTTP(S) URL, required on every web event and checked for origin eligibility. */
  u: string
  l?: string
  props?: Props
  i?: boolean
  r?: string
  w?: number
  h?: number
  f?: string
  fd?: string
  pv?: string
  e?: number
  sd?: number
  /** Cookie mode only; omitted when the browser refused the cookie. */
  vid?: string
}

/** What a caller hands `send()`. Everything else is filled in there. */
export interface Outgoing {
  n: string
  /**
   * Supply an ID when it must be known before sending, such as a pageview’s engagement
   * reference.
   */
  id?: string
  u?: string
  r?: string
  w?: number
  props?: Props
  i?: boolean
  pv?: string
  e?: number
  sd?: number
}

/** The `<script>` tag's `data-*` attributes, resolved. spec/snippet.md §1. */
export interface Config {
  /** `data-product`, `^prd_[a-z0-9]{10}$` is the server's business. */
  product: string
  /** `data-endpoint`. */
  endpoint: string
  /** `data-hash`: the fragment is part of the page identity. */
  hash: boolean
  /** `data-spa="off"` sets this false. B9. */
  spa: boolean
  /** `data-exclude`, split on commas. B2. */
  exclude: string[]
  /** `data-file-types`, lower-cased, without dots; B3's default list when
   *  the attribute is absent. */
  fileTypes: string[]
  /** `data-allow-localhost`. B2. */
  allowLocalhost: boolean
  /** `data-memory="on"`. B15. */
  memory: boolean
  /** `data-auto-pageview="off"` sets this false. B18. */
  autoPageview: boolean
}
