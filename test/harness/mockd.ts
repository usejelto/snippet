// A Node driver for spec/conformance/mockd -- the same mock endpoint the SDK
// conformance suite drives against, used here as spec/snippet.md §4 requires.
//
// The control channel is mockd's unix socket: JSON values in, exactly one
// reply object out per command, in order (spec/conformance/mockd/control.go).

import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { tmpdir } from 'node:os'

export interface MockdRecord {
  seq: number
  kind: 'request' | 'connection'
  method?: string
  path?: string
  query?: string
  headers?: Record<string, string[]>
  body?: string
  body_bytes: number
  since_start_us: number
  at_unix_ms: number
  response?: { status: number; body?: string }
}

/** One event as the snippet put it on the wire, straight out of the body. */
export interface WireEvent {
  id?: string
  n: string
  t?: number
  s?: string
  v?: string
  l?: string
  u?: string
  r?: string
  w?: number
  h?: number
  f?: string
  fd?: string
  pv?: string
  e?: number
  sd?: number
  i?: boolean
  /** spec/snippet.md §7 C4, cookie mode only. Absent from every body
   *  `jelto.js` produces, under every configuration. */
  vid?: string
  props?: Record<string, string | number | boolean>
}

export interface WireEnvelope {
  v: number
  p: string
  e: WireEvent[]
}

interface Reply {
  ok: boolean
  error?: string
  addr?: string
  records?: MockdRecord[]
  next?: number
}

export class Mockd {
  private constructor(
    private readonly proc: ChildProcess,
    private readonly socketPath: string,
    public addr: string,
  ) {}

  /** `http://<addr>/v1/e` -- what a page's `data-endpoint` points at. */
  get endpoint(): string {
    return `http://${this.addr}/v1/e`
  }

  static async start(): Promise<Mockd> {
    const bin = process.env.JELTO_MOCKD_BIN
    if (!bin) throw new Error('JELTO_MOCKD_BIN is unset; test/global-setup.ts builds it')
    const socketPath = path.join(tmpdir(), `jelto-snippet-mockd-${process.pid}-${Date.now()}.sock`)
    const proc = spawn(bin, ['-addr', '127.0.0.1:0', '-control', socketPath, '-log-level', 'error'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const addr = await new Promise<string>((resolve, reject) => {
      let buffered = ''
      const timer = setTimeout(() => reject(new Error('mockd did not print its ready line')), 10_000)
      proc.stdout!.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('utf8')
        const nl = buffered.indexOf('\n')
        if (nl === -1) return
        clearTimeout(timer)
        resolve((JSON.parse(buffered.slice(0, nl)) as { addr: string }).addr)
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`mockd exited with ${code} before it was ready`))
      })
    })
    return new Mockd(proc, socketPath, addr)
  }

  private command(cmd: Record<string, unknown>): Promise<Reply> {
    return new Promise((resolve, reject) => {
      // A recording can split a UTF-8 scalar across socket chunks. Node's
      // streaming decoder retains that partial scalar for the next chunk.
      const socket = net.createConnection(this.socketPath).setEncoding('utf8')
      let buffered = ''
      socket.on('error', reject)
      socket.on('connect', () => socket.write(JSON.stringify(cmd) + '\n'))
      socket.on('data', (chunk: string) => {
        buffered += chunk
        const nl = buffered.indexOf('\n')
        if (nl === -1) return
        const reply = JSON.parse(buffered.slice(0, nl)) as Reply
        socket.end()
        resolve(reply)
      })
    })
  }

  /**
   * The scenario boundary: clears the recording, drops any script and puts the
   * default mode back to `ok`. Called before every test.
   */
  async reset(): Promise<void> {
    const reply = await this.command({ cmd: 'reset' })
    if (!reply.ok) throw new Error(`mockd reset: ${reply.error}`)
    if (reply.addr) this.addr = reply.addr
  }

  /** spec/sdk-conformance.md §2's modes: `ok`, `500`, `stop:60:web`, ... */
  async mode(mode: string): Promise<void> {
    const reply = await this.command({ cmd: 'mode', mode })
    if (!reply.ok) throw new Error(`mockd mode ${mode}: ${reply.error}`)
  }

  /** Closes the listener so connections are REFUSED (T16's "network down"). */
  async down(): Promise<void> {
    await this.mode('down')
  }

  private async records(): Promise<MockdRecord[]> {
    const reply = await this.command({ cmd: 'recording' })
    if (!reply.ok) throw new Error(`mockd recording: ${reply.error}`)
    return reply.records ?? []
  }

  /** Every POST that reached `/v1/e`, oldest first. */
  async requests(): Promise<MockdRecord[]> {
    return (await this.records()).filter((r) => r.kind === 'request' && r.method === 'POST' && r.path === '/v1/e')
  }

  /** Every envelope, in arrival order. */
  async envelopes(): Promise<WireEnvelope[]> {
    return (await this.requests()).map((r) => JSON.parse(r.body ?? '{}') as WireEnvelope)
  }

  /** Every event, flattened across envelopes, in arrival order. */
  async events(): Promise<WireEvent[]> {
    return (await this.envelopes()).flatMap((envelope) => envelope.e ?? [])
  }

  /** The raw bodies, for the schema check T22 and T40 run over them. */
  async bodies(): Promise<string[]> {
    return (await this.requests()).map((r) => r.body ?? '')
  }

  /**
   * Waits until at least `count` events have arrived, or the timeout. Returns
   * what arrived either way -- an assertion on the events is a better failure
   * message than a timeout, and several cases assert that NOTHING more comes.
   */
  async awaitEvents(count: number, timeoutMs = 8_000): Promise<WireEvent[]> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const events = await this.events()
      if (events.length >= count || Date.now() > deadline) return events
      await new Promise((r) => setTimeout(r, 25))
    }
  }

  /** Settles: waits `ms` and returns every event, for "nothing was sent". */
  async quiet(ms = 1_500): Promise<WireEvent[]> {
    await new Promise((r) => setTimeout(r, ms))
    return this.events()
  }

  async stop(): Promise<void> {
    await this.command({ cmd: 'shutdown' }).catch(() => undefined)
    this.proc.kill()
  }
}
