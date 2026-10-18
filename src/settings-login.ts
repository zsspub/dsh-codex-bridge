/** Authenticated Settings actions sharing the slash command's login owner. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { readCodexAccessToken } from './auth.js'
import type { Config } from './config.js'
import type { CodexLogin } from './login.js'
import { BROWSER_LOGIN_PATH, LOGIN_ENDPOINTS, browserLoginLinkSchema, loginMethodSchema, loginPath, type LoginEndpoint, type LoginView } from './protocol.js'

const emptyPayload = z.strictObject({})
const startPayload = z.strictObject({ method: loginMethodSchema })

/** Read credential validity without disclosing or changing cached tokens.
 * @param config - Plugin-owned cache path.
 * @param login - Shared SDK authorization owner.
 * @returns Progress, temporary device challenge and cache validity.
 */
export async function loginView(config: Config, login: CodexLogin): Promise<LoginView> {
  let credential: LoginView['credential'] = 'valid'
  try { await readCodexAccessToken(config.authFile) } catch (error) {
    credential = error instanceof LlmError && error.code === 'CODEX_AUTH_MISSING' ? 'missing'
      : error instanceof LlmError && error.code === 'CODEX_AUTH_EXPIRED' ? 'expired' : 'invalid'
  }
  return { authenticated: credential === 'valid', credential, phase: login.status, ...login.device ? { device: login.device } : {}, ...login.browserURL ? { browser: true } : {}, ...login.failureKind ? { failure: login.failureKind } : {} }
}

/** Open the pending authorization URL after Connection authenticates navigation.
 * @param login - Owner of the currently pending browser login.
 * @returns No-store redirect, or conflict when that attempt has settled.
 */
export function browserLoginRedirect(login: CodexLogin): Response {
  const url = login.browserURL
  return new Response(null, {
    status: url ? 302 : 409,
    headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...url ? { location: url } : {} },
  })
}

/** Handle one authenticated Fetch request with Connection's RPC envelope.
 * @param request - Request admitted by Connection's shared `/api` bridge.
 * @param endpoint - Exact action selected by its registered route.
 * @param config - Plugin-owned cache and login settings.
 * @param login - Shared SDK authorization owner.
 * @returns Correlated response containing only safe state or a generic failure.
 */
export async function handleLoginRequest(request: Request, endpoint: LoginEndpoint, config: Config, login: CodexLogin): Promise<Response> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') return new Response(null, { status: 415 })
  let body: unknown
  try { body = await request.json() } catch (_error) { return new Response(null, { status: 400 }) }
  // Headless profiles can omit the optional Connection package entirely.
  const { clientRequestSchema } = await import('@deepseek-ai/dsh-client-connection')
  const parsed = clientRequestSchema.safeParse(body)
  if (!parsed.success || parsed.data.method !== `codex-bridge/${endpoint}`) {
    return new Response(null, { status: 400 })
  }
  const payload = (endpoint === 'login/start' ? startPayload : emptyPayload).safeParse(parsed.data.payload)
  if (!payload.success) return new Response(null, { status: 400 })
  let result: { ok: true; value: LoginView | { url: string } } | { ok: false; error: { code: string; message: string; details: object } }
  try {
    if (endpoint === 'login/start') await login.start(startPayload.parse(payload.data).method)
    if (endpoint === 'login/cancel') await login.cancel()
    if (endpoint === 'login/url') {
      if (!login.browserURL) throw new LlmError('Codex 网页登录尚未启动或已结束。', 'CODEX_LOGIN_INACTIVE')
      result = { ok: true, value: browserLoginLinkSchema.parse({ url: login.browserURL }) }
    } else result = { ok: true, value: await loginView(config, login) }
  } catch (error) {
    result = { ok: false, error: { code: error instanceof LlmError ? error.code : 'CODEX_LOGIN_FAILED', message: 'Codex login did not complete', details: {} } }
  }
  return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result }, { headers: { 'cache-control': 'no-store' } })
}

/** Register exact routes behind Connection's existing authentication checks.
 * @param ctx - Child context with Connection available.
 * @param config - Plugin-owned settings.
 * @param login - Shared SDK authorization owner.
 */
export function registerSettingsLogin(ctx: Context, config: Config, login: CodexLogin): void {
  ctx.connection.fetch.register({ path: BROWSER_LOGIN_PATH, methods: ['GET'], requestBody: 'buffered', fetch: async () => browserLoginRedirect(login) })
  for (const endpoint of LOGIN_ENDPOINTS) ctx.connection.fetch.register({
    path: loginPath(endpoint), methods: ['POST'], requestBody: 'buffered',
    fetch: request => handleLoginRequest(request, endpoint, config, login),
  })
}
