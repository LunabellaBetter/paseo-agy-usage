import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";

interface UsageServerContext extends PluginServerContext {
  registerUsageSource?(options: {
    id: string;
    label: string;
    icon: string;
    input: unknown;
    discover: (scope?: unknown) => Promise<unknown>;
    fetch: (input: unknown) => Promise<unknown>;
  }): void;
}

export default function contribute(server: PluginServerContext) {
  // 向 Paseo 系统设置 -> 使用情况 (Settings -> Usage) 注册原生数据源
  const usageServer = server as UsageServerContext;
  if (typeof usageServer.registerUsageSource === "function") {
    usageServer.registerUsageSource({
      id: "antigravity",
      label: "Antigravity",
      icon: "icon.svg",
      input: inputSchema,
      discover: () => discover(),
      fetch: fetchUsage,
    });
  }

  return () => {
    // 插件卸载或热重载清理逻辑
  };
}
