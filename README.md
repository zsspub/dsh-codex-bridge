# @zengshushu/dsh-codex-bridge

第三方 DeepSeek Harness 模型插件，兼容 **DSH `0.2.1-rc.3`**。通过 SDK 直接完成 ChatGPT 网页登录或设备码登录，以 `codex-bridge` 提供方调用 Codex 模型。**无需安装 Codex CLI**。插件使用自己的凭据目录，不继承本机 Codex 登录；DSH 负责会话、工具执行、日志和恢复。模型适配复用公开的 `PiAiAdapter` 与 `@earendil-works/pi-ai` Codex 协议实现。

支持流式文本、思考级别、工具调用、工具结果续接、加密思考记录重放、用量统计、取消和 DSH 持久化图片输入。模型目录完全跟随宿主 pi-ai 的 Codex 目录；目录不表示账号获得模型权限，实际请求才能确认。

## 安装

需要 Node `^22.19.0 || >=24.0.0`。公网 npm 包包含预编译服务端 ESM、浏览器模块和类型声明，安装时无需构建插件；pnpm 仍会安装运行时依赖。使用 DSH 官方插件管理命令安装：

```sh
dsh plugin --profile web add @zengshushu/dsh-codex-bridge@0.1.16
```

也可在 DSH 插件市场选择本地压缩包，或通过命令安装 tgz：

```sh
dsh plugin --profile web add /path/to/zengshushu-dsh-codex-bridge-0.1.16.tgz
```

macOS 桌面应用使用 `desktop` Profile。通过应用自带的 CLI 安装本地包：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /path/to/zengshushu-dsh-codex-bridge-0.1.16.tgz
```

安装完成后退出并重新打开 DeepSeek Harness，在 **设置 → 模型 → Codex Bridge** 检查登录状态。桌面应用自带运行时和包管理器，无需另行安装 CLI。

从 DSH 源码运行时使用 `pnpm dsh plugin --profile web add ...`。升级后重启 DSH，再刷新浏览器；systemd 部署可执行 `systemctl restart deepseek-harness.service`。插件不会自动改动 DSH 的源码、默认模型或安装其他程序。

从 0.1.14 开始，插件通过 peer dependency 复用宿主的 `@earendil-works/pi-ai@1.1.0`，不安装另一套 SDK 或模型目录包。当前适配依据为本机应用自带 CLI 的 `--version` 输出 `0.2.1-rc.3` 及客户端自带 API，DSH 依赖锁定同一版本；保留宿主的 Cordis `4.0.5`、Schemastery `3.18.5` 和 pi-ai `1.1.0`。宿主 Profile 必须能解析 pi-ai。本次不升级 DSH，也不追踪最新版本；其他版本需重新验证。

预编译 npm 包和 tgz 不要求为插件增加构建授权。若安装器仍报告 `@google/genai` 或 `protobufjs` 的构建脚本被拦截，需要按错误明细检查宿主已有依赖的 pnpm 策略；本版本不再直接或通过目录别名引入新的 pi-ai 依赖树。GitHub 源码安装会执行 `prepare`，仍需要授权 `@zengshushu/dsh-codex-bridge` 构建；开发环境还需要运行 esbuild 的安装脚本。日常安装优先使用 npm 包。

从无 scope 的旧包迁移时，先卸载 `dsh-codex-bridge`，再安装 `@zengshushu/dsh-codex-bridge`，避免同时注册相同的提供商和登录卡片。插件 entry id 与凭据目录仍为 `dsh-codex-bridge`，原插件专用凭据可继续读取：

```sh
dsh plugin --profile web remove dsh-codex-bridge
dsh plugin --profile web add @zengshushu/dsh-codex-bridge@0.1.16
```

## 登录

打开 **设置 → 模型 → Codex Bridge**，选择 **网页登录** 或 **设备码登录**。已有凭据时仍可点击 **重新登录** 或 **设备码登录**，恢复被认证服务拒绝的登录。页面不再检测 CLI，不显示 CLI 安装提示。网页登录准备完成后，点击 **打开登录页面** 在新标签页完成授权；设备码登录会显示一次性验证码与 **打开认证页面**。等待期间自动刷新，可取消登录；关闭设置不会中断授权。

设备码登录无需回调端口，适合远程 DSH。账号可能需要在 ChatGPT 的安全设置中启用设备码授权。网页登录的 SDK 使用 `http://localhost:1455/auth/callback` 回调；浏览器与 DSH 不在同一机器时，在浏览器所在电脑建立转发并保持运行：

```sh
ssh -N -L 1455:127.0.0.1:1455 user@your-dsh-server
```

服务器仍须能访问 OpenAI 认证接口。HTTP 403 表示接口拒绝了请求；改用 SDK、打开网页或转发回调端口都不会自动解决出站访问问题。插件只返回脱敏的错误类别，不显示 SDK 原始响应或凭据。具体网络出口、访问权限和模型授权需要在部署环境中验证。

从 0.1.15 开始，登录入口统一放在模型页的 **Codex Bridge** 提供商卡片中，位于「添加模型提供商」上方，不再添加独立的设置 tab。公网模型页在原版 DSH 中可能显示 `settings are unavailable in this browser`，此时该登录卡片受宿主限制而不可用。插件不修改 DSH 本体。

`/codex-login` 启动网页登录，在 **设置 → 模型 → Codex Bridge** 卡片中打开授权入口；`/codex-login status` 查看状态，`/codex-login cancel` 取消授权。命令输出与会话日志不包含授权 URL、一次性设备码、SDK 原始错误或登录令牌。

## 凭据与升级

默认凭据为 `$DSH_HOME/plugins/dsh-codex-bridge/codex/auth.json`，未设置 `DSH_HOME` 时使用 `~/.dsh`。插件拒绝将凭据写入本机 `.codex` 或环境变量 `CODEX_HOME` 指定的目录。新登录保存插件标记的版本 1 OAuth 文件，父目录权限为 `0700`，文件为 `0600`，通过临时文件和原子替换提交。保存与刷新使用文件锁，避免并发请求重复使用已轮换的刷新令牌。

模型请求发现插件凭据过期时，通过 SDK 刷新并保存新凭据；设置状态查询只读取文件，不发起续期。认证服务返回 HTTP 401 后，本次服务运行会按令牌指纹将对应缓存标记失效，即使 JWT 的本地到期时间尚未到，设置也不再显示已登录。下一次请求会尝试续期插件管理的新格式凭据；旧版 CLI 缓存仍须重新授权。续期失败保留原文件，返回 `CODEX_AUTH_REFRESH_FAILED`，检查网络或重新登录。令牌、刷新令牌和完整授权 URL 不进入设置状态 JSON 或 DSH 日志。网页登录通过已认证的 Connection RPC 单独获取经校验的 OpenAI HTTPS 授权链接，兼容 macOS 桌面应用的外部浏览器打开规则；链接不进入状态快照、命令输出或日志，仅在当前授权等待期间提供。旧的 `/api/codex-bridge/login/open` 跳转入口继续保留。响应使用 `no-store`，授权链接使用 `noopener noreferrer`。

从 `0.1.10` 或更早版本升级到 `0.1.11` 后，不再需要 CLI。原插件专用目录中的旧 CLI 登录缓存，在 access token 有效时可继续读取；插件不自动迁移或刷新其中的 refresh token，过期后请重新授权。新格式由插件管理，旧插件不支持读取；回退旧版本时需要重新使用旧版登录。旧配置中的 `codexCommand`、`cliDetectionTimeoutMs` 和 `loginKillTimeoutMs` 已无作用，可移除；`authFile` 保持兼容。

认证、续期与模型请求均使用宿主 pi-ai。从 0.1.13 开始，插件不再补充 GPT-6.1 Sol 或其他模型元数据，目录完全跟随宿主；已有 `models` 配置必须引用宿主目录中的模型，否则加载时会报错。可将 `models` 清空以使用完整宿主目录。

这是第三方对 Codex 订阅接口的兼容实现，复用 SDK 的 Codex OAuth 客户端。它与需要申请应用 client ID 的 [Sign in with ChatGPT 接入](https://developers.openai.com/siwc)不同。认证服务变化可能需要升级 SDK 或插件。

## 配置

`cordis.patch.yml` 通过 Bundle 默认启用插件；它是插件注册配置，不是 DSH 源码补丁。在 Profile 的插件配置中可设置：

```yaml
- insert:
    - id: dsh-codex-bridge
      name: '@zengshushu/dsh-codex-bridge'
      config:
        provider: codex-bridge
        displayName: Codex Bridge
        authFile: /path/to/plugin-private/auth.json
        models: [gpt-6-sol, gpt-6-luna]
```

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `provider` | `codex-bridge` | 唯一提供方路由名 |
| `displayName` | `Codex Bridge` | 模型选择器与设置卡片名称 |
| `authFile` | DSH 数据目录中的插件专用缓存 | 必须是绝对路径，文件名为 `auth.json` |
| `loginTimeoutMs` | `300000` | 两种登录方式的最长等待时间；下一次登录使用最新配置 |
| `authRefreshTimeoutMs` | `30000` | 令牌续期网络请求超时 |
| `models` | `[]` | 空数组使用 SDK 目录；未知或重复模型在加载时失败 |
| `baseURL` | `https://chatgpt.com/backend-api` | Codex 兼容端点，登录令牌会发送到此地址 |
| `streamIdleTimeoutMs` | `120000` | 流事件空闲超时 |
| `maxRequestImageBytes` | `20971520` | 请求图片的 base64 总字节上限 |
| `requestImagePixelBudget` | `16000000` | 请求图片总像素预算 |
| `requestImageMaxBytes` | `4194304` | DSH 图片处理的目标字节数 |

Codex 订阅接口不支持 `temperature` 和 `maxTokens`，插件返回 `UNSUPPORTED_OPTION`。思考级别在 DSH 中选择，模型的工具调用交给 DSH 执行。服务端模型错误沿用 DSH 的 `PI_AI_ERROR`，流空闲超时和请求重试由 DSH 适配器处理。

## 开发与验收

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm pack --dry-run
pnpm pack --pack-destination /tmp
CODEX_TEST_MODEL=gpt-6-sol pnpm test:live
```

测试使用合成凭据与认证响应，覆盖实际 SDK 的 PKCE 网页回调、设备码授权、取消、超时、插件卸载、凭据保存、并发续期、旧缓存兼容、RPC 脱敏，以及中英登录状态快照和现有模型协议。测试不需要真实 ChatGPT 登录。`test:live` 使用插件专用凭据发送短消息，消耗账号用量；可通过 `CODEX_AUTH_FILE` 指定插件缓存。真实环境登录和模型权限需单独验收。

没有独立应用启动命令；通过 DSH Profile 加载插件。仓库不包含凭据、DSH 用户数据或构建产物。
