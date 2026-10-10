/** Explicit real-account acceptance; prints only synthetic response and usage metadata. */
import { Config, createCodexAdapter } from '../lib/index.js'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

const config = Config({ ...(process.env.CODEX_AUTH_FILE ? { authFile: process.env.CODEX_AUTH_FILE } : {}) })
const adapter = createCodexAdapter(config)
const model = process.env.CODEX_TEST_MODEL || 'gpt-6-luna'
let text = ''
let usage
let finish
for await (const chunk of adapter.stream({
  provider: config.provider,
  model,
  reasoningEffort: ReasoningEffortId('low'),
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly CODEX_BRIDGE_OK and nothing else.' }] }],
  signal: AbortSignal.timeout(45_000),
})) {
  if (chunk.type === 'text-delta') text += chunk.text
  if (chunk.type === 'usage') usage = chunk.usage
  if (chunk.type === 'finish') finish = chunk.reason
}
if (finish?.kind !== 'stop' || text.trim() !== 'CODEX_BRIDGE_OK') {
  console.error(JSON.stringify({ ok: false, model, finish, text }))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ ok: true, provider: config.provider, model, text, usage }))
}
