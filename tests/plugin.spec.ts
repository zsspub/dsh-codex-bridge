import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as plugin from '../src/index.js'
import { authFixture, config } from './helpers.js'
import { cliFixture } from './cli-fixture.js'

describe('Cordis model registration', () => {
  it('reads the latest timeout when the next login starts without replacing the provider fiber', async () => {
    const fixture = await cliFixture('wait')
    const ctx = new Context()
    const runtime = await ctx.plugin(LlmRuntime)
    const connection = await ctx.plugin(child => { new HostConnectionService(child, [], {} as ConstructorParameters<typeof HostConnectionService>[2]) })
    const settings = config({ authFile: fixture.authFile, codexCommand: fixture.executable, loginTimeoutMs: 10_000 })
    let timeoutMs = settings.loginTimeoutMs
    const fiber = await ctx.plugin({ inject: plugin.inject, apply: (child: Context) => plugin.apply(child, {
      ...settings, loginTimeoutMs: { get: () => timeoutMs },
    }) })
    const uid = fiber.uid
    const shared = ctx.connection.createSharedFetchHandler('/api')
    const request = async (endpoint: 'login/start' | 'login/cancel') => (await shared.fetch(new Request(`http://localhost/api/codex-bridge/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'live-timeout', method: `codex-bridge/${endpoint}`, payload: endpoint === 'login/start' ? { method: 'browser' } : {} }),
    }))).json()
    try {
      expect((await request('login/start')).result.value.phase).toBe('waiting')
      await request('login/cancel')
      timeoutMs = 1
      expect(fiber.uid).toBe(uid)
      expect((await request('login/start')).result.error.code).toBe('CODEX_LOGIN_TIMEOUT')
      expect(ctx.llm.listProviders()).toHaveLength(1)
    } finally { await fiber.dispose(); await connection.dispose(); await runtime.dispose(); await fixture.cleanup() }
  })

  it('registers authenticated Settings routes only with Connection and withdraws them on unload', async () => {
    const fixture = await authFixture()
    const ctx = new Context()
    const runtime = await ctx.plugin(LlmRuntime)
    // This registry test never admits a browser; authentication is exercised by the built Web smoke.
    const connection = await ctx.plugin(child => { new HostConnectionService(child, [], {} as ConstructorParameters<typeof HostConnectionService>[2]) })
    const fiber = await ctx.plugin(plugin, config({ authFile: fixture.path }))
    const shared = ctx.connection.createSharedFetchHandler('/api')
    const request = () => new Request('http://localhost/api/codex-bridge/status', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'settings-test', method: 'codex-bridge/status', payload: {} }),
    })
    try {
      expect((await (await shared.fetch(request())).json()).result.value.authenticated).toBe(true)
      await fiber.dispose()
      expect((await shared.fetch(request())).status).toBe(404)
    } finally { await fiber.dispose(); await connection.dispose(); await runtime.dispose(); await fixture.cleanup() }
  })

  it('advertises native model capabilities and removes only its route on disposal', async () => {
    const ctx = new Context()
    const runtime = await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(plugin, config())
    expect(ctx.llm.listProviders()).toContainEqual({ id: 'codex-bridge', name: 'Codex Bridge' })
    expect(ctx.llm.listConfigurableProviders()).toContainEqual({
      provider: 'codex-bridge', displayName: 'Codex Bridge', settingsNs: 'dsh-codex-bridge', settingsPath: [],
    })
    const models = await ctx.llm.listModels('codex-bridge')
    expect(models.some(model => model.id === 'gpt-6-sol')).toBe(true)
    expect(models.some(model => model.id === 'gpt-6.1-sol')).toBe(true)
    expect(models.every(model => model.provider === 'codex-bridge')).toBe(true)
    const model = await ctx.llm.resolveModelInfo('codex-bridge', 'gpt-6.1-sol')
    expect(model.inputModalities).toContain('image')
    expect(model.reasoning?.efforts.map(effort => effort.id)).toContain('high')
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    await runtime.dispose()
  })

  it('keeps the Settings card address when the provider route and label are configured', async () => {
    const ctx = new Context()
    const runtime = await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(plugin, config({ provider: 'team-codex', displayName: 'Team Codex' }))
    try {
      expect(ctx.llm.listConfigurableProviders()).toEqual([{
        provider: 'team-codex', displayName: 'Team Codex', settingsNs: 'dsh-codex-bridge', settingsPath: [],
      }])
      expect(ctx.llm.listProviders()).toEqual([{ id: 'team-codex', name: 'Team Codex' }])
    } finally { await fiber.dispose(); await runtime.dispose() }
  })

  it('rejects unknown and duplicate configured models before registering a route', () => {
    expect(() => plugin.createCodexAdapter(config({ models: ['unavailable-model'] }))).toThrow('未收录')
    expect(() => plugin.createCodexAdapter(config({ models: ['gpt-6-sol', 'gpt-6-sol'] }))).toThrow('重复')
  })

  it('registers the human login entry and removes it when the plugin unloads', async () => {
    const ctx = new Context()
    const runtime = await ctx.plugin(LlmRuntime)
    const commands = await ctx.plugin(CommandRuntime)
    const fiber = await ctx.plugin(plugin, config())
    // Discovery only reads the agent context; no agent loop is launched.
    const agent = { ctx } as Agent
    expect(ctx.commands.list(agent)).toContainEqual({
      definitionId: 'dsh-codex-bridge/login', name: 'codex-login',
      description: '在浏览器登录 Codex，使用插件专用凭据', input: { hint: '[status|cancel]' },
    })
    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual([])
    await commands.dispose()
    await runtime.dispose()
  })

  it('rejects a URL containing credentials or a non-HTTP protocol', () => {
    expect(() => plugin.createCodexAdapter(config({ baseURL: 'https://user:secret@example.com' }))).toThrow('baseURL')
    expect(() => plugin.createCodexAdapter(config({ baseURL: 'file:///tmp/model' }))).toThrow('baseURL')
  })

  it('rejects unsupported options for direct and prepared calls before reading credentials', async () => {
    const adapter = plugin.createCodexAdapter(config({ authFile: '/missing/never-read' }))
    const options = { provider: 'codex-bridge', model: 'gpt-6-sol', messages: [], temperature: 0.5 }
    expect(() => adapter.stream(options)).toThrow('temperature')
    const prepared = await adapter.prepareCall('codex-bridge', 'gpt-6-sol')
    expect(() => prepared.stream({ ...options, temperature: undefined, maxTokens: 100 })).toThrow('maxTokens')
  })
})
