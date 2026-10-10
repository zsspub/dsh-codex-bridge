vi.mock('../src/oauth.js', async () => { const { sdk } = await import('./sdk-mock.js'); return { codexOAuth: () => sdk } })
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexLogin } from '../src/login.js'
import { defaultAuthFile } from '../src/config.js'
import { readCodexAccessToken } from '../src/auth.js'
import { config, fakeToken } from './helpers.js'
import { sdkFixture } from './sdk-fixture.js'

afterEach(() => { vi.unstubAllEnvs() })

describe('plugin-owned SDK login without Codex CLI', () => {
  it('ignores ambient credentials and persists SDK results with private permissions', async () => {
    vi.stubEnv('CODEX_HOME', '/ambient/codex')
    vi.stubEnv('OPENAI_API_KEY', 'should-not-inherit')
    vi.stubEnv('CODEX_ACCESS_TOKEN', 'should-not-inherit')
    const fixture = await sdkFixture()
    try {
      await fixture.login.start(); await fixture.login.wait()
      expect(fixture.login.status).toBe('authorized')
      expect(await readCodexAccessToken(fixture.authFile)).toBe(fakeToken())
      const saved = JSON.parse(await readFile(fixture.authFile, 'utf8'))
      expect(saved.owner).toBe('dsh-codex-bridge')
      expect(saved.credential.refresh).toBe('private-test-refresh')
      expect((await stat(fixture.authFile)).mode & 0o777).toBe(0o600)
      expect((await stat(join(fixture.directory, 'cache'))).mode & 0o777).toBe(0o700)
      expect(fixture.sdk.login).toHaveBeenCalledOnce()
      expect(fixture.login.browserURL).toBeUndefined()
    } finally { await fixture.cleanup() }
  })
  it('locates its cache without consulting CODEX_HOME', () => {
    vi.stubEnv('CODEX_HOME', '/ambient/codex'); vi.stubEnv('DSH_HOME', '/isolated/dsh')
    expect(defaultAuthFile()).toBe('/isolated/dsh/plugins/dsh-codex-bridge/codex/auth.json')
  })
  it('publishes device instructions, rejects concurrent attempts and clears instructions after cancellation', async () => {
    const fixture = await sdkFixture('wait')
    try {
      await fixture.login.start('device')
      expect(fixture.login.device?.userCode).toBe('ABCD-EFGHI')
      await expect(fixture.login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_BUSY' })
      await fixture.login.cancel()
      expect(fixture.login.device).toBeUndefined()
      expect(fixture.login.status).toBe('cancelled')
      await fixture.login.start('browser')
      expect(fixture.login.device).toBeUndefined()
      expect(fixture.login.browserURL).toContain('oauth/authorize')
      await fixture.login.dispose()
      expect(fixture.login.browserURL).toBeUndefined()
      await expect(fixture.login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_DISPOSED' })
    } finally { await fixture.cleanup() }
  })
  it('withdraws instructions when the login deadline expires', async () => {
    const fixture = await sdkFixture('wait')
    const login = new CodexLogin(config({ authFile: fixture.authFile, loginTimeoutMs: 50 }))
    try {
      await login.start('device')
      await expect(login.wait()).rejects.toMatchObject({ code: 'CODEX_LOGIN_TIMEOUT' })
      expect(login.status).toBe('failed'); expect(login.device).toBeUndefined()
    } finally { await login.dispose(); await fixture.cleanup() }
  })
  it('refuses the machine login directory before starting SDK authentication', async () => {
    const fixture = await sdkFixture()
    vi.stubEnv('CODEX_HOME', join(fixture.directory, 'cache'))
    try {
      await expect(fixture.login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_CONFIG' })
      expect(fixture.sdk.login).not.toHaveBeenCalled()
      await expect(readFile(fixture.authFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await fixture.cleanup() }
  })
  it('redacts OpenAI 403 responses and never leaves a device challenge behind', async () => {
    const fixture = await sdkFixture('forbidden')
    try {
      await expect(fixture.login.start('device')).rejects.toMatchObject({ code: 'CODEX_LOGIN_FORBIDDEN' })
      expect(fixture.login.failureKind).toBe('forbidden')
      expect(fixture.login.device).toBeUndefined()
      await expect(fixture.login.wait()).rejects.not.toThrow('private-sdk-output-secret')
    } finally { await fixture.cleanup() }
  })
})
