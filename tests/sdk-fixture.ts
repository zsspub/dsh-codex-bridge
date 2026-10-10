import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai'
import { CodexLogin } from '../src/login.js'
import { config, fakeToken } from './helpers.js'

import { sdk } from './sdk-mock.js'

export function credential(): OAuthCredential { return { type: 'oauth', access: fakeToken(), refresh: 'private-test-refresh', expires: Date.now() + 3_600_000 } }
export function mockLogin(mode: 'success' | 'wait' | 'refuse' | 'forbidden' = 'success') {
  sdk.login.mockClear()
  sdk.login.mockImplementation(async (interaction: ProviderAuthInteraction) => {
    // Defer readiness so the attempt always owns its deadline before producing instructions.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { interaction.signal.removeEventListener('abort', abort); resolve() }, 5)
      const abort = () => { clearTimeout(timer); reject(new Error('Cancelled')) }
      interaction.signal.addEventListener('abort', abort, { once: true })
      if (interaction.signal.aborted) abort()
    })
    if (mode === 'refuse') throw new Error('private-sdk-output-secret')
    if (mode === 'forbidden') throw new Error('Device auth request failed with status 403: private-sdk-output-secret')
    const method = await interaction.prompt({ type: 'select', message: 'Choose', options: [] })
    interaction.notify(method === 'device_code'
      ? { type: 'device_code', userCode: 'ABCD-EFGHI', verificationUri: 'https://auth.openai.com/codex/device' }
      : { type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?state=private-test-state' })
    if (mode === 'wait') await new Promise<void>((_resolve, reject) => {
      interaction.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
      if (interaction.signal.aborted) reject(new Error('Cancelled'))
    })
    return credential()
  })
  return sdk
}
export async function sdkFixture(mode: 'success' | 'wait' | 'refuse' | 'forbidden' = 'success') {
  mockLogin(mode)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-codex-sdk-'))
  const authFile = join(directory, 'cache', 'auth.json')
  const login = new CodexLogin(config({ authFile, loginTimeoutMs: 10_000 }))
  return { directory, authFile, login, sdk, cleanup: async () => { await login.dispose(); await rm(directory, { recursive: true, force: true }) } }
}
