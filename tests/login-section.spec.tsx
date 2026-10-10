import { createElement, type ButtonHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LoginSection } from '../src/client/LoginSection.js'
import { en, zh } from '../src/client/locales.js'
import type { LoginApi } from '../src/client/api.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => createElement('button', props, children),
  StateDot: ({ state }: { state: string }) => createElement('span', { 'aria-hidden': true, 'data-state': state }),
}))

describe('standalone Codex login settings page', () => {
  for (const [locale, dictionary] of Object.entries({ zh, en })) for (const remote of [false, true]) {
    it(`renders its ${locale} page and remote guidance=${remote} without a Settings document`, () => {
      const api: LoginApi = { call: vi.fn(), start: vi.fn() }
      const html = renderToStaticMarkup(<LoginSection api={api} remote={remote} t={key => dictionary[key]} />)
      expect(html).toMatchSnapshot()
      expect(html).toContain(dictionary.nav)
      expect(html).toContain('data-codex-login-card')
      expect(html.includes(dictionary.remoteHint)).toBe(remote)
      expect(api.call).not.toHaveBeenCalled()
    })
  }
})
