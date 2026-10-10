/** Human-only DSH login commands; authorization URLs never enter session output. */
import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { readCodexAccessToken } from './auth.js'
import type { Config } from './config.js'
import type { CodexLogin } from './login.js'

/** Register the login, status and cancellation entry on DSH's command surface.
 * @param ctx - Context carrying the human command service.
 * @param config - Plugin-owned cache location.
 * @param login - SDK authorization owner shared with plugin teardown.
 */
export function registerLoginCommand(ctx: Context, config: Config, login: CodexLogin): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('dsh-codex-bridge/login'),
    name: 'codex-login',
    description: '在浏览器登录 Codex，使用插件专用凭据',
    input: { hint: '[status|cancel]' },
    async handler(invocation): Promise<CommandResult> {
      const input = invocation.rawInput.trim()
      try {
        if (input === 'cancel') {
          await login.cancel()
          return { kind: 'success', text: 'Codex 登录已停止。' }
        }
        if (input === 'status') {
          if (login.status === 'waiting') return { kind: 'success', text: '正在等待浏览器授权。运行 /codex-login cancel 可取消。' }
          if (login.status === 'failed' || login.status === 'cancelled') await login.wait()
          await readCodexAccessToken(config.authFile)
          return { kind: 'success', text: 'Codex 已登录，使用插件专用凭据。' }
        }
        if (input !== '') return { kind: 'error', text: '用法：/codex-login [status|cancel]' }
        await login.start()
        return { kind: 'success', text: 'Codex 网页授权已启动，请在设置 → Codex 登录中打开登录页面。完成后运行 /codex-login status 查看结果。' }
      } catch (error) {
        if (error instanceof LlmError) return { kind: 'error', text: error.message }
        throw error
      }
    },
  })
}
