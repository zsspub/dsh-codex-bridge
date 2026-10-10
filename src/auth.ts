/** Plugin-owned OAuth storage with read-only compatibility for earlier CLI caches. */
import { chmod, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { codexOAuth } from './oauth.js'

const oauthCredential = z.object({ type: z.literal('oauth'), access: z.string().min(1), refresh: z.string().min(1), expires: z.number().finite().positive() })
const ownedCache = z.strictObject({ version: z.literal(1), owner: z.literal('dsh-codex-bridge'), credential: oauthCredential })

const loginCache = z.object({
  auth_mode: z.literal('chatgpt').optional(),
  tokens: z.object({ access_token: z.string().min(1) }),
})
const tokenClaims = z.object({
  exp: z.number().int().positive(),
  'https://api.openai.com/auth': z.object({ chatgpt_account_id: z.string().min(1) }),
})
const MAX_AUTH_FILE_BYTES = 1024 * 1024

/** Read credential bytes with file-size checks and redacted parse failures. */
async function readCache(authFile: string): Promise<unknown> {
  let source: string
  try {
    const file = await open(authFile, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > MAX_AUTH_FILE_BYTES) {
        throw new Error('Invalid Codex cache size or file type')
      }
      source = await file.readFile('utf8')
    } finally {
      await file.close()
    }
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    throw new LlmError(
      missing
        ? 'Codex 尚未登录。请在 DSH 中运行 /codex-login，完成插件专用的网页登录。'
        : '无法读取 Codex 登录文件，请检查 authFile、文件权限和文件大小。',
      missing ? 'CODEX_AUTH_MISSING' : 'CODEX_AUTH_INVALID',
    )
  }
  try { return JSON.parse(source) } catch (_error) {
    throw new LlmError('Codex 登录文件无效，请重新登录。', 'CODEX_AUTH_INVALID')
  }
}

/** Read a valid token without networking or modifying the credential file.
 * @param authFile - Plugin-owned credential file, or an earlier dedicated CLI cache.
 * @returns Validated ChatGPT access token.
 */
export async function readCodexAccessToken(authFile: string): Promise<string> {
  try {
    const source = await readCache(authFile)
    const owned = ownedCache.safeParse(source)
    const token = owned.success ? owned.data.credential.access : loginCache.parse(source).tokens.access_token
    const expires = validateToken(token)
    if (expires <= Date.now() || (owned.success && owned.data.credential.expires <= Date.now())) {
      throw new LlmError('Codex 登录已过期，请重新授权。', 'CODEX_AUTH_EXPIRED')
    }
    return token
  } catch (error) {
    if (error instanceof LlmError) throw error
    throw new LlmError('Codex 登录文件不是有效的 ChatGPT 登录缓存，请重新登录。', 'CODEX_AUTH_INVALID')
  }
}

function validateToken(token: string): number {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) throw new Error('Invalid access token')
  const claims = tokenClaims.parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')))
  return claims.exp * 1000
}

/** Prepare a private credential directory and reject ambient Codex locations.
 * @param authFile - Dedicated plugin file.
 * @returns Once the canonical parent has private permissions.
 */
export async function prepareAuthDirectory(authFile: string): Promise<void> {
  const home = dirname(authFile)
  await mkdir(home, { recursive: true, mode: 0o700 })
  const canonical = await realpath(home)
  for (const personal of [resolve(homedir(), '.codex'), process.env.CODEX_HOME].filter((value): value is string => Boolean(value))) {
    let candidate = resolve(personal)
    try { candidate = await realpath(candidate) } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    if (canonical === candidate) throw new LlmError('authFile 必须使用插件专用目录。', 'CODEX_LOGIN_CONFIG')
  }
  await chmod(home, 0o700)
}

async function writeCredential(authFile: string, value: OAuthCredential): Promise<void> {
  const credential = oauthCredential.parse(value)
  if (validateToken(credential.access) <= Date.now() || credential.expires <= Date.now()) throw new Error('Expired OAuth credential')
  const temp = `${authFile}.${randomUUID()}.tmp`
  try {
    const file = await open(temp, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify({ version: 1, owner: 'dsh-codex-bridge', credential }) + '\n')
      await file.sync()
    } finally { await file.close() }
    await rename(temp, authFile)
  } finally {
    try { await unlink(temp) } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
}

async function withCredentialLock<T>(authFile: string, signal: AbortSignal | undefined, action: (ownership: AbortSignal) => Promise<T>): Promise<T> {
  const ownership = new AbortController()
  let release: (() => Promise<void>) | undefined
  while (!release) {
    signal?.throwIfAborted()
    try {
      release = await lockfile.lock(authFile, { realpath: false, onCompromised: error => ownership.abort(error) })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ELOCKED') || !signal) throw error
      await delay(100, undefined, { signal })
    }
  }
  try { signal?.throwIfAborted(); return await action(ownership.signal) } finally { await release() }
}

/** Commit SDK login credentials atomically under the same lock used by refresh.
 * @param authFile - Plugin-owned file.
 * @param credential - SDK login result, never sent to the client.
 * @param signal - Login deadline and cancellation, including lock contention.
 * @returns Once an owner-only credential file is committed.
 */
export async function saveCodexCredential(authFile: string, credential: OAuthCredential, signal?: AbortSignal): Promise<void> {
  await prepareAuthDirectory(authFile)
  await withCredentialLock(authFile, signal, ownership => { ownership.throwIfAborted(); return writeCredential(authFile, credential) })
}

/** Read request authentication and renew expired plugin-owned tokens under a file lock.
 * @param authFile - Plugin-owned file; earlier CLI caches are never refreshed.
 * @param signal - Model request cancellation.
 * @param timeoutMs - Maximum time allowed for token renewal.
 * @returns Current access token, excluding all other credential fields.
 */
export async function resolveCodexAccessToken(authFile: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
  try { return await readCodexAccessToken(authFile) } catch (error) {
    if (!(error instanceof LlmError) || error.code !== 'CODEX_AUTH_EXPIRED') throw error
  }
  const owned = ownedCache.safeParse(await readCache(authFile))
  if (!owned.success) throw new LlmError('旧版登录已过期，请在设置中重新授权。', 'CODEX_AUTH_EXPIRED')
  await prepareAuthDirectory(authFile)
  const deadline = AbortSignal.timeout(timeoutMs)
  const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline
  try {
    return await withCredentialLock(authFile, cancellation, async ownership => {
      try { return await readCodexAccessToken(authFile) } catch (error) {
        if (!(error instanceof LlmError) || error.code !== 'CODEX_AUTH_EXPIRED') throw error
      }
      const current = ownedCache.parse(await readCache(authFile)).credential
      const requestSignal = AbortSignal.any([cancellation, ownership])
      requestSignal.throwIfAborted()
      const refreshed = await codexOAuth().refresh(current, requestSignal)
      requestSignal.throwIfAborted()
      await writeCredential(authFile, refreshed)
      return await readCodexAccessToken(authFile)
    })
  } catch (_error) {
    throw new LlmError('Codex 登录续期失败，请检查网络或重新登录。', 'CODEX_AUTH_REFRESH_FAILED')
  }
}
