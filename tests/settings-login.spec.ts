vi.mock('../src/oauth.js', async () => { const { sdk } = await import('./sdk-mock.js'); return { codexOAuth: () => sdk } })
import { describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { CodexLogin } from '../src/login.js'
import { browserLoginRedirect, handleLoginRequest, loginView } from '../src/settings-login.js'
import type { LoginEndpoint } from '../src/protocol.js'
import { authFixture, config, fakeToken } from './helpers.js'
import { sdkFixture } from './sdk-fixture.js'

function request(endpoint: LoginEndpoint, payload: object = endpoint === 'login/start' ? { method: 'browser' } : {}, method = `codex-bridge/${endpoint}`): Request {
  return new Request(`http://localhost/api/codex-bridge/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test-id', method, payload }),
  })
}

describe('Settings login actions', () => {
  it('opens a pending browser login through a no-store redirect without exposing the OAuth URL in status JSON', async () => {
    const fixture = await sdkFixture('wait')
    const settings = config({ authFile: fixture.authFile })
    try {
      expect(browserLoginRedirect(fixture.login).status).toBe(409)
      await fixture.login.start('browser')
      const response = await handleLoginRequest(request('status'), 'status', settings, fixture.login)
      const text = await response.text()
      expect(JSON.parse(text).result.value.browser).toBe(true)
      expect(text).not.toContain('private-test-state')
      expect(text).not.toContain('oauth/authorize')
      const link = await handleLoginRequest(request('login/url'), 'login/url', settings, fixture.login)
      expect((await link.json()).result.value).toEqual({ url: 'https://auth.openai.com/oauth/authorize?state=private-test-state' })
      expect(link.headers.get('cache-control')).toBe('no-store')
      const redirect = browserLoginRedirect(fixture.login)
      expect(redirect.status).toBe(302)
      expect(redirect.headers.get('location')).toBe('https://auth.openai.com/oauth/authorize?state=private-test-state')
      expect(redirect.headers.get('cache-control')).toBe('no-store')
      expect(redirect.headers.get('referrer-policy')).toBe('no-referrer')
      await fixture.login.cancel()
      const inactive = await handleLoginRequest(request('login/url'), 'login/url', settings, fixture.login)
      expect((await inactive.json()).result.error.code).toBe('CODEX_LOGIN_INACTIVE')
      expect(fixture.login.browserURL).toBeUndefined()
      expect(browserLoginRedirect(fixture.login).status).toBe(409)
      await fixture.login.start('device')
      expect(browserLoginRedirect(fixture.login).status).toBe(409)
    } finally { await fixture.cleanup() }
  })
  it('returns a redacted forbidden category for a failed device authorization request', async () => {
    const fixture = await sdkFixture('forbidden')
    const settings = config({ authFile: fixture.authFile })
    try {
      const response = await handleLoginRequest(request('login/start', { method: 'device' }), 'login/start', settings, fixture.login)
      const text = await response.text()
      expect(JSON.parse(text).result.error.code).toBe('CODEX_LOGIN_FORBIDDEN')
      expect(text).not.toContain('private-sdk-output-secret')
      expect((await loginView(settings, fixture.login)).failure).toBe('forbidden')
    } finally { await fixture.cleanup() }
  })
  it('returns only validity for the independent cache and distinguishes expiry', async () => {
    const fixture = await authFixture()
    const settings = config({ authFile: fixture.path })
    const login = new CodexLogin(settings)
    try {
      expect(await loginView(settings, login)).toEqual({ authenticated: true, credential: 'valid', phase: 'idle' })
      await writeFile(fixture.path, JSON.stringify({ tokens: { access_token: fakeToken(1) } }))
      expect(await loginView(settings, login)).toEqual({ authenticated: false, credential: 'expired', phase: 'idle' })
      await writeFile(fixture.path, 'not a cache')
      expect(await loginView(settings, login)).toEqual({ authenticated: false, credential: 'invalid', phase: 'idle' })
    } finally { await login.dispose(); await fixture.cleanup() }
  })

  it('starts the shared SDK owner, reports progress, drains cancellation and allows retry', async () => {
    const fixture = await sdkFixture('wait')
    const settings = config({ authFile: fixture.authFile })
    try {
      const started = await (await handleLoginRequest(request('login/start'), 'login/start', settings, fixture.login)).json()
      expect(started).toEqual({ type: 'server-response', rpcId: 'test-id', result: { ok: true, value: { authenticated: false, credential: 'missing', phase: 'waiting', browser: true } } })
      const busy = await (await handleLoginRequest(request('login/start'), 'login/start', settings, fixture.login)).json()
      expect(busy.result.error.code).toBe('CODEX_LOGIN_BUSY')
      const cancelled = await (await handleLoginRequest(request('login/cancel'), 'login/cancel', settings, fixture.login)).json()
      expect(cancelled.result.value.phase).toBe('cancelled')
      await fixture.login.start()
      await fixture.login.cancel()
    } finally { await fixture.cleanup() }
  })

  it('observes completed authorization without returning any SDK output or tokens', async () => {
    const fixture = await sdkFixture()
    const settings = config({ authFile: fixture.authFile })
    try {
      await handleLoginRequest(request('login/start'), 'login/start', settings, fixture.login)
      await fixture.login.wait()
      const response = await handleLoginRequest(request('status'), 'status', settings, fixture.login)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const text = await response.text()
      expect(JSON.parse(text).result.value).toEqual({ authenticated: true, credential: 'valid', phase: 'authorized' })
      expect(text).not.toContain('private-test-state')
      expect(text).not.toContain(fakeToken())
    } finally { await fixture.cleanup() }
  })

  it('rejects malformed envelopes, mismatched actions and nonempty action payloads', async () => {
    const fixture = await sdkFixture()
    const settings = config({ authFile: fixture.authFile })
    try {
      for (const input of [request('status', { authFile: '/another/account' }), request('status', {}, 'codex-bridge/login/start'),
        new Request('http://localhost/api/codex-bridge/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })]) {
        expect((await handleLoginRequest(input, 'status', settings, fixture.login)).status).toBe(400)
      }
      expect((await handleLoginRequest(new Request('http://localhost/api/codex-bridge/status'), 'status', settings, fixture.login)).status).toBe(415)
      expect(fixture.login.status).toBe('idle')
    } finally { await fixture.cleanup() }
  })

  it('publishes device instructions only while that attempt is waiting and validates its selected method', async () => {
    const fixture = await sdkFixture('wait')
    const settings = config({ authFile: fixture.authFile })
    try {
      for (const payload of [{}, { method: 'unknown' }, { method: 'device', authFile: '/elsewhere' }]) {
        expect((await handleLoginRequest(request('login/start', payload), 'login/start', settings, fixture.login)).status).toBe(400)
      }
      const started = await (await handleLoginRequest(request('login/start', { method: 'device' }), 'login/start', settings, fixture.login)).json()
      expect(started.result.value.device).toEqual({ verificationURI: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGHI' })
      expect((await loginView(settings, fixture.login)).device).toEqual(started.result.value.device)
      await fixture.login.cancel()
      expect((await loginView(settings, fixture.login)).device).toBeUndefined()
    } finally { await fixture.cleanup() }
  })

  it('reports SDK failure without disclosing diagnostic bytes', async () => {
    const fixture = await sdkFixture('refuse')
    try {
      const response = await handleLoginRequest(request('login/start'), 'login/start', config({ authFile: fixture.authFile }), fixture.login)
      const text = await response.text()
      expect(text).not.toContain('private-sdk-output-secret')
      expect(JSON.parse(text).result.error.code).toBe('CODEX_LOGIN_FAILED')
      expect(fixture.login.failureKind).toBe('failed')
    } finally { await fixture.cleanup() }
  })
})
