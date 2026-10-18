/** Codex login in the Models provider card. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { LoginCard } from './LoginCard.js'
import { createLoginApi } from './api.js'
import { en, zh, type LoginKey } from './locales.js'
import { SETTINGS_NAMESPACE } from '../protocol.js'

declare const __CODEX_STYLE__: string
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'codex-bridge.login': LoginKey }
}
/** Services required by the browser card. */
export const inject = ['slots', 'locale', 'connection']

/** Install dictionaries, styles and provider-card login.
 * @param ctx - Browser plugin context; withdrawals follow its fiber.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('codex-bridge.login', { zh, en }), 'codex login copy')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = __CODEX_STYLE__
    document.head.append(style)
    return () => { style.remove() }
  }, 'codex login styles')
  const connection = ctx.get('connection') as ConnectionHandle
  const api = createLoginApi(connection.rpc)
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: SETTINGS_NAMESPACE,
    locale: 'codex-bridge.login', inject: () => ({ api }),
  }, LoginCard))
}
