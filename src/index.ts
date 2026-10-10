/** Third-party DSH model plugin; the harness owns sessions and tool execution. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import schema from '@deepseek-ai/schemastery'
import { configFields, type Config as ResolvedConfig } from './config.js'
import { createCodexAdapter } from './adapter.js'
import { CodexLogin } from './login.js'
import { registerLoginCommand } from './commands.js'
import { registerSettingsLogin } from './settings-login.js'
import { SETTINGS_NAMESPACE } from './protocol.js'

export { defaultAuthFile } from './config.js'
/** Live login timeout exposes the plugin's Settings namespace without remounting. */
export const Config = schema.object({
  ...configFields, loginTimeoutMs: configFields.loginTimeoutMs.volatile(),
})
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
 * @param liveConfig - Validated settings with a shared login timeout reference.
 */
export function apply(ctx: Context, liveConfig: ReturnType<typeof Config>): void {
  const config: ResolvedConfig = {
    ...liveConfig, get loginTimeoutMs() { return liveConfig.loginTimeoutMs.get() },
  }
  const login = new CodexLogin(config)
  ctx.effect(() => () => login.dispose(), 'codex SDK login lifecycle')
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
  ctx.llm.registerConfigurableProviders([{
    provider: config.provider, displayName: config.displayName,
    settingsNs: SETTINGS_NAMESPACE, settingsPath: [],
  }])
  ctx.llm.registerAdapter([config.provider], adapter)
}
