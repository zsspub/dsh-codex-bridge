/** Validated browser client for authenticated login actions. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { browserLoginLinkSchema, loginViewSchema, type LoginEndpoint, type LoginMethod, type LoginView } from '../protocol.js'

/** Login operations injected into the Settings card. */
export interface LoginApi {
  /** Read status or cancel; pending device instructions can appear in status. */
  call(endpoint: Exclude<LoginEndpoint, 'login/start' | 'login/url'>, signal?: AbortSignal): Promise<LoginView>
  /** Begin the explicitly selected flow. */
  start(method: LoginMethod): Promise<LoginView>
  /** Resolve a validated HTTPS URL only during the pending browser flow. */
  browserURL(signal?: AbortSignal): Promise<string>
}
/** Safe error exposing only a recovery category. */
export class LoginActionError extends Error {
  /** @param code - Server failure category, excluding error details. */
  constructor(readonly code: string) { super('Codex login action failed') }
}

/** Bind the Host channel and validate each wire result.
 * @param rpc - Connection's transport-independent caller.
 * @returns Shared caller for status, start and cancellation.
 */
export function createLoginApi(rpc: ClientConnectionRpc): LoginApi {
  const invoke = async (endpoint: LoginEndpoint, payload: object, signal?: AbortSignal): Promise<unknown> => {
    const result = await rpc.call('/api', `codex-bridge/${endpoint}`, payload, signal)
    if (!result.ok) throw new LoginActionError(result.error.code)
    return result.value
  }
  return {
    call: async (endpoint, signal) => loginViewSchema.parse(await invoke(endpoint, {}, signal)),
    start: async method => loginViewSchema.parse(await invoke('login/start', { method })),
    browserURL: async signal => browserLoginLinkSchema.parse(await invoke('login/url', {}, signal)).url,
  }
}
