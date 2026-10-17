import type { AntigravityUsageInput } from "../shared/input.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// 注：当安装了 @getpaseo/plugin 时直接从 @getpaseo/plugin/server/usage 引入
// 当前提供类型声明保障脚手架结构就绪
export interface UsageAccount {
  key: string;
  input: AntigravityUsageInput;
}

export interface UsageWindow {
  id: string;
  label: string;
  usedPct?: number | null;
  resetsAt?: string | null;
  durationMs?: number;
}

export interface UsageDetail {
  id: string;
  label: string;
  value: string;
}

export interface UsageReport {
  windows: UsageWindow[];
  details: UsageDetail[];
  tone?: "neutral" | "warning" | "danger";
}

/**
 * 探测本地已安装的 Antigravity CLI (agy)
 */
export async function discover(): Promise<UsageAccount[]> {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates: string[] = [];

  if (localAppData) {
    candidates.push(join(localAppData, "agy", "bin", "agy.exe"));
  }
  candidates.push("agy");

  for (const binaryPath of candidates) {
    if (binaryPath === "agy" || existsSync(binaryPath)) {
      return [{ key: "default", input: { binaryPath } }];
    }
  }

  return [];
}

/**
 * 拉取 Antigravity 配额状态
 */
export async function fetchUsage(
  input: AntigravityUsageInput,
  fetchApi: typeof fetch = fetch,
): Promise<UsageReport> {
  // TODO: 结合 server/probe.ts 获取 OAuth Token 并请求 Google Code Assist 内部接口
  return {
    windows: [
      {
        id: "gemini-5h",
        label: "Gemini · 5h",
        usedPct: 0,
        resetsAt: null,
        durationMs: 18_000_000,
      },
      {
        id: "gemini-weekly",
        label: "Gemini · Weekly",
        usedPct: 0,
        resetsAt: null,
        durationMs: 604_800_000,
      },
      {
        id: "3p-5h",
        label: "Claude & GPT · 5h",
        usedPct: 0,
        resetsAt: null,
        durationMs: 18_000_000,
      },
      {
        id: "3p-weekly",
        label: "Claude & GPT · Weekly",
        usedPct: 0,
        resetsAt: null,
        durationMs: 604_800_000,
      },
    ],
    details: [
      {
        id: "plan",
        label: "Plan",
        value: "Antigravity Plan",
      },
    ],
    tone: "neutral",
  };
}
