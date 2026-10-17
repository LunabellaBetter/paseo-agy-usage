import {
  hashAccountKey,
  unavailable,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
} from "@getpaseo/plugin/server/usage";
import { inputSchema } from "../shared/input.js";
import { createNodeProbe, ProbeError, type AntigravityProbe } from "./probe.js";
import { mapQuotaSummary, readTierLabel } from "./quota.js";
import { UsageError } from "./errors.js";

const BASE_URL = "https://cloudcode-pa.googleapis.com/v1internal:";
const TOKEN_MARGIN_MS = 60_000;

export class QuotaHttpError extends UsageError {
  constructor(readonly status: number) {
    super(`Antigravity quota request failed (HTTP ${status}).`);
  }
}

/** Enforce a wall-clock bound even if an injected transport ignores abort. */
export async function withTimeout<T>(
  timeoutMs: number,
  phase: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new UsageError(`Antigravity ${phase} timed out.`));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function request(
  method: "retrieveUserQuotaSummary" | "loadCodeAssist",
  token: string,
  fetchApi: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchApi(BASE_URL + method, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "antigravity",
      },
      body: method === "loadCodeAssist" ? JSON.stringify({ metadata: { pluginType: "GEMINI" } }) : "{}",
      signal,
      redirect: "error", // Never forward bearer credentials to a redirected host.
    });
  } catch {
    throw new UsageError(`Antigravity ${method} request failed. Check network connectivity.`);
  }
  if (!response.ok) throw new QuotaHttpError(response.status);
  try {
    const document: unknown = await response.json();
    return document;
  } catch {
    // Response bodies may contain secrets or untrusted server messages.
    throw new UsageError(`Antigravity ${method} returned invalid JSON.`);
  }
}

export interface UsageDependencies {
  probe: AntigravityProbe;
  fetchApi: typeof fetch;
  now: () => number;
}

export function createUsageHandlers(dependencies: UsageDependencies) {
  const { probe, fetchApi, now } = dependencies;
  return {
    async discover(scope: UsageScope): Promise<UsageAccount[]> {
      // OS keyring login ownership cannot be inferred from an agent environment.
      // Do not silently attach the daemon user's default login to a session.
      if (scope.kind !== "global") return [];
      if (!(await probe.locateBinary())) return [];
      const credential = await withTimeout(4_000, "credential lookup", (signal) => probe.readCredential(signal));
      if (!credential) return [];
      return [{
        key: hashAccountKey(credential.email ? `antigravity:${credential.email}` : probe.locator),
        label: credential.email ?? "Antigravity",
        harness: "agy",
        input: { store: probe.store },
      }];
    },
    async fetch(input: unknown): Promise<UsageReport> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { status: "error", error: "Invalid Antigravity credential store input." };
      if (parsed.data.store !== probe.store) {
        return { status: "error", error: "This Antigravity credential store belongs to another operating system." };
      }
      try {
        // Re-read for every fetch. No access-token cache can outlive an agy login switch.
        const credential = await withTimeout(4_000, "credential lookup", (signal) => probe.readCredential(signal));
        if (!credential) {
          throw new ProbeError("The Antigravity login disappeared. Sign in with agy and rediscover usage accounts.");
        }
        if (credential.expiresAtMs !== null && credential.expiresAtMs <= now() + TOKEN_MARGIN_MS) {
          return unavailable({ kind: "expired", expiresAt: new Date(credential.expiresAtMs).toISOString(), refreshedBy: "agy" });
        }
        const token = credential.accessToken;
        if (!token) return unavailable({ kind: "rejected", status: 401, refreshedBy: "agy" });

        // Plan is best effort; a tier lookup failure must not hide valid quota.
        // Both run concurrently, keeping total fetch time below the host's 20s deadline.
        const [document, planLabel] = await Promise.all([
          withTimeout(6_500, "quota request", (signal) => request("retrieveUserQuotaSummary", token, fetchApi, signal)),
          withTimeout(2_500, "plan lookup", async (signal) => readTierLabel(await request("loadCodeAssist", token, fetchApi, signal))).catch(() => null),
        ]);
        return mapQuotaSummary(document, planLabel);
      } catch (error) {
        if (error instanceof QuotaHttpError && (error.status === 401 || error.status === 403)) {
          return unavailable({ kind: "rejected", status: error.status, refreshedBy: "agy" });
        }
        return {
          status: "error",
          error: error instanceof UsageError ? error.message : "Unable to read Antigravity usage.",
        };
      }
    },
  };
}

const handlers = createUsageHandlers({ probe: createNodeProbe(), fetchApi: fetch, now: Date.now });
export const discover = handlers.discover;

export function fetchUsage(input: unknown, fetchApi: typeof fetch = fetch): Promise<UsageReport> {
  return createUsageHandlers({ probe: createNodeProbe(), fetchApi, now: Date.now }).fetch(input);
}
