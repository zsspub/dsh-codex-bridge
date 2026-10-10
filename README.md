# dsh-codex-bridge

第三方 DeepSeek Harness 模型插件，兼容 **DSH `0.2.0-rc.2`**。通过 Codex CLI 使用网页登录或设备码登录 ChatGPT，以 `codex-bridge` 提供方直接调用 Codex 模型。插件使用自己的凭据目录，不继承本机 Codex 登录。DSH 负责会话、工具执行、日志和恢复；插件复用公开的 `PiAiAdapter` 与 `@earendil-works/pi-ai` Codex 协议实现。

支持流式文本、思考级别、工具调用、工具结果续接、加密思考记录重放、用量统计、取消和 DSH 持久化图片输入。可用模型以 `@earendil-works/pi-ai@1.1.0` 目录为准，包含 GPT-6.1 Sol、GPT-6 Sol、Astra、Luna 等；目录不代表账号已获授权，实际成功请求才能确认模型权限。

## 安装到本机 DSH

需要 Node `^22.19.0 || >=24.0.0`、pnpm 11，以及支持 `codex login` 的 Codex CLI。默认凭据路径为 `$DSH_HOME/plugins/dsh-codex-bridge/codex/auth.json`，未设置 `DSH_HOME` 时使用 `~/.dsh`。插件忽略继承的 `CODEX_HOME`，不会复制 `~/.codex/auth.json`。

以下命令中的 `/path/to/deepseek-harness` 替换为 DSH 源码目录。

```sh
git clone https://github.com/zsspub/dsh-codex-bridge.git
cd dsh-codex-bridge
pnpm install
pnpm test
pnpm pack --pack-destination /tmp
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /tmp/dsh-codex-bridge-0.1.4.tgz
pnpm run start:web --no-open
```

启动后打开 **设置 → 模型 → Codex Bridge**。未登录时可选择 **网页登录** 或 **设备码登录**。网页登录由 CLI 打开浏览器；设备码登录会显示一次性验证码和 **打开认证页面** 入口，在该页面登录 ChatGPT 并输入设备码完成授权；卡片在等待期间自动更新，完成后显示 **已登录**。等待期间可取消；关闭设置不会中断登录，重新打开或点击 **刷新状态** 可读取最新状态。卡片只验证插件专用凭据的格式和有效期，不表示账号获得某个模型的使用权限。

### 登录卡片位置

卡片注册在 DSH 的 `settings.models.footer`，位置由宿主设置页决定。原版 `0.2.0-rc.2` 在「添加模型提供商」之后渲染该区域。本仓库提供 [DSH 源码补丁](patches/dsh-0.2.0-rc.2-models-placement.patch)，将其移到提供商列表之后、添加按钮之前，同时更新宿主文档、目录与布局快照。

在干净的 DSH `release/v0.2.0-rc.2` 源码目录应用补丁后重新构建启动；下面的 `/path/to/dsh-codex-bridge` 替换为本插件仓库目录。已经包含该位置调整的宿主无需再应用。

```sh
git apply /path/to/dsh-codex-bridge/patches/dsh-0.2.0-rc.2-models-placement.patch
pnpm run dev:web --no-open
```

也可以在 DSH 输入框执行 `/codex-login`，在 CLI 打开的浏览器页面完成登录，再执行 `/codex-login status` 确认。选择 **Codex（CLI 网页登录）** 下的模型；安装不修改现有默认模型。`/codex-login cancel` 取消等待并终止登录进程，卸载插件也会等待进程退出。

CLI 只负责登录，DSH 的模型目录由插件依赖的 SDK 提供。更新 CLI 后还需要更新插件才能获得新模型列表。独立安装的 CLI 可运行 `codex update`；应用内置 CLI 若不支持自更新，请使用官方独立 CLI，并将 `codexCommand` 指向它。`0.1.2` 已加入 `gpt-6.1-sol`，升级保留插件原有登录。

为兼容 DSH `0.2.0-rc.2` 的公开流类型，协议运行时保持 `pi-ai@0.87.1`；`pi-ai-catalog` 是 `@earendil-works/pi-ai@1.1.0` 的 npm 别名，仅提供最新模型元数据。插件不在两个版本之间传递流或带品牌的会话对象。

pnpm 11 首次安装如果提示 `ERR_PNPM_IGNORED_BUILDS`，将以下脚本策略合入 `~/.dsh/profiles/web/pnpm-workspace.yaml`，再重试。Codex 路径不需要 Google SDK 和 protobuf 的安装脚本：

```yaml
allowBuilds:
  esbuild: true
  '@google/genai': false
  protobufjs: false
```

失败的安装若已留下依赖却没有启用 Bundle，先执行 `pnpm dsh plugin --profile web remove dsh-codex-bridge`，再执行上述 `add` 命令。

CLI 登录时强制使用插件目录中的 `file` 凭据存储和 ChatGPT 登录方式。继承环境中的 API Key、access token 和其他密钥变量不会传给登录进程。网页登录使用 CLI 的 localhost 回调，通常需要端口 `1455` 空闲；远程 DSH 需要将该端口转发到浏览器所在机器。详见 [Codex 认证文档](https://learn.chatgpt.com/docs/auth)。插件仅启动登录命令，不启动 Codex Agent。

## 配置

`cordis.patch.yml` 默认启用插件。可在 Profile 的插件配置中设置：

```yaml
- insert:
    - id: dsh-codex-bridge
      name: dsh-codex-bridge
      config:
        provider: codex-bridge
        displayName: Codex（CLI 网页登录）
        codexCommand: /path/to/codex
        authFile: /Users/your-name/.dsh/plugins/dsh-codex-bridge/codex/auth.json
        models: [gpt-6-sol, gpt-6-luna]
        streamIdleTimeoutMs: 120000
```

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `provider` | `codex-bridge` | 唯一提供方路由名；避免与已有插件重复 |
| `displayName` | `Codex（CLI 网页登录）` | 模型选择器名称 |
| `authFile` | DSH 数据目录中的插件专用缓存 | 必须是绝对路径，文件名为 `auth.json`；父目录作为 CLI 的 `CODEX_HOME` |
| `codexCommand` | `codex` | 登录用 CLI 可执行文件；默认从 PATH 查找，可指定绝对路径 |
| `loginTimeoutMs` | `300000` | 等待任一登录方式的最长时间；默认 5 分钟，设备码自身的 15 分钟有效期不延长插件期限 |
| `loginKillTimeoutMs` | `2000` | 取消后强制终止 CLI 的等待时间 |
| `models` | `[]` | 空数组表示 SDK 全目录；未知或重复模型在加载时失败 |
| `baseURL` | `https://chatgpt.com/backend-api` | Codex 兼容接口地址；登录令牌会发送到该地址 |
| `streamIdleTimeoutMs` | `120000` | 流事件空闲超时 |
| `maxRequestImageBytes` | `20971520` | 请求图片的 base64 总字节上限 |
| `requestImagePixelBudget` | `16000000` | 请求图片总像素预算 |
| `requestImageMaxBytes` | `4194304` | DSH 图片处理的目标字节数 |

Codex 订阅接口不能执行 `temperature`、`maxTokens` 或 `stop` 设置，插件遇到这些选项会返回 `UNSUPPORTED_OPTION`。输出模型、思考级别在 DSH 中选择；远端工具请求交给 DSH 执行。

服务端 HTTP 错误沿用 DSH pi-ai 适配器的 `PI_AI_ERROR`，包含 SDK 返回的错误说明；SDK 内部重试已关闭。流空闲超时由 DSH 适配器处理。

## 登录与兼容范围

CLI 负责将浏览器授权结果写入插件专用 `auth.json`。模型请求只读取其中的 ChatGPT access token，不读取或刷新 refresh token，不接受 API Key 缓存。当前版本没有后台续期；令牌过期时返回 `CODEX_AUTH_EXPIRED`，在设置卡片选择任一登录方式或执行 `/codex-login` 重新授权。文件缺失、不可读或格式不合法时返回明确的认证错误，CLI 原始输出、OAuth 授权 URL、设备码和凭据内容不进入 DSH 会话日志。

从本地 `0.1.0` 升级到 `0.1.1` 后，需要执行一次 `/codex-login`。默认认证目录已改为插件专用目录，旧版使用的本机登录不会自动迁移。请移除指向本机 `.codex/auth.json` 的旧 `authFile` 配置；登录入口会拒绝本机 Codex 目录。

设置中的 **网页登录** 由服务端 CLI 打开服务所在机器的浏览器，适用于本地 Web 服务；远程访问需要处理 CLI 的 localhost 回调。**设备码登录** 可以在访问设置的浏览器打开 OpenAI 认证页面，无需端口转发；若账号未启用设备码授权，需要先在 ChatGPT 安全设置中启用。界面通过 Models footer 扩展挂载，使用既有按钮和主题变量；字典支持中文与英文。Host 只向已通过 Connection 认证的浏览器返回凭据是否有效、登录进度、脱敏错误，以及等待期间的设备码和固定 OpenAI 认证页面。设备码只保留在当前登录进程的内存中，完成、取消、失败或卸载后清除；不返回令牌、CLI 输出或 OAuth 授权链接。

没有加载 DSH 人机命令服务的 Profile，可手动使用相同的独立目录登录：

```sh
mkdir -p "$HOME/.dsh/plugins/dsh-codex-bridge/codex"
CODEX_HOME="$HOME/.dsh/plugins/dsh-codex-bridge/codex" codex login \
  -c 'cli_auth_credentials_store="file"' -c 'forced_login_method="chatgpt"'
```

这是第三方对 Codex 订阅接口的兼容实现。OpenAI 的[第三方 Sign in with ChatGPT 接入](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)使用另外的 OAuth 授权流程和 `api.openai.com/v1`；本插件没有实现该流程。服务端变更可能需要升级 SDK 或插件。

## 开发与验收

```sh
pnpm typecheck
pnpm test
pnpm build
CODEX_TEST_MODEL=gpt-6.1-sol pnpm test:live
```

单元与本地 HTTP/SSE 测试不需要真实凭据，覆盖设置卡片的本地状态快照、RPC 校验和脱敏、独立 CLI 登录、环境密钥隔离、重复登录、超时、取消与卸载，以及认证错误、注册、请求归属信息、文本与用量、工具参数和加密记录重放。`test:live` 使用插件专用登录发送一条短测试消息，消耗该账号的 Codex 用量；可通过 `CODEX_TEST_MODEL` 选择模型、`CODEX_AUTH_FILE` 指定插件缓存路径。

仓库不包含凭据、DSH 用户数据、测试产物或构建目录；发布包包含编译后的 ESM 和类型声明。没有独立应用启动命令，使用 DSH Profile 加载插件。
