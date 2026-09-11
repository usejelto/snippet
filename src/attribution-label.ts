/** Aggregate channel labels only: no URLs, identifiers or arbitrary query text. */
export function validCohort(value: string): boolean {
  return /^(?:[a-z0-9._-]{1,64}(?:~[a-z0-9._-]{0,64}){0,2}|ref:[a-z0-9](?:[a-z0-9.-]{0,194}[a-z0-9])?)$/.test(value)
}
