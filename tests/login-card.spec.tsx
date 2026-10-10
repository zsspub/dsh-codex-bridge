import { createElement, type ButtonHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LoginPanel } from '../src/client/LoginCard.js'
import { en, zh, type LoginKey } from '../src/client/locales.js'
import { createLoginApi } from '../src/client/api.js'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { LoginView } from '../src/protocol.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => createElement('button', props, children),
  StateDot: ({ state }: { state: string }) => createElement('span', { 'aria-hidden': true, 'data-state': state }),
}))

describe('Codex Settings card', () => {
  const states: Record<string, LoginView | undefined> = {
    loading: undefined,
    missing: { authenticated: false, credential: 'missing', phase: 'idle' },
    waiting: { authenticated: false, credential: 'missing', phase: 'waiting' },
    device: { authenticated: false, credential: 'missing', phase: 'waiting', device: { verificationURI: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGHI' } },
    authorized: { authenticated: true, credential: 'valid', phase: 'authorized' },
    expired: { authenticated: false, credential: 'expired', phase: 'idle' },
    failed: { authenticated: false, credential: 'missing', phase: 'failed', failure: 'executable' },
  }
  for (const [locale, dict] of Object.entries({ zh, en })) for (const [name, status] of Object.entries(states)) {
    it(`renders ${name} with ${locale} copy and its available actions`, () => {
      const html = renderToStaticMarkup(<LoginPanel t={key => dict[key]} status={status} busy={false}
        onLogin={() => {}} onCancel={() => {}} onRefresh={() => {}} />)
      expect(html).toMatchSnapshot()
      if (name === 'authorized') { expect(html).toContain(dict.signedIn); expect(html).not.toContain(dict.login) }
      if (name === 'missing' || name === 'expired') { expect(html).toContain(dict.login); expect(html).toContain(dict.deviceLogin) }
      if (name === 'device') { expect(html).toContain('ABCD-EFGHI'); expect(html).toContain('https://auth.openai.com/codex/device'); expect(html).toContain(dict.openVerification) }
      if (name === 'waiting' || name === 'device') { expect(html).toContain(dict.cancel); expect(html).not.toContain(dict.login) }
    })
  }

  it('validates credential-free responses and does not expose arbitrary server diagnostics', async () => {
    const call = vi.fn<ClientConnectionRpc['call']>().mockResolvedValue({ ok: true, value: states.authorized })
    const api = createLoginApi({ call })
    expect(await api.call('status')).toEqual(states.authorized)
    expect(call).toHaveBeenCalledWith('/api', 'codex-bridge/status', {}, undefined)
    await api.start('device')
    expect(call).toHaveBeenLastCalledWith('/api', 'codex-bridge/login/start', { method: 'device' }, undefined)
    call.mockResolvedValueOnce({ ok: true, value: { ...states.authorized, token: 'do-not-render' } })
    await expect(api.call('status')).rejects.toThrow()
    call.mockResolvedValueOnce({ ok: true, value: { ...states.device, device: { verificationURI: 'https://untrusted.example/login', userCode: 'ABCD-EFGHI' } } })
    await expect(api.call('status')).rejects.toThrow()
    call.mockResolvedValueOnce({ ok: false, error: { code: 'CODEX_LOGIN_FAILED', message: 'private-process-data', details: { token: 'secret' } } })
    await expect(api.start('browser')).rejects.toThrow('Codex login action failed')
    const t = (key: LoginKey) => zh[key]
    expect(t('failed')).not.toContain('private-process-data')
  })
})
