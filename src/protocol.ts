/** Login progress messages shared by the Settings card and Host. */
import { z } from 'zod'

/** Bundle entry id used by the provider directory and keyed Settings card. */
export const SETTINGS_NAMESPACE = 'dsh-codex-bridge'

/** Endpoints served by the authenticated Connection Fetch registry. */
export const LOGIN_ENDPOINTS = ['status', 'login/start', 'login/cancel', 'login/url'] as const
/** Authenticated navigation route; the OAuth URL is omitted from status JSON. */
export const BROWSER_LOGIN_PATH = '/api/codex-bridge/login/open'
/** Restrict SDK authorization links to the OpenAI HTTPS authorization page. */
export const browserAuthorizationUrlSchema = z.string().max(16_384).url().refine(value => {
  let url: URL
  try { url = new URL(value) } catch (_error) { return false }
  return url.origin === 'https://auth.openai.com' && url.pathname === '/oauth/authorize' && !url.username && !url.password && !url.hash
})
/** Explicit, authenticated handoff to the pending HTTPS authorization page. */
export const browserLoginLinkSchema = z.strictObject({ url: browserAuthorizationUrlSchema })
/** Login choices supported by the SDK. */
export const loginMethodSchema = z.enum(['browser', 'device'])
/** Selected authorization flow. */
export type LoginMethod = z.infer<typeof loginMethodSchema>
/** Temporary device challenge; access tokens and OAuth state never cross the wire. */
export const deviceChallengeSchema = z.strictObject({
  verificationURI: z.literal('https://auth.openai.com/codex/device'),
  userCode: z.string().regex(/^[A-Z0-9]{3,16}(?:-[A-Z0-9]{3,16})?$/u),
})
/** Device code visible only while its login attempt is waiting. */
export type DeviceChallenge = z.infer<typeof deviceChallengeSchema>
/** Wire validation of login status and the current device challenge. */
export const loginViewSchema = z.strictObject({
  authenticated: z.boolean(),
  phase: z.enum(['idle', 'waiting', 'authorized', 'cancelled', 'failed']),
  credential: z.enum(['valid', 'missing', 'expired', 'invalid']),
  device: deviceChallengeSchema.optional(),
  browser: z.literal(true).optional(),
  failure: z.enum(['timeout', 'forbidden', 'failed']).optional(),
})
/** Safe Settings snapshot of the plugin's independent login. */
export type LoginView = z.infer<typeof loginViewSchema>
/** One supported Settings action. */
export type LoginEndpoint = typeof LOGIN_ENDPOINTS[number]

/** Absolute authenticated Fetch route for one Settings action.
 * @param endpoint - Supported login action.
 * @returns Connection-owned `/api` route.
 */
export function loginPath(endpoint: LoginEndpoint): string { return `/api/codex-bridge/${endpoint}` }
