/** Plugin-owned CLI authentication, provider identity and request limits. */
import schema from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Deployment settings validated by Cordis before registering the provider. */
export interface Config {
  /** Unique DSH provider route; independent from the built-in openai-codex route. */
  provider: string
  /** Provider name displayed in the model selector. */
  displayName: string
  /** Plugin-owned auth.json; its parent is passed to the CLI as CODEX_HOME. */
  authFile: string
  /** Codex CLI executable, resolved through PATH unless an absolute path is supplied. */
  codexCommand: string
  /** Maximum duration of either login flow. */
  loginTimeoutMs: number
  /** Grace period before forcibly terminating a cancelled CLI process. */
  loginKillTimeoutMs: number
  /** Native Codex model IDs to advertise; an empty array selects the SDK catalog. */
  models: string[]
  /** Optional Codex-compatible endpoint; credentials are sent to this endpoint. */
  baseURL: string
  /** Maximum time without a stream event before aborting the request. */
  streamIdleTimeoutMs: number
  /** Per-request base64 image payload limit. */
  maxRequestImageBytes: number
  /** Total request-image pixel budget used by the DSH image resolver. */
  requestImagePixelBudget: number
  /** Request-image byte target used by the DSH image resolver. */
  requestImageMaxBytes: number
}

/** Resolve the plugin's cache without consulting the machine's CODEX_HOME.
 * @returns Auth file below the resolved DSH home.
 */
export function defaultAuthFile(): string {
  return dshHomePath('plugins', 'dsh-codex-bridge', 'codex', 'auth.json')
}

/** Cordis schema; credentials never appear in plugin configuration. */
export const Config: schema<Partial<Config>, Config> = schema.object({
  provider: schema.string().default('codex-bridge'),
  displayName: schema.string().default('Codex（CLI 网页登录）'),
  authFile: schema.string().default(defaultAuthFile()),
  codexCommand: schema.string().default('codex'),
  loginTimeoutMs: schema.number().step(1).min(1).max(2_147_483_647).default(300_000),
  loginKillTimeoutMs: schema.number().step(1).min(1).max(2_147_483_647).default(2_000),
  models: schema.array(schema.string()).default([]),
  baseURL: schema.string().default('https://chatgpt.com/backend-api'),
  streamIdleTimeoutMs: schema.number().min(1).max(2_147_483_647).default(120_000),
  maxRequestImageBytes: schema.number().step(1).min(1).default(20 * 1024 * 1024),
  requestImagePixelBudget: schema.number().step(1).min(1).default(16_000_000),
  requestImageMaxBytes: schema.number().step(1).min(1).default(4 * 1024 * 1024),
})
