import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { CredentialStore } from "../shared/input.js";
import { WINDOWS_CREDENTIAL_SCRIPT } from "./windows-credential.js";
import { UsageError } from "./errors.js";

const execFileAsync = promisify(execFile);
const KEYRING_PREFIX = "go-keyring-base64:";

export class ProbeError extends UsageError {}

export interface StoredCredential {
  accessToken: string | null;
  expiresAtMs: number | null;
  email: string | null;
}

export interface AntigravityProbe {
  store: CredentialStore;
  /** Non-secret OS-user/store locator used when account metadata is absent. */
  locator: string;
  locateBinary(): Promise<string | null>;
  readCredential(signal: AbortSignal): Promise<StoredCredential | null>;
}

export interface CommandResult {
  stdout: string;
  exitCode: number;
  hasDiagnostic?: boolean;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<CommandResult>;

function exitCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "number" ? error.code : null;
}

const runCommand: CommandRunner = async (file, args, signal) => {
  try {
    const { stdout } = await execFileAsync(file, [...args], {
      encoding: "utf8",
      timeout: 3_500,
      maxBuffer: 128 * 1024,
      windowsHide: true,
      signal,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    if (signal.aborted) throw new ProbeError("Antigravity credential lookup timed out.");
    const code = exitCode(error);
    if (code !== null) {
      const hasDiagnostic = typeof error === "object" && error !== null && "stderr" in error
        && typeof error.stderr === "string" && error.stderr.trim() !== "";
      return { stdout: "", exitCode: code, hasDiagnostic };
    }
    // execFile errors can carry stdout containing credentials. Never propagate them.
    throw new ProbeError("Cannot run the system credential reader. Check OS keyring availability.");
  }
};

const tokenSchema = z.object({
  access_token: z.string().optional(),
  accessToken: z.string().optional(),
  refresh_token: z.string().optional(),
  refreshToken: z.string().optional(),
  expiry: z.union([z.string(), z.number()]).optional(),
  expires_at: z.union([z.string(), z.number()]).optional(),
  expiresAt: z.union([z.string(), z.number()]).optional(),
  expiry_date: z.union([z.string(), z.number()]).optional(),
  email: z.string().optional(),
  id_token: z.unknown().optional(),
  idToken: z.unknown().optional(),
});

const storedSchema = tokenSchema.extend({ token: tokenSchema.optional() });

/** Accept RFC3339, Unix seconds and Unix milliseconds, but never invent an expiry. */
export function timestampMs(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric)
    ? numeric < 100_000_000_000 ? numeric * 1000 : numeric
    : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms : null;
}

/** Read locally stored identity metadata for the account label, not authentication. */
function emailFromIdToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return z.object({ email: z.email() }).safeParse(claims).data?.email ?? null;
  } catch {
    return null;
  }
}

/** go-keyring stores a JSON token envelope, sometimes wrapped in base64. */
export function parseStoredCredential(raw: string): StoredCredential {
  let payload = raw.trim();
  if (payload.startsWith(KEYRING_PREFIX)) {
    payload = Buffer.from(payload.slice(KEYRING_PREFIX.length), "base64").toString("utf8");
  }
  let document: unknown;
  try {
    document = JSON.parse(payload);
  } catch {
    throw new ProbeError("The Antigravity keyring item is not valid JSON.");
  }
  const parsed = storedSchema.safeParse(document);
  if (!parsed.success) throw new ProbeError("The Antigravity keyring item has an unsupported token shape.");
  const root = parsed.data;
  const token = root.token ?? root;
  const accessToken = token.access_token || token.accessToken || null;
  if (!accessToken && !token.refresh_token && !token.refreshToken) {
    throw new ProbeError("The Antigravity keyring item contains no OAuth login.");
  }
  // Refresh tokens are deliberately not retained or redeemed. Paseo's native usage
  // contract delegates refresh to the CLI so its credential store remains authoritative.
  return {
    accessToken,
    expiresAtMs: timestampMs(token.expiry ?? token.expires_at ?? token.expiresAt ?? token.expiry_date),
    email: root.email || token.email || emailFromIdToken(root.id_token ?? root.idToken ?? token.id_token ?? token.idToken),
  };
}

export interface ProbeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  run?: CommandRunner;
  isExecutable?: (path: string) => Promise<boolean>;
}

export function createNodeProbe(options: ProbeOptions = {}): AntigravityProbe {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const windows = platform === "win32";
  const path = windows ? win32 : posix;
  const run = options.run ?? runCommand;
  const isExecutable = options.isExecutable ?? (async (file: string) => {
    try {
      if (!(await stat(file)).isFile()) return false;
      await access(file, windows ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  const store: CredentialStore = windows ? "windows-credential-manager"
    : platform === "darwin" ? "macos-keychain" : "secret-service";

  return {
    store,
    locator: `${platform}:${home}:gemini:antigravity`,
    async locateBinary() {
      const candidates: string[] = [];
      if (windows && env.LOCALAPPDATA) {
        candidates.push(path.join(env.LOCALAPPDATA, "agy", "bin", "agy.exe"));
      }
      // Resolve PATH ourselves: never execute an untrusted candidate merely to probe it.
      const searchPath = env.PATH ?? env.Path ?? "";
      for (const rawDirectory of searchPath.split(path.delimiter)) {
        const directory = rawDirectory.replace(/^"|"$/g, "");
        if (!path.isAbsolute(directory)) continue;
        candidates.push(path.join(directory, windows ? "agy.exe" : "agy"));
      }
      if (!windows) {
        // Desktop daemons can have a narrower PATH than an interactive shell.
        candidates.push(path.join(home, ".local", "bin", "agy"), "/usr/local/bin/agy");
        if (platform === "darwin") candidates.push("/opt/homebrew/bin/agy");
      }
      for (const candidate of new Set(candidates)) {
        if (await isExecutable(candidate)) return candidate;
      }
      return null;
    },
    async readCredential(signal) {
      let result: CommandResult;
      if (windows) {
        const powershell = env.SystemRoot
          ? path.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
          : "powershell.exe";
        result = await run(powershell, [
          "-NoProfile", "-NonInteractive", "-EncodedCommand",
          Buffer.from(WINDOWS_CREDENTIAL_SCRIPT, "utf16le").toString("base64"),
        ], signal);
      } else if (platform === "darwin") {
        result = await run("/usr/bin/security", [
          "find-generic-password", "-s", "gemini", "-a", "antigravity", "-w",
        ], signal);
        if (result.exitCode === 44) return null; // errSecItemNotFound
      } else if (platform === "linux") {
        // Requires libsecret's secret-tool and an unlocked Secret Service session.
        result = await run("secret-tool", ["lookup", "service", "gemini", "username", "antigravity"], signal);
        if (result.exitCode === 1 && !result.hasDiagnostic) return null;
      } else {
        throw new ProbeError("Antigravity usage supports Windows, macOS and Linux keyrings only.");
      }
      if (result.exitCode !== 0) {
        throw new ProbeError("Cannot read the Antigravity keyring item. Check permissions and unlock the OS keyring.");
      }
      const raw = result.stdout.trim();
      return raw === "" ? null : parseStoredCredential(raw);
    },
  };
}
