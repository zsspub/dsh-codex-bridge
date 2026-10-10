import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexLogin } from '../src/login.js'
import { defaultAuthFile } from '../src/config.js'
import { config } from './helpers.js'
import { cliFixture } from './cli-fixture.js'

afterEach(() => { vi.unstubAllEnvs() })


describe('isolated Codex CLI browser login', () => {
  it('ignores the ambient CODEX_HOME when locating its default cache', () => {
    vi.stubEnv('CODEX_HOME', '/ambient/codex')
    vi.stubEnv('DSH_HOME', '/isolated/dsh')
    expect(defaultAuthFile()).toBe('/isolated/dsh/plugins/dsh-codex-bridge/codex/auth.json')
  })

  it('uses its own file store and strips inherited authentication before launching the CLI', async () => {
    vi.stubEnv('CODEX_HOME', '/ambient/codex')
    vi.stubEnv('OPENAI_API_KEY', 'should-not-inherit')
    vi.stubEnv('CODEX_ACCESS_TOKEN', 'should-not-inherit')
    vi.stubEnv('DSH_TEST_SECRET', 'should-not-inherit')
    const fixture = await cliFixture()
    try {
      await fixture.login.start()
      await fixture.login.wait()
      expect(fixture.login.status).toBe('authorized')
      const probe = JSON.parse(await readFile(join(fixture.directory, 'cache', 'probe.json'), 'utf8'))
      expect(probe).toEqual({
        args: ['login', '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"'],
        home: join(fixture.directory, 'cache'), hasKey: false, hasToken: false, hasSecret: false,
      })
    } finally { await fixture.cleanup() }
  })

  it('selects device auth, parses fragmented ANSI instructions and withdraws the code after cancellation', async () => {
    const fixture = await cliFixture('wait')
    try {
      await fixture.login.start('device')
      expect(fixture.login.device).toEqual({ verificationURI: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGHI' })
      const probe = JSON.parse(await readFile(join(fixture.directory, 'cache', 'probe.json'), 'utf8'))
      expect(probe.args).toContain('--device-auth')
      await expect(fixture.login.start('browser')).rejects.toMatchObject({ code: 'CODEX_LOGIN_BUSY' })
      await fixture.login.cancel()
      expect(fixture.login.device).toBeUndefined()
      await fixture.login.start('browser')
      expect(fixture.login.device).toBeUndefined()
      await fixture.login.cancel()
    } finally { await fixture.cleanup() }
  })

  it('clears the device code after successful authorization', async () => {
    const fixture = await cliFixture()
    try {
      await fixture.login.start('device')
      await fixture.login.wait()
      expect(fixture.login.status).toBe('authorized')
      expect(fixture.login.device).toBeUndefined()
    } finally { await fixture.cleanup() }
  })

  it('refuses a second attempt and drains cancellation before allowing a retry', async () => {
    const fixture = await cliFixture('wait')
    try {
      await fixture.login.start()
      await expect(fixture.login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_BUSY' })
      await fixture.login.cancel()
      expect(fixture.login.status).toBe('cancelled')
      await fixture.login.start()
      await fixture.login.cancel()
    } finally { await fixture.cleanup() }
  })

  it('forces an uncooperative child to exit during plugin disposal', async () => {
    const fixture = await cliFixture('ignore-term')
    try {
      await fixture.login.start()
      await fixture.login.dispose()
      expect(fixture.login.status).toBe('cancelled')
      await expect(fixture.login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_DISPOSED' })
    } finally { await fixture.cleanup() }
  })

  it('reports a timeout independently from the child exit code', async () => {
    const fixture = await cliFixture('wait')
    const login = new CodexLogin(config({ authFile: fixture.authFile, codexCommand: fixture.executable, loginTimeoutMs: 1500, loginKillTimeoutMs: 40 }))
    try {
      await login.start()
      await expect(login.wait()).rejects.toMatchObject({ code: 'CODEX_LOGIN_TIMEOUT' })
      expect(login.status).toBe('failed')
    } finally { await login.dispose(); await fixture.cleanup() }
  })

  it('withdraws a pending device code after the plugin deadline expires', async () => {
    const fixture = await cliFixture('wait')
    const login = new CodexLogin(config({ authFile: fixture.authFile, codexCommand: fixture.executable, loginTimeoutMs: 1500, loginKillTimeoutMs: 40 }))
    try {
      await login.start('device')
      expect(login.device).toBeDefined()
      await expect(login.wait()).rejects.toMatchObject({ code: 'CODEX_LOGIN_TIMEOUT' })
      expect(login.device).toBeUndefined()
    } finally { await login.dispose(); await fixture.cleanup() }
  })

  it('redacts failed CLI output and reports a missing executable without child diagnostics', async () => {
    const fixture = await cliFixture('refuse')
    const missing = new CodexLogin(config({ authFile: fixture.authFile, codexCommand: join(fixture.directory, 'missing') }))
    try {
      await expect(fixture.login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_FAILED' })
      await expect(fixture.login.wait()).rejects.not.toThrow('private-cli-output-secret')
      await expect(missing.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_EXECUTABLE' })
    } finally { await missing.dispose(); await fixture.cleanup() }
  })

  it('refuses the machine login directory, including a configured CODEX_HOME', async () => {
    const fixture = await cliFixture()
    vi.stubEnv('CODEX_HOME', join(fixture.directory, 'cache'))
    try {
      await expect(fixture.login.start()).rejects.toMatchObject({ code: 'CODEX_LOGIN_CONFIG' })
      await expect(readFile(fixture.authFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await fixture.cleanup() }
  })
})
