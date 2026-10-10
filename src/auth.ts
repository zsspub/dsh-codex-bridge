/** Read-only interoperability with the official Codex file-based login cache. */
import { open } from 'node:fs/promises'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

const loginCache = z.object({
  auth_mode: z.literal('chatgpt').optional(),
  tokens: z.object({ access_token: z.string().min(1) }),
})
const tokenClaims = z.object({
  exp: z.number().int().positive(),
  'https://api.openai.com/auth': z.object({ chatgpt_account_id: z.string().min(1) }),
})
const MAX_AUTH_FILE_BYTES = 1024 * 1024

/** Read a current ChatGPT access token without changing Codex's cached login.
 * @param authFile - official file-based Codex cache path.
 * @returns validated, unexpired access token; never includes a refresh token.
 * @throws LlmError with CODEX_AUTH_MISSING, CODEX_AUTH_INVALID or CODEX_AUTH_EXPIRED.
 */
export async function readCodexAccessToken(authFile: string): Promise<string> {
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
  let token: string
  let expires: number
  try {
    const cache = loginCache.parse(JSON.parse(source))
    token = cache.tokens.access_token
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) throw new Error('Invalid access token')
    const claims = tokenClaims.parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')))
    expires = claims.exp
  } catch (_error) {
    // Parser diagnostics may contain credential bytes; expose only the recovery action.
    throw new LlmError('Codex 登录文件不是有效的 ChatGPT 登录缓存。请运行 /codex-login 后重试。', 'CODEX_AUTH_INVALID')
  }
  if (expires * 1000 <= Date.now()) {
    throw new LlmError(
      'Codex 登录已过期。请在 DSH 中运行 /codex-login 重新授权。',
      'CODEX_AUTH_EXPIRED',
    )
  }
  return token
}
