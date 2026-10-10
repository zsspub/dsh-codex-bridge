/** Plugin-owned SDK authentication, provider identity and request limits. */
import schema from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Deployment settings validated by Cordis before registering the provider. */
export interface Config {
  /** Unique DSH provider route; independent from the built-in openai-codex route. */
  provider: string
  /** Provider name displayed in the model selector and Settings card. */
  displayName: string
  /** Plugin-owned auth.json; never shared with the machine's Codex login. */
  authFile: string
  /** Maximum duration of either login flow. */
  loginTimeoutMs: number
  /** Deadline for SDK token refresh requests. */
  authRefreshTimeoutMs: number
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

/** Shared field definitions for plain configuration and the live plugin schema. */
export const configFields = {
  provider: schema.string().default('codex-bridge'),
  displayName: schema.string().default('Codex Bridge'),
  authFile: schema.string().default(defaultAuthFile()),
  loginTimeoutMs: schema.number().step(1).min(1).max(2_147_483_647).default(300_000),
  authRefreshTimeoutMs: schema.number().step(1).min(1).max(2_147_483_647).default(30_000),
  models: schema.array(schema.string()).default([]),
  baseURL: schema.string().default('https://chatgpt.com/backend-api'),
  streamIdleTimeoutMs: schema.number().min(1).max(2_147_483_647).default(120_000),
  maxRequestImageBytes: schema.number().step(1).min(1).default(20 * 1024 * 1024),
  requestImagePixelBudget: schema.number().step(1).min(1).default(16_000_000),
  requestImageMaxBytes: schema.number().step(1).min(1).default(4 * 1024 * 1024),
}

/** Plain configuration for adapters and standalone login owners. */
export const Config: schema<Partial<Config>, Config> = schema.object(configFields)
