/** Validated browser client for authenticated login actions. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { loginViewSchema, type LoginEndpoint, type LoginMethod, type LoginView } from '../protocol.js'

/** Login operations injected into the Settings card. */
export interface LoginApi {
  /** Read status or cancel; pending device instructions can appear in status. */
  call(endpoint: Exclude<LoginEndpoint, 'login/start'>, signal?: AbortSignal): Promise<LoginView>
  /** Begin the explicitly selected flow. */
  start(method: LoginMethod): Promise<LoginView>
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
  const invoke = async (endpoint: LoginEndpoint, payload: object, signal?: AbortSignal): Promise<LoginView> => {
    const result = await rpc.call('/api', `codex-bridge/${endpoint}`, payload, signal)
    if (!result.ok) throw new LoginActionError(result.error.code)
    return loginViewSchema.parse(result.value)
  }
  return { call: (endpoint, signal) => invoke(endpoint, {}, signal), start: method => invoke('login/start', { method }) }
}
