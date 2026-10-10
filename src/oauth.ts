/** Native SDK authentication shared by login and credential renewal. */
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'

/** Resolve the SDK's lazy Node OAuth implementation without launching Codex CLI.
 * @returns Browser/device login and refresh operations.
 */
export function codexOAuth() {
  const oauth = openaiCodexProvider().auth.oauth
  if (!oauth) throw new Error('Codex SDK OAuth is unavailable')
  return oauth
}
