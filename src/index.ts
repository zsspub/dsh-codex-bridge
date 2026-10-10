/** Third-party DSH model plugin; the harness owns sessions and tool execution. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { Config } from './config.js'
import { createCodexAdapter } from './adapter.js'
import { CodexLogin } from './login.js'
import { registerLoginCommand } from './commands.js'
import { registerSettingsLogin } from './settings-login.js'

export { Config, defaultAuthFile } from './config.js'
export { createCodexAdapter } from './adapter.js'
export type { HostHooks } from './adapter.js'
export { readCodexAccessToken } from './auth.js'
export { CodexLogin } from './login.js'
export type { CodexLoginStatus } from './login.js'

/** Cordis plugin identity. */
export const name = 'dsh-codex-bridge'
/** Only the LLM service is mandatory; image services are resolved per request. */
export const inject = ['llm']

/** Register the provider under the plugin fiber for HMR-safe disposal.
 * @param ctx - DSH context owning this plugin instance.
 * @param config - validated deployment settings.
 */
export function apply(ctx: Context, config: Config): void {
  const login = new CodexLogin(config)
  ctx.effect(() => () => login.dispose(), 'codex CLI login lifecycle')
  ctx.inject(['commands'], child => registerLoginCommand(child, config, login))
  ctx.inject(['connection'], child => registerSettingsLogin(child, config, login))
  const adapter = createCodexAdapter(config, {
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ reason }) => ctx.logger.warn(`Codex 历史消息按通用格式重放：${reason}`),
  })
  ctx.llm.registerAdapter([config.provider], adapter)
}
