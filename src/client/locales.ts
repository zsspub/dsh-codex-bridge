/** Settings card copy owned by the plugin. */
export const zh = {
  title: 'Codex Bridge', heading: '登录与连接',
  description: '使用 ChatGPT 账号登录，无需安装 Codex CLI',
  signedIn: '已登录', signedOut: '未登录', pending: '等待网页授权', expired: '登录已过期',
  connected: '已连接，可以在模型选择器中选择 Codex 模型',
  instruction: '选择网页登录或设备码登录，使用 ChatGPT 账号完成授权',
  waiting: '点击“打开登录页面”在新标签页完成授权，完成后这里会自动更新',
  openBrowserLogin: '打开登录页面',
  devicePending: '等待设备码授权', deviceLogin: '设备码登录', deviceWaiting: '打开认证页面，登录 ChatGPT 并输入下方设备码，完成后这里会自动更新',
  deviceCode: '设备码', openVerification: '打开认证页面',
  login: '网页登录', cancel: '取消登录', refresh: '刷新状态',
  queryFailure: '暂时无法读取登录状态，请刷新重试',
  failed: '登录未完成，请重试',
  forbidden: 'OpenAI 认证接口拒绝请求（HTTP 403），请检查运行 DSH 的机器的网络出口和访问限制',
  timeout: '登录已超时，请重新登录', invalid: '登录凭据不可用，请重新登录',
} as const
/** Copy keys shared across the shipped languages. */
export type LoginKey = keyof typeof zh
/** English copy for every Settings card key. */
export const en: Record<LoginKey, string> = {
  title: 'Codex Bridge', heading: 'Sign in and connect',
  description: 'Sign in with ChatGPT. No Codex CLI installation required',
  signedIn: 'Signed in', signedOut: 'Not signed in', pending: 'Waiting for authorization', expired: 'Sign-in expired',
  connected: 'Connected. Select a Codex model in the model picker',
  instruction: 'Choose browser or device code sign-in to authorize with ChatGPT',
  waiting: 'Click “Open sign-in page” to authorize in a new tab. This status updates automatically',
  openBrowserLogin: 'Open sign-in page',
  devicePending: 'Waiting for device authorization', deviceLogin: 'Sign in with device code', deviceWaiting: 'Open the verification page, sign in with ChatGPT and enter the code below. This status updates automatically',
  deviceCode: 'Device code', openVerification: 'Open verification page',
  login: 'Sign in with browser', cancel: 'Cancel sign-in', refresh: 'Refresh status',
  queryFailure: 'Unable to read sign-in status. Refresh to retry',
  failed: 'Sign-in did not complete. Try again',
  forbidden: 'OpenAI rejected the authentication request (HTTP 403). Check the network egress and access restrictions on the machine running DSH',
  timeout: 'Sign-in timed out. Sign in again', invalid: 'Sign-in credentials are unavailable. Sign in again',
}
