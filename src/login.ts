/** ChatGPT login delegated to Codex CLI with an isolated file credential store. */
import { spawn } from 'node:child_process'
import { chmod, mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { readCodexAccessToken } from './auth.js'
import type { Config } from './config.js'
import { deviceChallengeSchema, type DeviceChallenge, type LoginMethod } from './protocol.js'

/** Safe progress exposed to the human; CLI output and tokens never appear here. */
export type CodexLoginStatus = 'idle' | 'waiting' | 'authorized' | 'cancelled' | 'failed'

/** One plugin instance owns at most one CLI login and drains it on disposal. */
export class CodexLogin {
  private active: { controller: AbortController; done: Promise<void> } | undefined
  private disposed = false
  private current: CodexLoginStatus = 'idle'
  private failure: LlmError | undefined
  private deviceChallenge: DeviceChallenge | undefined

  /** @param config - Executable, isolated cache and process deadlines. */
  constructor(private readonly config: Config) {
    if (!isAbsolute(config.authFile) || basename(config.authFile) !== 'auth.json') {
      throw new LlmError('authFile 必须是插件专用目录中的绝对路径 auth.json。', 'CODEX_LOGIN_CONFIG')
    }
    if (config.codexCommand.trim().length === 0) {
      throw new LlmError('codexCommand 不能为空。', 'CODEX_LOGIN_CONFIG')
    }
  }

  /** Current attempt status, excluding all credential bytes.
   * @returns Safe lifecycle discriminator.
   */
  get status(): CodexLoginStatus { return this.current }

  /** Pending device authorization details, withdrawn when the attempt settles.
   * @returns One-time code and the fixed OpenAI verification page, or undefined.
   */
  get device(): DeviceChallenge | undefined { return this.current === 'waiting' ? this.deviceChallenge : undefined }

  /** Redacted failure category for the Settings dictionary.
   * @returns Recovery category, excluding process output and credentials.
   */
  get failureKind(): 'executable' | 'timeout' | 'failed' | undefined {
    if (this.current !== 'failed') return undefined
    if (this.failure?.code === 'CODEX_LOGIN_EXECUTABLE') return 'executable'
    if (this.failure?.code === 'CODEX_LOGIN_TIMEOUT') return 'timeout'
    return 'failed'
  }

  /** Begin the selected authorization flow.
   * @param method - Browser flow by default; device flow publishes its one-time code.
   * @returns Once authorization instructions are available; completion is observed with wait().
   * @throws When busy, disposed, or the CLI cannot start authorization.
   */
  async start(method: LoginMethod = 'browser'): Promise<void> {
    if (this.disposed) throw new LlmError('Codex 登录插件已卸载。', 'CODEX_LOGIN_DISPOSED')
    if (this.active) throw new LlmError('Codex 登录正在进行，请先完成或取消。', 'CODEX_LOGIN_BUSY')
    const controller = new AbortController()
    const ready = Promise.withResolvers<void>()
    this.current = 'waiting'
    this.failure = undefined
    this.deviceChallenge = undefined
    const done = this.run(method, controller.signal, ready.resolve).then(() => {
      this.current = 'authorized'
    }, (error: unknown) => {
      this.current = controller.signal.aborted ? 'cancelled' : 'failed'
      this.failure = error instanceof LlmError ? error : new LlmError(
        'Codex 登录未完成，请检查浏览器、网络和回调端口 1455 后重试。', 'CODEX_LOGIN_FAILED',
      )
      ready.reject(this.failure)
    }).finally(() => { this.active = undefined; this.deviceChallenge = undefined })
    this.active = { controller, done }
    await ready.promise
  }

  /** Wait for CLI exit and verify its independent ChatGPT cache.
   * @returns Once the attempt settles successfully.
   * @throws A redacted login error on failure or cancellation.
   */
  async wait(): Promise<void> {
    await this.active?.done
    if (this.failure) throw this.failure
  }

  /** Cancel the current attempt and wait until its child process exits.
   * @returns Once the login child and its pipes have closed.
   */
  async cancel(): Promise<void> {
    const running = this.active
    running?.controller.abort()
    await running?.done
  }

  /** Withdraw future attempts and drain the current one before plugin unload.
   * @returns Once no login process belongs to this instance.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.cancel()
  }

  /** Run only the CLI login command; raw child output stays in memory. */
  private async run(method: LoginMethod, signal: AbortSignal, onReady: () => void): Promise<void> {
    const home = dirname(this.config.authFile)
    await mkdir(home, { recursive: true, mode: 0o700 })
    const canonical = await realpath(home)
    const personalHomes = [resolve(homedir(), '.codex'), process.env.CODEX_HOME].filter(
      (value): value is string => Boolean(value),
    )
    for (const personal of personalHomes) {
      let candidate = resolve(personal)
      try { candidate = await realpath(candidate) } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      if (canonical === candidate) {
        throw new LlmError('authFile 指向本机 Codex 目录，请使用插件专用目录。', 'CODEX_LOGIN_CONFIG')
      }
    }
    await chmod(home, 0o700)
    signal.throwIfAborted()
    const environment: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (!/KEY|SECRET|TOKEN|PASSWORD/i.test(key) && !key.startsWith('CODEX_')) environment[key] = value
    }
    environment.CODEX_HOME = home
    // Preserve the configured certificate path without inheriting ambient authentication.
    if (process.env.CODEX_CA_CERTIFICATE) environment.CODEX_CA_CERTIFICATE = process.env.CODEX_CA_CERTIFICATE
    const child = spawn(this.config.codexCommand, [
      'login', ...method === 'device' ? ['--device-auth'] : [], '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"',
    ], { cwd: home, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const deadline = AbortSignal.timeout(this.config.loginTimeoutMs)
    const cancellation = AbortSignal.any([signal, deadline])
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let started = false
    let output = ''
    const inspect = (chunk: Buffer): void => {
      if (started) return
      output = (output + chunk.toString('utf8')).slice(-65_536)
      const plain = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/gu, '')
      if (method === 'device') {
        const code = /Enter this one-time code[^\n]*\n[ \t]*([A-Z0-9]{3,16}(?:-[A-Z0-9]{3,16})?)[ \t]*\n/u.exec(plain)?.[1]
        const challenge = deviceChallengeSchema.safeParse({ verificationURI: /https:\/\/auth\.openai\.com\/codex\/device(?=\s|$)/u.exec(plain)?.[0], userCode: code })
        if (!challenge.success) return
        this.deviceChallenge = challenge.data
      } else if (!/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+/u.test(plain)) return
      started = true
      output = ''
      onReady()
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    const stop = (): void => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => { child.kill('SIGKILL') }, this.config.loginKillTimeoutMs)
    }
    cancellation.addEventListener('abort', stop, { once: true })
    if (cancellation.aborted) stop()
    try {
      const result = await new Promise<{ code: number | null; error?: Error }>((complete) => {
        let spawnError: Error | undefined
        child.once('error', (error) => { spawnError = error })
        child.once('close', code => complete({ code, error: spawnError }))
      })
      if (signal.aborted) throw new LlmError('Codex 登录已取消。', 'CODEX_LOGIN_CANCELLED')
      if (deadline.aborted) throw new LlmError('Codex 登录已超时，请重新运行 /codex-login。', 'CODEX_LOGIN_TIMEOUT')
      if (result.error) throw new LlmError('无法启动 Codex CLI，请检查 codexCommand。', 'CODEX_LOGIN_EXECUTABLE')
      if (result.code !== 0) throw new LlmError(
        'Codex 登录未完成，请检查浏览器、网络和回调端口 1455 后重试。', 'CODEX_LOGIN_FAILED',
      )
      await readCodexAccessToken(this.config.authFile)
      // An already-authorized CLI can exit without printing a new URL.
      onReady()
    } finally {
      cancellation.removeEventListener('abort', stop)
      if (killTimer) clearTimeout(killTimer)
      child.stdout.off('data', inspect)
      child.stderr.off('data', inspect)
      output = ''
    }
  }
}
