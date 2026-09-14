import { readFileSync } from 'node:fs'
import path from 'node:path'

export function contractsDirectory(): string {
  const directory = process.env.JELTO_CONTRACTS_DIR
  if (!directory) throw new Error('Set JELTO_CONTRACTS_DIR to an extracted Jelto contracts 0.1.x archive, or run make test-snippet from the monorepo.')
  const root = path.resolve(directory)
  const manifest = JSON.parse(readFileSync(path.join(root, 'spec/contracts/manifest.json'), 'utf8')) as { name?: string; version?: string }
  // Any 0.1.x archive carries the wire schema and mock server these tests
  // drive; a later minor is a contract change to review, not to run against.
  if (manifest.name !== 'jelto-contracts' || !/^0\.1\.\d+$/.test(manifest.version || '')) throw new Error('Snippet tests require a Jelto contracts 0.1.x archive')
  return root
}
