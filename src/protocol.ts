/** Login progress messages shared by the Settings card and Host. */
import { z } from 'zod'

/** Endpoints served by the authenticated Connection Fetch registry. */
export const LOGIN_ENDPOINTS = ['status', 'login/start', 'login/cancel'] as const
/** Login choices supported by the CLI. */
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
  failure: z.enum(['executable', 'timeout', 'failed']).optional(),
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
