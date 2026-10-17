# Paseo Antigravity Usage 插件开发计划与技术指南

本项目旨在为 Paseo 原生“系统设置 → 使用情况”（Settings → Usage）添加对 **Antigravity CLI (`agy`)** 的官方级配额监控与用量展示支持。

---

## 1. 背景与目标

- **当前现状**：
  - Paseo 官方安装包已内置 `antigravity-provider`（支持使用 `agy` 跑 Agent 任务），但内置的 Usage 数据源中仅有 Claude, Codex, Copilot, Cursor, Kimi 等，**缺少原生的 `antigravity-usage-source`**。
  - 社区插件 `usage-monitor` 实现了独立的 Antigravity 监控仪表盘与 Composer 药丸，但若要在 Paseo 系统的核心 Settings 面板中直接显示 Antigravity 配额卡片，需要通过 Paseo 插件的 `server.registerUsageSource` 原生扩展点进行接入。
- **项目目标**：
  - 实现一个符合 Paseo `requirements >= 0.9.2` 规范的原生插件。
  - 自动探测本地 `agy` CLI 二进制与登录会话。
  - 获取并解析 Antigravity 消费计划的两大核心配额池（Gemini 会话/周配额、Claude & GPT 第三方模型会话/周配额）。
  - 将配额卡片与重置时间倒计时无缝注入 Paseo 系统设置界面。

---

## 2. 核心架构与扩展点规范

### 2.1 服务端扩展点：`server.registerUsageSource`
Paseo 系统设置页面会扫描所有已启用的 `UsageSource`。插件只需在 `index.server.ts` 中注册：

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "antigravity",
    label: "Antigravity",
    icon: "icon.svg",
    input: inputSchema,
    discover: (scope) => discover(scope),
    fetch: fetchUsage,
  });
  return () => {};
}
```

### 2.2 数据契约接口（`@getpaseo/plugin/server/usage`）
- **`discover(scope)`**：探测本地凭据或配置文件，返回可用的账号实例 `UsageAccount[]`。
- **`fetch(input, fetchApi)`**：拉取最新配额状态，返回 `UsageReport`：
  - `windows`: 配额时间窗口数组（包含 `usedPct`, `resetsAt`, `durationMs`）。
  - `details`: 补充信息（如账号邮箱、订阅级别 `Free tier` / `Google AI Pro`）。
  - `tone`: 状态色彩指示（`neutral`, `warning`, `danger`）。

---

## 3. 技术实现要点与数据源

### 3.1 本地探针（Probe）与凭据发现
1. **CLI 路径探测**：
   - 优先检查 Windows 路径：`%LOCALAPPDATA%\agy\bin\agy.exe`。
   - 备选检查系统 `PATH` 中的 `agy`。
2. **OAuth 凭据获取**：
   - Antigravity 凭据托管于 OS 凭据管理器（Windows Credential Manager / Keyring）。
   - 可通过提取 `agy.exe` 二进制中的 Client ID 与 Secret 进行 Refresh Token 换票，或直接复用 `usage-monitor` 沉淀的提取器逻辑。

### 3.2 Google 配额接口定义
- **Endpoint**: Google Internal Code Assist API
- **RPC / Method**: `retrieveUserQuotaSummary` 与 `loadCodeAssist`
- **解析目标（4 个核心桶）**：
  1. `gemini-5h`：Gemini 模型 5 小时滚动配额（Session）。
  2. `gemini-weekly`：Gemini 模型周重置配额（Weekly）。
  3. `3p-5h`：Claude 3.5/3.7 & GPT-4o 等第三方模型 5 小时配额。
  4. `3p-weekly`：第三方模型周配额。
- **重置时间处理**：
  - `resetsAt` 为 ISO 8601 字符串或时间戳。
  - 根据 `durationMs` 计算重置倒计时与使用速率指示。

### 3.3 状态与异常降级
- **未登录/找不到命令**：`unavailable({ kind: "unauthenticated", status: 401 })`，提供友好的诊断提示。
- **Free tier 特性适配**：免费版账号 `gemini-5h` 桶常驻为满额且仅周配额生效，需在 `details` 中标明 `Free tier`，避免被误判为探测失效。

---

## 4. 阶段开发任务清单 (Checklist)

### 阶段一：基础架构与项目初始化
- [x] 创建插件基础目录结构与配置文件（`paseo-plugin.json`, `package.json`, `tsconfig.json`）。
- [x] 撰写开发指南与架构规划文档（`TODO.md`）。
- [ ] 准备 Antigravity 品牌图标资源（`icon.svg`）。
- [ ] 编写输入 Schema 与共享类型定义（`shared/input.ts`）。

### 阶段二：探针与鉴权逻辑实现
- [ ] 实现 `server/probe.ts`：
  - [ ] 探测 `agy.exe` 二进制文件与系统环境变量。
  - [ ] 实现 Windows Credential Manager / Keyring 读取模块。
  - [ ] 实现 OAuth Token 获取与自动刷新逻辑（Refresh Token Flow）。
- [ ] 编写单元测试验证探针在 Windows 上的可用性。

### 阶段三：配额拉取与转换器
- [ ] 实现 `server/usage.ts`：
  - [ ] 实现 `discover()` 函数：返回默认的 Antigravity 账号。
  - [ ] 实现 `fetchUsage()` 函数：调用配额接口并提取 4 个核心桶数据。
  - [ ] 数据转换：将原始响应映射为 Paseo 标准 `UsageReport` 结构。
  - [ ] 处理网络超时、401/403 权限拒绝与无效响应边界。

### 阶段四：插件入口整合与联调验证
- [ ] 在 `index.server.ts` 中完成 `server.registerUsageSource` 组装。
- [ ] 执行 `npm run typecheck` 验证类型正确性。
- [ ] 本地安装至 Paseo：
  ```bash
  paseo plugin install .
  ```
- [ ] 打开 Paseo 客户端进入 **系统设置 → 使用情况**，验证 Antigravity 卡片与配额条显示。
- [ ] 检查 `paseo plugin logs paseo-agy-usage` 排查后台日志。

### 阶段五：进阶特性（可选）
- [ ] 解析本地 `~/.gemini/antigravity-cli/conversations/*.db`，提供本地 Turn-by-Turn 的 Token 消耗统计。
- [ ] 在输入框顶部注册 Composer Pill 药丸（`addComposerPill`），在对话时实时显示当前会话余量。

---

## 5. 参考引用
- Paseo 官方内置源码：`resources/builtin-plugins/claude-usage-source`
- Paseo 官方内置 Provider：`resources/builtin-plugins/antigravity-provider`
- 社区成熟实现：`ABorakati/paseo-usage-monitor` (`antigravity-probe.server.ts` & `antigravity-usage.server.ts`)
- Paseo 插件开发文档：[https://paseo.sh/docs/plugins/reference.md](https://paseo.sh/docs/plugins/reference.md)
