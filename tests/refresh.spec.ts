vi.mock('../src/oauth.js', async () => { const { sdk } = await import('./sdk-mock.js'); return { codexOAuth: () => sdk } })
import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { saveCodexCredential, resolveCodexAccessToken, readCodexAccessToken } from '../src/auth.js'
import { authFixture, fakeToken } from './helpers.js'
import { credential, mockLogin } from './sdk-fixture.js'
import lockfile from 'proper-lockfile'

async function expire(path: string) {
  const cache = JSON.parse(await readFile(path, 'utf8')); cache.credential.expires = 1
  await writeFile(path, JSON.stringify(cache))
}
describe('plugin credential renewal', () => {
  it('honors the renewal deadline while another process owns the credential lock', async () => {
    const f = await authFixture(); const sdk = mockLogin(); sdk.refresh.mockClear()
    let release: (() => Promise<void>) | undefined
    try {
      await saveCodexCredential(f.path, credential()); await expire(f.path)
      release = await lockfile.lock(f.path, { realpath: false })
      await expect(resolveCodexAccessToken(f.path, undefined, 20)).rejects.toMatchObject({ code: 'CODEX_AUTH_REFRESH_FAILED' })
      expect(sdk.refresh).not.toHaveBeenCalled()
      expect(JSON.parse(await readFile(f.path, 'utf8')).credential.expires).toBe(1)
    } finally { await release?.(); await f.cleanup() }
  })
  it('serializes simultaneous renewals so a rotated refresh token is used once', async () => {
    const f = await authFixture()
    const sdk = mockLogin()
    try {
      await saveCodexCredential(f.path, credential()); await expire(f.path)
      sdk.refresh.mockResolvedValue({ ...credential(), access: fakeToken(4_102_444_800, 'renewed'), refresh: 'rotated-refresh' })
      const result = await Promise.all(Array.from({ length: 5 }, () => resolveCodexAccessToken(f.path, undefined, 2000)))
      expect(result).toEqual(Array(5).fill(fakeToken(4_102_444_800, 'renewed')))
      expect(sdk.refresh).toHaveBeenCalledOnce()
      expect(JSON.parse(await readFile(f.path, 'utf8')).credential.refresh).toBe('rotated-refresh')
    } finally { await f.cleanup() }
  })
  it('leaves persisted credentials unchanged and redacts failed refresh diagnostics', async () => {
    const f = await authFixture(); const sdk = mockLogin()
    try {
      await saveCodexCredential(f.path, credential()); await expire(f.path)
      const before = await readFile(f.path)
      sdk.refresh.mockRejectedValue(new Error('private-test-refresh'))
      await expect(resolveCodexAccessToken(f.path, undefined, 2000)).rejects.toMatchObject({ code: 'CODEX_AUTH_REFRESH_FAILED' })
      expect(await readFile(f.path)).toEqual(before)
    } finally { await f.cleanup() }
  })
  it('never refreshes older CLI caches and allows read-only status without networking', async () => {
    const f = await authFixture(fakeToken(1)); const sdk = mockLogin(); sdk.refresh.mockClear()
    try {
      await expect(resolveCodexAccessToken(f.path, undefined, 2000)).rejects.toMatchObject({ code: 'CODEX_AUTH_EXPIRED' })
      expect(sdk.refresh).not.toHaveBeenCalled()
      await saveCodexCredential(f.path, credential())
      expect(await readCodexAccessToken(f.path)).toBe(fakeToken())
      expect(sdk.refresh).not.toHaveBeenCalled()
    } finally { await f.cleanup() }
  })
})
