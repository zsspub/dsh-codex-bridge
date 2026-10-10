/** ChatGPT OAuth through the SDK; no CLI executable or subprocess is required. */
import { basename, isAbsolute } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { AuthPrompt } from '@earendil-works/pi-ai'
import { prepareAuthDirectory, saveCodexCredential } from './auth.js'
import { codexOAuth } from './oauth.js'
import type { Config } from './config.js'
import { browserAuthorizationUrlSchema, deviceChallengeSchema, type DeviceChallenge, type LoginMethod } from './protocol.js'

/** Safe progress exposed to humans, excluding raw SDK errors and credentials. */
export type CodexLoginStatus = 'idle' | 'waiting' | 'authorized' | 'cancelled' | 'failed'

/** Wait for OAuth callbacks while honoring both attempt and SDK prompt cancellation. */
function waitForCancellation(signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) { reject(new Error('Login cancelled')); return }
    signal.addEventListener('abort', () => reject(new Error('Login cancelled')), { once: true })
  })
}

/** One plugin instance owns one SDK authorization attempt and drains it on disposal. */
export class CodexLogin {
  private active: { controller: AbortController; done: Promise<void> } | undefined
  private disposed = false
  private current: CodexLoginStatus = 'idle'
  private failure: LlmError | undefined
  private deviceChallenge: DeviceChallenge | undefined
  private browserAuthorizationURL: string | undefined

  /** @param config - Dedicated credential path and OAuth deadline. */
  constructor(private readonly config: Config) {
    if (!isAbsolute(config.authFile) || basename(config.authFile) !== 'auth.json') {
      throw new LlmError('authFile 必须是插件专用目录中的绝对路径 auth.json。', 'CODEX_LOGIN_CONFIG')
    }
  }

  /** @returns Safe lifecycle discriminator. */
  get status(): CodexLoginStatus { return this.current }
  /** @returns Pending one-time device code, withdrawn when the attempt settles. */
  get device(): DeviceChallenge | undefined { return this.current === 'waiting' ? this.deviceChallenge : undefined }
  /** @returns Validated OpenAI URL for authenticated navigation while waiting. */
  get browserURL(): string | undefined { return this.current === 'waiting' ? this.browserAuthorizationURL : undefined }
  /** @returns Recovery category, excluding SDK errors and credential bytes. */
  get failureKind(): 'timeout' | 'forbidden' | 'failed' | undefined {
    if (this.current !== 'failed') return undefined
    if (this.failure?.code === 'CODEX_LOGIN_TIMEOUT') return 'timeout'
    if (this.failure?.code === 'CODEX_LOGIN_FORBIDDEN') return 'forbidden'
    return 'failed'
  }

  /** Begin the selected SDK authorization flow.
   * @param method - Browser or device authorization.
   * @returns Once human authorization instructions are available.
   */
  async start(method: LoginMethod = 'browser'): Promise<void> {
    if (this.disposed) throw new LlmError('Codex 登录插件已卸载。', 'CODEX_LOGIN_DISPOSED')
    if (this.active) throw new LlmError('Codex 登录正在进行，请先完成或取消。', 'CODEX_LOGIN_BUSY')
    const controller = new AbortController()
    const deadline = AbortSignal.timeout(this.config.loginTimeoutMs)
    const signal = AbortSignal.any([controller.signal, deadline])
    const ready = Promise.withResolvers<void>()
    this.current = 'waiting'
    this.failure = undefined
    this.deviceChallenge = undefined
    this.browserAuthorizationURL = undefined
    const done = this.run(method, signal, ready.resolve).then(() => {
      this.current = 'authorized'
      ready.resolve()
    }, (error: unknown) => {
      this.current = controller.signal.aborted ? 'cancelled' : 'failed'
      const forbidden = error instanceof Error && /(?:status|failed|HTTP)[^\n]{0,40}\b403\b|\b403\s+Forbidden/iu.test(error.message)
      this.failure = new LlmError(
        controller.signal.aborted ? 'Codex 登录已取消。' : deadline.aborted ? 'Codex 登录已超时，请重新授权。'
          : forbidden ? 'OpenAI 认证接口拒绝请求（HTTP 403），请检查服务器网络。' : 'Codex 登录未完成，请检查网络和回调端口 1455 后重试。',
        controller.signal.aborted ? 'CODEX_LOGIN_CANCELLED' : deadline.aborted ? 'CODEX_LOGIN_TIMEOUT'
          : error instanceof LlmError && error.code === 'CODEX_LOGIN_CONFIG' ? 'CODEX_LOGIN_CONFIG' : forbidden ? 'CODEX_LOGIN_FORBIDDEN' : 'CODEX_LOGIN_FAILED',
      )
      ready.reject(this.failure)
    }).finally(() => { this.active = undefined; this.deviceChallenge = undefined; this.browserAuthorizationURL = undefined })
    this.active = { controller, done }
    await ready.promise
  }

  /** @returns Once the current attempt settles; throws only redacted failures. */
  async wait(): Promise<void> { await this.active?.done; if (this.failure) throw this.failure }
  /** @returns Once cancellation has drained SDK requests and callback listeners. */
  async cancel(): Promise<void> { const running = this.active; running?.controller.abort(); await running?.done }
  /** @returns Once this instance owns no pending OAuth attempt. */
  async dispose(): Promise<void> { this.disposed = true; await this.cancel() }

  private async run(method: LoginMethod, signal: AbortSignal, onReady: () => void): Promise<void> {
    await prepareAuthDirectory(this.config.authFile)
    signal.throwIfAborted()
    const credential = await codexOAuth().login({
      signal,
      prompt: (prompt: AuthPrompt) => {
        if (prompt.type === 'select') return Promise.resolve(method === 'device' ? 'device_code' : 'browser')
        if (prompt.type === 'manual_code') return waitForCancellation(prompt.signal ? AbortSignal.any([signal, prompt.signal]) : signal)
        return Promise.reject(new Error('Unsupported SDK authentication prompt'))
      },
      notify: event => {
        signal.throwIfAborted()
        if (event.type === 'auth_url' && method === 'browser') {
          this.browserAuthorizationURL = browserAuthorizationUrlSchema.parse(event.url)
          onReady()
        } else if (event.type === 'device_code' && method === 'device') {
          this.deviceChallenge = deviceChallengeSchema.parse({ verificationURI: event.verificationUri, userCode: event.userCode })
          onReady()
        }
      },
    })
    signal.throwIfAborted()
    await saveCodexCredential(this.config.authFile, credential, signal)
  }
}
