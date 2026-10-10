/** Public DSH adapter composition over pi-ai's native Codex provider. */
import { InMemoryCredentialStore, type Provider } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { PiAiAdapter, type PiAiAdapterOptions, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError, attributionHeaders, resolveRetryPolicy, type GenerateOptions, type PreparedAdapterCall } from '@deepseek-ai/dsh-llm'
import type { Config } from './config.js'
import { resolveCodexAccessToken } from './auth.js'

/** Reject options the subscription endpoint cannot enforce. */
function validateOptions(options: GenerateOptions): void {
  if (options.temperature !== undefined || options.maxTokens !== undefined) {
    throw new LlmError('Codex 订阅接口不支持 temperature 或 maxTokens，请移除这些生成设置。', 'UNSUPPORTED_OPTION')
  }
}

/** Preserve DSH's conversion and replay while enforcing Codex request options. */
class CodexAdapter extends PiAiAdapter {
  override stream(options: GenerateOptions) {
    validateOptions(options)
    return super.stream(options)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(provider, model, signal)
    return {
      model: prepared.model,
      stream: (options) => {
        validateOptions(options)
        return prepared.stream(options)
      },
    }
  }
}

/** Optional host services used for durable image inputs and replay diagnostics. */
export type HostHooks = Pick<PiAiAdapterOptions, 'resolveAttachments' | 'resolveImageAccess' | 'onReplayDegrade'>

/** Construct one immutable provider route without reading or copying credentials.
 * @param config - Cordis-validated deployment settings.
 * @param hooks - optional DSH attachment, filesystem and diagnostic integrations.
 * @returns adapter with the SDK Codex catalog and per-request local authentication.
 */
export function createCodexAdapter(config: Config, hooks: HostHooks = {}): PiAiAdapter {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(config.provider)) {
    throw new LlmError('provider 必须是小写字母、数字、下划线或连字符组成的路由名。', 'INVALID_CONFIG')
  }
  const endpoint = new URL(config.baseURL)
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !['http:', 'https:'].includes(endpoint.protocol)) {
    throw new LlmError('baseURL 必须是无凭据、查询参数和片段的 HTTP(S) URL。', 'INVALID_CONFIG')
  }
  const native = openaiCodexProvider()
  const catalog = native.getModels()
  const selected = config.models.length ? config.models.map((id) => {
    const found = catalog.find(model => model.id === id)
    if (!found) throw new LlmError(`Codex SDK 未收录模型 ${id}，请检查 models 或升级宿主 pi-ai。`, 'INVALID_CONFIG')
    return found
  }) : catalog
  if (new Set(selected.map(model => model.id)).size !== selected.length) {
    throw new LlmError('models 中包含重复的模型 ID。', 'INVALID_CONFIG')
  }
  const models = selected.map(model => ({ ...model, provider: config.provider, baseUrl: config.baseURL }))
  const provider: Provider<'openai-codex-responses'> = {
    ...native,
    id: config.provider,
    name: config.displayName,
    baseUrl: config.baseURL,
    getModels: () => models,
    streamSimple: (model, context, options) => native.streamSimple(model, context, {
      ...options,
      fetch: (input, init) => {
        // Codex's SDK overwrites User-Agent after merging option headers.
        const headers = new Headers(init?.headers)
        for (const [key, value] of Object.entries(attributionHeaders())) headers.set(key, value)
        return (options?.fetch ?? globalThis.fetch)(input, { ...init, headers })
      },
    }),
    // The request's validated OAuth access token is supplied as pi-ai's key override.
    // Omitting OAuth methods prevents the SDK from rotating ambient Codex credentials.
    auth: { apiKey: {
      name: 'Codex auth.json',
      resolve: ({ credential }) => Promise.resolve(credential?.key
        ? { auth: { apiKey: credential.key }, source: 'Codex auth.json' }
        : undefined),
    } },
  }
  const profile: ResolvedPiAiProviderProfile = {
    provider: config.provider,
    displayName: config.displayName,
    baseURL: config.baseURL,
    piProvider: provider,
    transport: 'sse',
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    maxRequestImageBytes: config.maxRequestImageBytes,
    requestImagePixelBudget: config.requestImagePixelBudget,
    requestImageMaxBytes: config.requestImageMaxBytes,
    retryPolicy: resolveRetryPolicy(undefined, config.provider),
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
  }
  const profiles = new Map([[config.provider, profile]])
  return new CodexAdapter({
    profiles: () => profiles,
    resolveApiKey: () => resolveCodexAccessToken(config.authFile, undefined, config.authRefreshTimeoutMs),
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
    ...hooks,
  })
}
