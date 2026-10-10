import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodexLogin } from '../src/login.js'
import { config, fakeToken } from './helpers.js'

export async function cliFixture(mode: 'success' | 'wait' | 'refuse' | 'ignore-term' = 'success') {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-codex-cli-'))
  const authFile = join(directory, 'cache', 'auth.json')
  const executable = join(directory, 'codex.mjs')
  await writeFile(executable, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
writeFileSync(join(process.env.CODEX_HOME, 'probe.json'), JSON.stringify({
  args: process.argv.slice(2), home: process.env.CODEX_HOME,
  hasKey: Boolean(process.env.OPENAI_API_KEY), hasToken: Boolean(process.env.CODEX_ACCESS_TOKEN),
  hasSecret: Boolean(process.env.DSH_TEST_SECRET),
}))
if (${JSON.stringify(mode)} === 'refuse') {
  process.stderr.write('private-cli-output-secret')
  process.exit(1)
}
const device = process.argv.includes('--device-auth')
process.stdout.write(device ? 'https://auth.openai.com/codex/device\\nEnter this one-time code (expires in 15 minutes)\\n  \u001b[94mABCD' : 'https://auth.openai.com/oauth/')
process.nextTick(() => {
  process.stdout.write(device ? '-EFGHI\u001b[0m\\n' : 'authorize?state=private-test-state\\n')
  if (${JSON.stringify(mode)} === 'success') {
    writeFileSync(join(process.env.CODEX_HOME, 'auth.json'), ${JSON.stringify(JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: fakeToken() } }))}, { mode: 0o600 })
    process.exit(0)
  }
  if (${JSON.stringify(mode)} === 'ignore-term') process.on('SIGTERM', () => {})
  setInterval(() => {}, 1000)
})
`, { mode: 0o700 })
  await chmod(executable, 0o700)
  const login = new CodexLogin(config({ authFile, codexCommand: executable, loginTimeoutMs: 10_000, loginKillTimeoutMs: 40 }))
  return {
    directory, authFile, executable, login,
    cleanup: async () => { await login.dispose(); await rm(directory, { recursive: true, force: true }) },
  }
}
