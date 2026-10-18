import { createElement, type ButtonHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LoginPanel } from '../src/client/LoginCard.js'
import { en, zh, type LoginKey } from '../src/client/locales.js'
import { createLoginApi } from '../src/client/api.js'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { browserAuthorizationUrlSchema, type LoginView } from '../src/protocol.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => createElement('button', props, children),
  StateDot: ({ state }: { state: string }) => createElement('span', { 'aria-hidden': true, 'data-state': state }),
}))

describe('Codex Settings card', () => {
  const states: Record<string, LoginView | undefined> = {
    loading: undefined,
    forbidden: { authenticated: false, credential: 'missing', phase: 'failed', failure: 'forbidden' },
    missing: { authenticated: false, credential: 'missing', phase: 'idle' },
    waiting: { authenticated: false, credential: 'missing', phase: 'waiting', browser: true },
    device: { authenticated: false, credential: 'missing', phase: 'waiting', device: { verificationURI: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGHI' } },
    authorized: { authenticated: true, credential: 'valid', phase: 'authorized' },
    expired: { authenticated: false, credential: 'expired', phase: 'idle' },
    failed: { authenticated: false, credential: 'missing', phase: 'failed', failure: 'failed' },
  }
  for (const [locale, dict] of Object.entries({ zh, en })) for (const [name, status] of Object.entries(states)) {
    it(`renders ${name} with ${locale} copy and its available actions`, () => {
      const html = renderToStaticMarkup(<LoginPanel t={key => dict[key]} status={status} busy={false}
        browserURL="https://auth.openai.com/oauth/authorize?state=fixture"
        onLogin={() => {}} onCancel={() => {}} onRefresh={() => {}} />)
      expect(html).toMatchSnapshot()
      if (name === 'forbidden') expect(html).toContain(dict.forbidden)
      expect(html).not.toContain('npm install')
      expect(html).not.toContain('0.162.1')
      if (name === 'authorized') { expect(html).toContain(dict.signedIn); expect(html).toContain(dict.relogin); expect(html).toContain(dict.deviceLogin) }
      if (name === 'missing' || name === 'expired') { expect(html).toContain(dict.login); expect(html).toContain(dict.deviceLogin) }
      if (name === 'device') { expect(html).toContain('ABCD-EFGHI'); expect(html).toContain('https://auth.openai.com/codex/device'); expect(html).toContain(dict.openVerification) }
      if (name === 'waiting') { expect(html).toContain('https://auth.openai.com/oauth/authorize?state=fixture'); expect(html).toContain(dict.openBrowserLogin); expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noopener noreferrer"') }
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

  it('accepts only OpenAI HTTPS authorization URLs from SDK authentication', () => {
    expect(browserAuthorizationUrlSchema.safeParse('https://auth.openai.com/oauth/authorize?state=fixture').success).toBe(true)
    for (const url of ['not a URL', 'https://', 'http://auth.openai.com/oauth/authorize?state=fixture', 'https://auth.openai.com.attacker.test/oauth/authorize?state=fixture',
      'https://attacker.test/oauth/authorize?state=fixture', 'https://user:password@auth.openai.com/oauth/authorize?state=fixture',
      'https://auth.openai.com:8080/oauth/authorize?state=fixture', 'https://auth.openai.com/oauth/authorize?state=fixture#redirect',
      'https://auth.openai.com/another/path', 'javascript:alert(1)']) expect(browserAuthorizationUrlSchema.safeParse(url).success).toBe(false)
  })

  it('resolves the pending browser link through Connection and rejects untrusted destinations', async () => {
    const url = 'https://auth.openai.com/oauth/authorize?state=fixture'
    const call = vi.fn<ClientConnectionRpc['call']>().mockResolvedValue({ ok: true, value: { url } })
    const api = createLoginApi({ call })
    expect(await api.browserURL()).toBe(url)
    expect(call).toHaveBeenCalledWith('/api', 'codex-bridge/login/url', {}, undefined)
    call.mockResolvedValueOnce({ ok: true, value: { url: 'https://untrusted.example/login' } })
    await expect(api.browserURL()).rejects.toThrow()
  })

  it.each(Object.entries({ zh, en }))('shows a recoverable query failure instead of an endless loading state in %s', (_locale, dictionary) => {
    const html = renderToStaticMarkup(<LoginPanel t={key => dictionary[key]} busy={false} problem="queryFailure"
      onLogin={() => {}} onCancel={() => {}} onRefresh={() => {}} />)
    expect(html).toContain(dictionary.queryFailure)
    expect(html).toContain(dictionary.refresh)
    expect(html).not.toContain(`<button>${dictionary.login}</button>`)
    expect(html).toMatchSnapshot()
  })
})
