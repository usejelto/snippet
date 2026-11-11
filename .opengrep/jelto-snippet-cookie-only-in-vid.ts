declare const cookieStore: { get(name: string): Promise<unknown> }

// ruleid: jelto-snippet-cookie-only-in-vid
export const read = document.cookie
export function write(value: string): void {
  // ruleid: jelto-snippet-cookie-only-in-vid
  document.cookie = 'jelto_vid=' + value
}
// ruleid: jelto-snippet-cookie-only-in-vid
export const throughWindow = window.document.cookie
// ruleid: jelto-snippet-cookie-only-in-vid
export const throughGlobal = globalThis.document.cookie
// ruleid: jelto-snippet-cookie-only-in-vid
export const indexed = document['cookie']
// ruleid: jelto-snippet-cookie-only-in-vid
export const optional = document?.cookie
// ruleid: jelto-snippet-cookie-only-in-vid
const { cookie } = document
// ruleid: jelto-snippet-cookie-only-in-vid
const { cookie: renamed } = document
export const destructured = cookie + renamed
const d = document
// ruleid: jelto-snippet-cookie-only-in-vid
export const aliased = d.cookie
// ruleid: jelto-snippet-cookie-only-in-vid
export const accessor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
// ruleid: jelto-snippet-cookie-only-in-vid
export const store = cookieStore.get('jelto_vid')
// ruleid: jelto-snippet-cookie-only-in-vid
export const windowStore = window.cookieStore

// ok: jelto-snippet-cookie-only-in-vid
export const referrer = document.referrer
// ok: jelto-snippet-cookie-only-in-vid
export const title = d.title
// ok: jelto-snippet-cookie-only-in-vid
export const name = 'jelto_vid'
// ok: jelto-snippet-cookie-only-in-vid
export const unrelated = { cookie: 'a property of another object' }.cookie
