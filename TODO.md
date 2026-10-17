# Paseo Antigravity Usage 开发计划与技术指南

为 Paseo 原生 **系统设置 → 使用情况（Settings → Usage）** 添加 Antigravity CLI (`agy`) 配额监控。

## 1. 实施基线与方案修订

已对照 Paseo 当前插件文档、`@getpaseo/plugin@0.11.4` 类型定义和本机内置 UsageSource 核实以下契约：

- `server.registerUsageSource` 要求 **Paseo >= 0.11.0**，原计划的 `>= 0.9.2` 不适用于该扩展点。
- `UsageReport` 是 `available` / `unavailable` / `error` 判别联合；`tone` 属于窗口或详情，取值为 `default` / `ok` / `warning` / `danger`。
- `UsageWindow` 使用 `usedPct`、`remainingPct` 和 ISO 格式 `resetsAt`，不接受 `durationMs`。窗口名依据接口的 `bucketId` 确定，不从重置倒计时推断周期。
- **鉴权方案修订**：当前原生 UsageSource 规范要求每次 fetch 重新读取 CLI 凭据，并明确禁止兑换 refresh token 或改写凭据库。因此取消原计划中的二进制 OAuth Client ID/Secret 提取与插件自动刷新，由 agy 管理令牌刷新。插件读取 access token、检测过期并返回 `refreshedBy: "agy"` 的原生问题类型。
- 账号 input 只保存凭据库定位符，不能保存 token。账号 key 使用官方 `hashAccountKey()`；令牌不进入 input、report 或日志。

## 2. 当前架构

```text
index.server.ts                 注册原生 UsageSource
shared/input.ts                 严格的凭据库输入 Schema
server/probe.ts                 CLI 定位、凭据解析、OS Keyring 适配
server/windows-credential.ts    PowerShell / CredReadW 只读桥接
server/usage.ts                 账号发现、请求鉴权、截止时间、错误映射
server/quota.ts                 4 个核心桶与订阅计划转换
server/errors.ts                可安全展示的内部错误类型
server/usage.test.ts            discover / fetch 接缝处的行为测试
```

入口直接使用官方 `PluginServerContext`，移除了脚手架中的本地占位接口和可选方法断言。数据模型全部来自 `@getpaseo/plugin/server/usage`。

### 2.1 探针与账号发现

- Windows 优先检查 `%LOCALAPPDATA%\agy\bin\agy.exe`，再搜索 PATH。
- Unix 搜索 PATH，并补查 `~/.local/bin/agy`、`/usr/local/bin/agy` 和 macOS 的 `/opt/homebrew/bin/agy`。
- 检查实际文件与可执行权限，不执行 agy，不将相对 PATH 项当作可信候选。
- Windows 使用 `CredReadW("gemini:antigravity")`，macOS 使用 Keychain 的 `service=gemini, account=antigravity`，Linux 使用 `secret-tool lookup service gemini username antigravity`。
- Linux 需要 libsecret 的 `secret-tool` 和可访问、已解锁的 Secret Service 会话。macOS/Linux 尚未在真实宿主上联调；当前精简测试聚焦 Windows 登录到配额报告的完整行为。
- 支持嵌套 token、平铺字段、snake_case / camelCase、`go-keyring-base64:` 包装，以及 ISO / Unix 秒 / 毫秒过期时间。账号邮箱优先使用显式字段，否则从 agy 保存的 `id_token` 本地解码，仅作为账号标签显示。
- global discovery 只有同时找到 CLI 与登录项才返回账号；过期登录仍可发现。session discovery 返回空数组，避免将 daemon 用户的默认 OS 登录误配给某个 Agent。

### 2.2 Google Code Assist 接口

向固定 HTTPS 域名发送 Bearer 鉴权 POST，并禁止重定向：

- `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`，请求体 `{}`。
- `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`，请求体 `{"metadata":{"pluginType":"GEMINI"}}`，仅用于最佳努力获取计划标签。

按 `groups[].buckets[].bucketId` 匹配并固定输出顺序：

| ID | 配额池 | 周期 |
| --- | --- | --- |
| `gemini-5h` | Gemini | 5 小时 |
| `gemini-weekly` | Gemini | 周 |
| `3p-5h` | Claude & GPT | 5 小时 |
| `3p-weekly` | Claude & GPT | 周 |

`usedPct = clamp((1 - remainingFraction) * 100, 0, 100)`。缺失或无效桶使用 `null`，不会生成占位 0%。计划优先读 `g1Tier` / `paidTier`，再回退到 Code Assist 的 `currentTier`，避免将付费账号误标成 Free tier。

### 2.3 状态与异常

- 无 CLI 或无登录项：discover 返回 `[]`；发现后凭据消失：fetch 返回 `error`。
- 已过期或剩余有效期不足 60 秒：`unavailable({ kind: "expired", expiresAt, refreshedBy: "agy" })`。
- 无可用 access token、上游 401/403：`rejected`；原方案中的 `unauthenticated` 不属于当前 SDK 契约。
- 无核心配额池：`no_quota`。网络错误、429/5xx、无效 JSON/结构：安全的 `error`，不转发原始响应体或子进程错误。
- 凭据读取最多 4 秒；配额请求最多 6.5 秒；计划查询最多 2.5 秒，与配额并行。整体低于宿主单次 fetch 的 20 秒截止时间；超时主动 abort。
- Free tier 在 details 中解释 5h 桶可能保持满余量、应参考周配额；保留服务端实际读数。

## 3. 分阶段任务清单

### 阶段一：基础架构
- [x] 项目配置、图标和共享输入 Schema。
- [x] 锁定 SDK、升级 Zod 4、提交依赖锁文件。
- [x] 启用 strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes 与未使用符号检查。

### 阶段二：探针与鉴权
- [x] CLI 路径与环境变量探测。
- [x] Windows Credential Manager / macOS Keychain / Linux Secret Service 读取适配。
- [x] access token 读取、过期检测、每次 fetch 重读；原自动刷新任务按官方契约取消。
- [x] Windows 登录发现与报告行为测试、本机真实凭据读取冒烟验证（只输出布尔状态）。

### 阶段三：配额拉取与转换
- [x] global discover、稳定账号 key、严格 input 校验。
- [x] 两个 Google RPC、4 个核心桶、计划标签、重置时间与窗口级 tone。
- [x] Free tier、缺失桶、重复桶、非法读数和时间戳边界。
- [x] 超时、401/403、429/5xx、无效响应与安全错误处理。

### 阶段四：原生接入与验证
- [x] 直接调用 `server.registerUsageSource`。
- [x] `npm run typecheck`、`npm test`（7 项行为测试）、`npm run build`。
- [x] 卡片底部显示账号邮箱；计划仅保留标题旁标签，移除重复的 Plan 与 Account 详情行。
- [x] 本机真实接口验证：报告为 available，计划为 Google AI Pro，4 个桶均有有效读数与重置时间；未记录令牌或账号邮箱。
- [x] 安装到本机 Paseo 0.11.4（事先确认 pluginsEnabled 已开启），插件状态为 running。
- [x] 检查 `paseo plugin logs paseo-agy-usage`：Plugin ready，无启动错误。
- [ ] 在 Paseo 客户端手动打开 Settings → Usage，确认卡片、百分比与倒计时的视觉表现。

### 阶段五：可选扩展
- [ ] 读取本地 conversations 数据库，提供 Turn-by-Turn 消耗统计。
- [ ] 注册 Composer Pill；先定义可靠的 session 登录归属规则。
- [ ] macOS / Linux 真实系统凭据联调。

### 阶段六：GitHub 发布准备
- [x] 英文 README、英文 OVERVIEW、MIT LICENSE、CHANGELOG 与发布指南。
- [x] 重绘 UsageSource 单色 SVG 与仓库/插件列表彩色 PNG 图标。
- [x] GitHub 安装声明锁定依赖准备命令；保留 `private: true`，不发布 npm 包。
- [x] Node.js 24 开发环境、Windows / Linux CI、tag 触发的 GitHub Release 工作流。
- [x] 已推送公开仓库 `breathi3552/paseo-agy-usage`；Windows / Linux CI 均通过。
- [x] 真实 Git 安装冒烟验证：远程提交 `bfc00c7` 安装为 running，日志为 Plugin ready；测试安装已移除，本地开发插件已恢复运行。UsageSource ID 是全局的，验证第二份安装前需停用原实例。
- [ ] 首个正式版本 tag 与 Paseo 插件市场提交（发布准备完成后单独执行）。

## 4. 开发与复验

```bash
npm ci
npm run typecheck
npm test
npm run build
paseo plugin install .
# 已安装后修改源文件使用：
paseo plugin reload paseo-agy-usage
paseo plugin ls
paseo plugin logs paseo-agy-usage
```

插件安装前检查目标 daemon 的 `pluginsEnabled`；本项目不自动打开全局插件开关，也不重启 daemon。

## 5. 参考

- [Paseo Usage sources 官方契约](https://paseo.sh/docs/plugins/reference.md#usage-sources)
- 本机内置 `claude-usage-source` 与 `antigravity-provider`。
- [ABorakati/paseo-usage-monitor](https://github.com/ABorakati/paseo-usage-monitor)：核对凭据库目标、原始配额结构与计划字段；未引入其自动刷新逻辑。
