import { afterEach, describe, expect, it } from 'vitest'
import { BlockAssembler, createToolResultMessage, ReasoningEffortId, attributionHeaders, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { createCodexAdapter } from '../src/adapter.js'
import { authFixture, config, mockEndpoint, sse, textEvents } from './helpers.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

const requestBody = z.object({
  model: z.string(), store: z.boolean(), stream: z.boolean(), instructions: z.string(),
  input: z.array(z.record(z.string(), z.unknown())),
  reasoning: z.object({ effort: z.string() }).optional(),
  tools: z.array(z.record(z.string(), z.unknown())).optional(),
})
async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = []
  const assembler = new BlockAssembler()
  for await (const chunk of stream) { chunks.push(chunk); assembler.push(chunk) }
  return { chunks, assembler }
}

describe('native Codex HTTP/SSE protocol', () => {
  it('streams a host catalog model with local auth and reasoning', async () => {
    const model = 'gpt-6-sol'
    const auth = await authFixture()
    const endpoint = await mockEndpoint([sse(textEvents())])
    cleanups.push(auth.cleanup, endpoint.cleanup)
    const adapter = createCodexAdapter(config({ authFile: auth.path, baseURL: endpoint.url }))
    const { chunks, assembler } = await collect(adapter.stream({
      provider: 'codex-bridge', model, system: 'Test instructions',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      reasoningEffort: ReasoningEffortId('low'),
    }))
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'CODEX_BRIDGE_OK' }])
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(chunks.at(-2)?.type).toBe('usage')
    expect(chunks.at(-1)?.type).toBe('finish')
    expect(assembler.usage).toMatchObject({ inputTokens: 9, outputTokens: 3 })
    const request = endpoint.requests[0]!
    expect(request.path).toBe('/codex/responses')
    expect(request.headers.authorization).toMatch(/^Bearer /)
    expect(request.headers['chatgpt-account-id']).toBe('test-account')
    expect(request.headers['user-agent']).toBe(attributionHeaders()['user-agent'])
    expect(requestBody.parse(request.body)).toMatchObject({ model, store: false, stream: true, instructions: 'Test instructions', reasoning: { effort: 'low' } })
  })

  it('preserves tool arguments and encrypted reasoning when replaying a tool result', async () => {
    const auth = await authFixture()
    const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-encrypted-reasoning' }
    const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'echo', arguments: '{"value":"hello"}' }
    const events = [
      { type: 'response.created', response: { id: 'resp_1' } },
      { type: 'response.output_item.added', output_index: 0, item: reasoning },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"value":' },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '"hello"}' },
      { type: 'response.function_call_arguments.done', output_index: 1, arguments: call.arguments },
      { type: 'response.output_item.done', output_index: 1, item: call },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [reasoning, call], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } },
    ]
    const endpoint = await mockEndpoint([sse(events), sse(textEvents())])
    cleanups.push(auth.cleanup, endpoint.cleanup)
    const adapter = createCodexAdapter(config({ authFile: auth.path, baseURL: endpoint.url }))
    const user = { role: 'user', content: [{ type: 'text', text: 'Echo hello' }] } as const
    const tools = [{ name: 'echo', description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }]
    const first = await collect(adapter.stream({ provider: 'codex-bridge', model: 'gpt-6-sol', messages: [{ ...user, content: [...user.content] }], tools }))
    const assistant = first.assembler.message({ provider: 'codex-bridge', model: 'gpt-6-sol', replayState: first.assembler.replayState })
    const tool = assistant.content.find(block => block.type === 'tool-call')
    expect(tool).toMatchObject({ type: 'tool-call', name: 'echo', arguments: call.arguments })
    if (tool?.type !== 'tool-call') throw new Error('Missing tool call')
    expect(first.assembler.finish).toEqual({ kind: 'tool-calls' })
    const second = await collect(adapter.stream({
      provider: 'codex-bridge', model: 'gpt-6-sol', tools,
      messages: [{ ...user, content: [...user.content] }, assistant, createToolResultMessage({ callId: tool.id, content: [{ type: 'text', text: 'hello' }], isError: false })],
    }))
    expect(second.assembler.finish).toEqual({ kind: 'stop' })
    const body = requestBody.parse(endpoint.requests[1]!.body)
    expect(body.input).toContainEqual(expect.objectContaining({ type: 'reasoning', encrypted_content: 'opaque-encrypted-reasoning' }))
    const sentCall = body.input.find(item => item.type === 'function_call')
    expect(sentCall).toMatchObject({ arguments: call.arguments, name: 'echo' })
    expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: sentCall?.call_id, output: 'hello' }))
  })

  it('cancels an active network stream and reports aborted completion', async () => {
    const auth = await authFixture()
    const endpoint = await mockEndpoint([response => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"type":"response.created","response":{"id":"pending"}}\n\n')
    }])
    cleanups.push(auth.cleanup, endpoint.cleanup)
    const adapter = createCodexAdapter(config({ authFile: auth.path, baseURL: endpoint.url }))
    const controller = new AbortController()
    const pending = collect(adapter.stream({ provider: 'codex-bridge', model: 'gpt-6-sol', messages: [], signal: controller.signal }))
    await endpoint.received
    controller.abort()
    const result = await pending
    expect(result.assembler.finish).toMatchObject({ kind: 'aborted', failure: { code: 'ABORTED' } })
  })

  it('reports HTTP 429 as a provider failure without retrying inside the SDK', async () => {
    const auth = await authFixture()
    const endpoint = await mockEndpoint([response => response.writeHead(429, { 'content-type': 'application/json' }).end('{"error":{"message":"Rate limit exceeded","code":"rate_limit_exceeded"}}')])
    cleanups.push(auth.cleanup, endpoint.cleanup)
    const adapter = createCodexAdapter(config({ authFile: auth.path, baseURL: endpoint.url }))
    const result = await collect(adapter.stream({ provider: 'codex-bridge', model: 'gpt-6-sol', messages: [] }))
    expect(result.assembler.finish).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR', message: expect.stringContaining('usage limit') } })
    expect(endpoint.requests).toHaveLength(1)
  })
})
