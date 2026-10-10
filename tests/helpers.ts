import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { zstdDecompressSync } from 'node:zlib'
import { Config } from '../src/config.js'

export function fakeToken(expires = 4_102_444_800, account = 'test-account'): string {
  const claims = { exp: expires, 'https://api.openai.com/auth': { chatgpt_account_id: account } }
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`
}

export async function authFixture(token = fakeToken()) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-codex-test-'))
  const path = join(directory, 'auth.json')
  await writeFile(path, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: token, refresh_token: 'never-used' } }), { mode: 0o600 })
  return { path, directory, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

export function config(overrides: Partial<Config> = {}): Config {
  return Config(overrides)
}

export interface WireRequest { path: string; headers: IncomingHttpHeaders; body: unknown }
export type Behavior = (response: ServerResponse, request: WireRequest) => void

export async function mockEndpoint(behaviors: Behavior[]) {
  const requests: WireRequest[] = []
  const received = Promise.withResolvers<void>()
  const server = createServer((request, response) => {
    const buffers: Buffer[] = []
    request.on('data', (chunk: Buffer) => { buffers.push(chunk) })
    request.on('end', () => {
      const bytes = Buffer.concat(buffers)
      const source = (request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(bytes) : bytes).toString('utf8')
      const record = { path: request.url ?? '', headers: request.headers, body: JSON.parse(source) }
      requests.push(record)
      const behavior = behaviors[requests.length - 1]
      if (!behavior) { response.writeHead(500).end('{}'); return }
      behavior(response, record)
      received.resolve()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    received: received.promise,
    cleanup: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}

export function sse(events: object[]): Behavior {
  return response => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end()
  }
}

export function textEvents(text = 'CODEX_BRIDGE_OK'): object[] {
  const item = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
  return [
    { type: 'response.created', response: { id: 'resp_2' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_2', status: 'completed', output: [item], usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 } } },
  ]
}
