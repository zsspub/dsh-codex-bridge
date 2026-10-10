import { afterEach, describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readCodexAccessToken } from '../src/auth.js'
import { authFixture, fakeToken } from './helpers.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

describe('official Codex login cache', () => {
  it('rereads the token on every request and leaves the refresh token and cache bytes unchanged', async () => {
    const fixture = await authFixture()
    cleanups.push(fixture.cleanup)
    const original = await readFile(fixture.path)
    expect(await readCodexAccessToken(fixture.path)).toBe(fakeToken())
    expect(await readFile(fixture.path)).toEqual(original)
    const rotated = fakeToken(4_102_444_800, 'rotated-account')
    await writeFile(fixture.path, JSON.stringify({ tokens: { access_token: rotated } }))
    expect(await readCodexAccessToken(fixture.path)).toBe(rotated)
  })

  it('reports a missing file with an actionable error', async () => {
    const fixture = await authFixture()
    cleanups.push(fixture.cleanup)
    await expect(readCodexAccessToken(join(fixture.directory, 'missing'))).rejects.toMatchObject({ code: 'CODEX_AUTH_MISSING' })
  })

  it.each([
    'secret-token-unparseable',
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'secret-api-key' }),
    JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'secret-token' } }),
    JSON.stringify({ tokens: { access_token: `e30.${Buffer.from('{}').toString('base64url')}.secret-signature` } }),
  ])('refuses an invalid or API-key cache without exposing its bytes', async source => {
    const fixture = await authFixture()
    cleanups.push(fixture.cleanup)
    await writeFile(fixture.path, source)
    try {
      await readCodexAccessToken(fixture.path)
      throw new Error('Expected invalid authentication')
    } catch (error) {
      expect(error).toMatchObject({ code: 'CODEX_AUTH_INVALID' })
      expect(String(error)).not.toContain('secret-')
    }
  })

  it('refuses an expired token instead of rotating the Codex refresh token', async () => {
    const fixture = await authFixture(fakeToken(1))
    cleanups.push(fixture.cleanup)
    const before = await readFile(fixture.path)
    await expect(readCodexAccessToken(fixture.path)).rejects.toMatchObject({ code: 'CODEX_AUTH_EXPIRED' })
    expect(await readFile(fixture.path)).toEqual(before)
  })

  it('rejects oversized caches before JSON parsing', async () => {
    const fixture = await authFixture()
    cleanups.push(fixture.cleanup)
    await writeFile(fixture.path, 'x'.repeat(1024 * 1024 + 1))
    await expect(readCodexAccessToken(fixture.path)).rejects.toMatchObject({ code: 'CODEX_AUTH_INVALID' })
  })
})
