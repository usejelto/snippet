// Cookie-mode visitor identity (spec/snippet.md §7). The build removes this module from
// jelto.js and verifies that in both emitted bytes and the module graph.

const NAME = 'jelto_vid'

/** Fixed at first set; 395 days stays below Chrome’s 400-day cookie lifetime cap. */
const MAX_AGE = 34128e3

let id = ''

/**
 * Initialize before queueing events. Cookie failures leave identity empty and use
 * cookieless counting.
 */
export function initVid(): void {
  try {
    id = read() || mint()
  } catch {}
}

/** §7 C4: the value of `vid`, or `""` when no field is to be sent. */
export function vid(): string {
  return id
}

/**
 * Reject malformed cookie values locally: an invalid vid causes the server to reject the
 * whole event.
 */
function read(): string {
  return /(?:^|;\s*)jelto_vid=([\w-]{22})(?:;|$)/.exec(document.cookie)?.[1] || ''
}

/**
 * Use 16 cryptographically random bytes encoded as base64url. Its 22-character grammar is
 * distinct from app install UUIDs; never derive one from the other.
 */
function newID(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .slice(0, 22)
}

/**
 * Read back the cookie before using its ID: refused cookies must not create a new
 * “visitor” on every pageview. Set Secure only over HTTPS. Keep the cookie host-only with
 * path=/ and SameSite=Lax.
 */
function mint(): string {
  document.cookie =
    NAME +
    '=' +
    newID() +
    ';path=/;max-age=' +
    MAX_AGE +
    ';samesite=lax' +
    (location.protocol == 'https:' ? ';secure' : '')
  return read()
}
