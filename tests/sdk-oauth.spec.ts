/** Real SDK browser/device flows with synthetic OpenAI responses; no account is used. */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexLogin } from '../src/login.js'
import { resolveCodexAccessToken, readCodexAccessToken } from '../src/auth.js'
import { config, fakeToken } from './helpers.js'

const nativeFetch = globalThis.fetch
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); vi.unstubAllGlobals() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-native-oauth-'))
  const authFile = join(directory, 'auth.json')
  const login = new CodexLogin(config({ authFile, loginTimeoutMs: 5000 }))
  cleanups.push(async () => { await login.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { authFile, login }
}

describe('real SDK OAuth integration without CLI', () => {
  it('accepts a checked localhost callback, exchanges PKCE and refreshes the persisted token', async () => {
    const f = await fixture()
    let verifier = ''
    let refreshed = false
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (!url.startsWith('https://auth.openai.com/')) return nativeFetch(input, init)
      expect(url).toBe('https://auth.openai.com/oauth/token')
      const form = new URLSearchParams(String(init?.body))
      if (form.get('grant_type') === 'authorization_code') {
        expect(form.get('code')).toBe('test-code'); expect(form.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
        verifier = form.get('code_verifier') ?? ''
        return Response.json({ access_token: fakeToken(), refresh_token: 'test-refresh', expires_in: 3600 })
      }
      expect(form.get('grant_type')).toBe('refresh_token'); expect(form.get('refresh_token')).toBe('test-refresh')
      refreshed = true
      return Response.json({ access_token: fakeToken(4_102_444_800, 'refreshed-account'), refresh_token: 'test-refresh-2', expires_in: 3600 })
    }))
    await f.login.start('browser')
    const url = new URL(f.login.browserURL!)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect((await nativeFetch('http://127.0.0.1:1455/auth/callback?state=wrong&code=test-code')).status).toBe(400)
    expect((await nativeFetch('http://127.0.0.1:1455/auth/callback?state=' + url.searchParams.get('state') + '&code=test-code')).status).toBe(200)
    await f.login.wait()
    expect(verifier.length).toBeGreaterThan(20)
    expect(await readCodexAccessToken(f.authFile)).toBe(fakeToken())
    const cache = JSON.parse(await readFile(f.authFile, 'utf8'))
    cache.credential.expires = 1
    await (await import('node:fs/promises')).writeFile(f.authFile, JSON.stringify(cache))
    expect(await resolveCodexAccessToken(f.authFile, undefined, 2000)).toBe(fakeToken(4_102_444_800, 'refreshed-account'))
    expect(refreshed).toBe(true)
    expect(JSON.parse(await readFile(f.authFile, 'utf8')).credential.refresh).toBe('test-refresh-2')
  })
  it('obtains a device challenge and exchanges the device grant using the SDK', async () => {
    const f = await fixture()
    let release!: () => void
    const authorization = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/deviceauth/usercode')) return Response.json({ device_auth_id: 'test-device', user_code: 'ABCD-EFGHI', interval: '0' })
      if (url.endsWith('/deviceauth/token')) {
        await authorization
        expect(JSON.parse(String(init?.body))).toEqual({ device_auth_id: 'test-device', user_code: 'ABCD-EFGHI' })
        return Response.json({ authorization_code: 'device-code', code_verifier: 'device-verifier' })
      }
      expect(url).toBe('https://auth.openai.com/oauth/token')
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('redirect_uri')).toBe('https://auth.openai.com/deviceauth/callback')
      expect(form.get('code')).toBe('device-code')
      return Response.json({ access_token: fakeToken(), refresh_token: 'test-refresh', expires_in: 3600 })
    }))
    await f.login.start('device')
    expect(f.login.device?.userCode).toBe('ABCD-EFGHI')
    release(); await f.login.wait()
    expect(f.login.status).toBe('authorized'); expect(f.login.device).toBeUndefined()
  })
  it('cancels the real SDK browser callback listener and allows another attempt', async () => {
    const f = await fixture()
    await f.login.start(); await f.login.cancel()
    expect(f.login.status).toBe('cancelled')
    await f.login.start(); await f.login.dispose()
    expect(f.login.browserURL).toBeUndefined()
  })
  it('redacts a rejected device request before emitting instructions', async () => {
    const f = await fixture()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('private-error-details', { status: 403 })))
    await expect(f.login.start('device')).rejects.toMatchObject({ code: 'CODEX_LOGIN_FORBIDDEN' })
    expect(f.login.device).toBeUndefined()
    await expect(f.login.wait()).rejects.not.toThrow('private-error-details')
  })
})
