import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { policyPath, stateDirectory } from "./config.js";
import { daemonPid, daemonRequest, wireFor } from "./daemon.js";
import type { EngineResult, RuntimeConfig } from "./types.js";

const require = createRequire(import.meta.url);
let cachedEnginePath: string | undefined;

function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return execFileSync("ldd", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1000,
    }).toLowerCase().includes("musl");
  } catch {
    return existsSync("/lib/ld-musl-x86_64.so.1") || existsSync("/lib/ld-musl-aarch64.so.1");
  }
}

export function nativeEnginePath(): string {
  if (cachedEnginePath) return cachedEnginePath;
  const packagePath = require.resolve("agent-browser/package.json");
  const binDirectory = join(dirname(packagePath), "bin");
  const osKey = process.platform === "linux" && isMusl() ? "linux-musl" : process.platform;
  const archKey = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!archKey || !["darwin", "linux", "linux-musl", "win32"].includes(osKey)) {
    throw new Error(`unsupported engine platform: ${process.platform}-${process.arch}`);
  }
  const effectiveArch = osKey === "win32" && archKey === "arm64" ? "x64" : archKey;
  const extension = osKey === "win32" ? ".exe" : "";
  const binary = join(binDirectory, `agent-browser-${osKey}-${effectiveArch}${extension}`);
  if (!existsSync(binary)) throw new Error(`native engine binary not found: ${binary}`);
  cachedEnginePath = binary;
  return binary;
}

function engineEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME", "PATH", "USER", "LOGNAME", "SHELL", "TERM", "TMPDIR", "TEMP", "TMP",
    "SystemRoot", "windir", "LOCALAPPDATA", "APPDATA", "NO_COLOR", "CI",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  env.AGENT_BROWSER_NO_VERSION_CHECK = "1";
  env.NO_COLOR = "1";
  return env;
}

const versions = new Map<string, Promise<string | undefined>>();
/** The browser's Chromium major version, from the binary itself (Windows installs keep it as a folder name). */
export function browserVersion(executable: string): Promise<string | undefined> {
  let pending = versions.get(executable);
  if (!pending) {
    pending = (async () => {
      const text = process.platform === "win32"
        ? readdirSync(dirname(executable)).join("\n")
        : (await promisify(execFile)(executable, ["--version"], { env: engineEnvironment(), timeout: 5000 })).stdout;
      return /\b(\d+)\.\d+\.\d+\.\d+\b/.exec(text)?.[1];
    })().catch(() => undefined);
    versions.set(executable, pending);
  }
  return pending;
}

// Headless Chrome announces itself as "HeadlessChrome" and sets navigator.webdriver. A session that
// drives an installed browser sends that browser's own reduced user agent instead.
// shortcut: a user-agent override empties navigator.userAgentData.brands; upgrade when the engine can set UA metadata.
async function stealthArgs(config: RuntimeConfig): Promise<string[]> {
  const args = ["--disable-blink-features=AutomationControlled"];
  const major = config.executablePath && !config.headed ? await browserVersion(config.executablePath) : undefined;
  if (major) {
    const platform = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "X11; Linux x86_64";
    args.push(`--user-agent=Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`);
  }
  return args;
}

async function globalArgs(config: RuntimeConfig, browser: boolean): Promise<string[]> {
  const args = [
    "--session", config.session,
    "--max-output", String(config.maxOutput),
    "--action-policy", policyPath(config.policy),
    "--json",
  ];
  if (browser) {
    // Containment is the egress proxy, not the engine's own domain filter: that filter stalls
    // cross-origin iframes and cannot be combined with a persistent profile.
    // Loaded on demand: commands sent straight to a verified daemon never need it.
    const port = await (await import("./proxy.js")).ensureProxy(config.session, config.allowedDomains);
    args.push(
      "--proxy", `http://127.0.0.1:${port}`, "--proxy-bypass", "<-loopback>",
      "--args", ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", ...await stealthArgs(config)].join("\n"),
    );
    // A clicked download link would otherwise save into the user's own Downloads folder.
    const downloads = config.downloadDir ?? join(stateDirectory(), "downloads");
    mkdirSync(downloads, { recursive: true, mode: 0o700 });
    args.push("--download-path", downloads);
    if (config.profile) args.push("--profile", config.profile);
    if (config.executablePath) args.push("--executable-path", config.executablePath);
    if (config.headed) args.push("--headed");
  }
  return args;
}

export function truncate(value: unknown, limit: number): unknown {
  if (typeof value === "string") {
    return value.length > limit ? `${value.slice(0, limit)}\n[truncated ${value.length - limit} characters]` : value;
  }
  if (Array.isArray(value)) return value.map((item) => truncate(item, limit));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncate(item, limit)]));
  }
  return value;
}

/** One result shape for every transport: engine bookkeeping removed, long page strings cut with a visible marker. */
export function normalizeResult(raw: Record<string, unknown>, limit: number): EngineResult {
  const payload = raw.data ?? raw.result;
  let data = payload;
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const { lifecycle: _lifecycle, ...rest } = payload as Record<string, unknown>;
    data = rest;
  }
  const result: EngineResult = { success: raw.success === true };
  if (data !== undefined && data !== null) result.data = truncate(data, limit);
  if (raw.error !== undefined && raw.error !== null) result.error = truncate(raw.error, limit);
  if (typeof raw.code === "string") result.code = raw.code;
  if (typeof raw.warning === "string") result.warning = raw.warning;
  return result;
}

function executeEngine(config: RuntimeConfig, args: string[], input?: string): Promise<{
  stdout: string; stderr: string; code: number;
}> {
  return new Promise((resolvePromise, reject) => {
    if (config.signal?.aborted) { reject(new Error("engine command cancelled; completion is unknown")); return; }
    const child = spawn(nativeEnginePath(), args, {
      env: engineEnvironment(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const limits = { stdout: 2_000_000, stderr: 200_000 };
    const bytes = { stdout: 0, stderr: 0 };
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      config.signal?.removeEventListener("abort", onAbort);
      child.kill("SIGKILL");
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(error);
    };
    const onAbort = (): void => fail(new Error("engine command cancelled; completion is unknown"));
    config.signal?.addEventListener("abort", onAbort, { once: true });
    // Killing a command client cannot establish whether its browser action completed.
    const timer = setTimeout(() => fail(new Error(
      `engine command timed out after ${config.timeoutMs} ms; completion is unknown`,
    )), config.timeoutMs);
    timer.unref();
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const collect = (stream: "stdout" | "stderr") => (chunk: string): void => {
      if (settled) return;
      bytes[stream] += Buffer.byteLength(chunk);
      if (bytes[stream] > limits[stream]) fail(new Error(`engine ${stream} exceeded output limit; completion is unknown`));
      else if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      config.signal?.removeEventListener("abort", onAbort);
      if (signal) reject(new Error(`engine terminated by ${signal}; completion is unknown`));
      else if (code === null) reject(new Error("engine exited without a status; completion is unknown"));
      else resolvePromise({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}

// A daemon is used directly only after a command has run through the engine's own client with
// this exact configuration, and only while that same daemon process is still running. The marker
// file carries that proof to later one-shot CLI processes.
const verified = new Map<string, string>();
const fingerprint = (config: RuntimeConfig): string => JSON.stringify([
  config.session, config.policy, [...config.allowedDomains].sort(), config.executablePath, config.headed, config.profile,
  config.downloadDir,
]);
const markerPath = (session: string): string => join(stateDirectory(), `${session}.verified.json`);

function direct(config: RuntimeConfig): boolean {
  if (process.platform === "win32") return false;
  const pid = daemonPid(config.session);
  if (!pid) return false;
  const key = fingerprint(config);
  if (verified.get(key) === pid) return true;
  try {
    const marker = JSON.parse(readFileSync(markerPath(config.session), "utf8")) as { pid?: unknown; key?: unknown };
    if (marker.pid !== pid || marker.key !== key) return false;
    verified.set(key, pid);
    return true;
  } catch {
    return false;
  }
}

function verify(config: RuntimeConfig): void {
  const pid = daemonPid(config.session);
  if (!pid) return;
  verified.set(fingerprint(config), pid);
  writeFileSync(markerPath(config.session), JSON.stringify({ pid, key: fingerprint(config) }), { mode: 0o600 });
}

// After a failure the next command goes through the engine's client, which re-establishes the browser.
function unverify(config: RuntimeConfig): void {
  verified.delete(fingerprint(config));
  rmSync(markerPath(config.session), { force: true });
}

/** Runs commands in order, stopping at the first failure; the failed result is the last element. */
export async function runEngineBatch(config: RuntimeConfig, commands: string[][]): Promise<EngineResult[]> {
  if (commands.length === 0 || commands.length > 50) {
    throw new Error("batch must contain between 1 and 50 commands");
  }
  if (commands.some((command) => command.length === 0 || command.length > 20)) {
    throw new Error("each batch command must contain between 1 and 20 arguments");
  }
  const results: EngineResult[] = [];
  for (const command of commands) {
    const message = direct(config) ? wireFor(command) : null;
    if (!message) break;
    try {
      const result = normalizeResult(await daemonRequest(config.session, message, config.timeoutMs, config.signal), config.maxOutput);
      results.push(result);
      if (!result.success) {
        unverify(config);
        return results;
      }
    } catch (error) {
      unverify(config);
      if ((error as { notSent?: boolean }).notSent) break;
      throw error;
    }
  }
  if (results.length === commands.length) return results;

  const remaining = commands.slice(results.length);
  const input = JSON.stringify(remaining);
  if (input.length > 1_000_000) throw new Error("batch input exceeds 1000000 characters");
  // Commands travel as JSON on stdin, so page-derived values are never parsed as engine options.
  const { stdout, stderr, code } = await executeEngine(
    config, [...await globalArgs(config, true), "batch", "--bail", "--omit-command"], input,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "object" || item === null || typeof item.success !== "boolean")) {
    // Launch failures are reported as a single result object instead of a list.
    const single = parsed as { success?: unknown; error?: unknown } | null;
    if (single && single.success === false) return [...results, normalizeResult(single as Record<string, unknown>, config.maxOutput)];
    throw new Error(`engine returned an invalid batch response: ${stderr || stdout.slice(0, 2000)}`);
  }
  const spawned = (parsed as Record<string, unknown>[]).map((item) => normalizeResult(item, config.maxOutput));
  if (code !== 0 && (spawned.length === 0 || spawned.every((item) => item.success))) {
    throw new Error(stderr || `batch exited with status ${code}; completion is unknown`);
  }
  if (spawned.length === remaining.length && spawned.every((item) => item.success)) verify(config);
  return [...results, ...spawned];
}

const CLIENT_COMMANDS = new Set(["install", "doctor", "close", "auth"]);

export async function runEngine(config: RuntimeConfig, command: string[]): Promise<EngineResult> {
  const [name] = command;
  if (!name) return { success: false, error: "missing engine command" };
  try {
    if (!CLIENT_COMMANDS.has(name)) {
      return (await runEngineBatch(config, [command]))[0] ?? { success: false, error: "engine returned no result" };
    }
    if (name === "close") unverify(config);
    const { stdout, stderr, code } = await executeEngine(config, [...await globalArgs(config, name === "auth"), ...command]);
    if (name === "close") await (await import("./proxy.js")).stopProxy(config.session);
    let parsed: Record<string, unknown> | null = null;
    for (const line of stdout.trim().split(/\r?\n/).reverse()) {
      try {
        const candidate: unknown = JSON.parse(line);
        if (typeof candidate === "object" && candidate !== null && "success" in candidate) {
          parsed = candidate as Record<string, unknown>;
          break;
        }
      } catch { /* not a JSON line */ }
    }
    if (parsed && (code === 0 || parsed.success !== true)) return normalizeResult(parsed, config.maxOutput);
    if (code !== 0) return { success: false, error: stderr.trim() || `engine exited with status ${code}` };
    if (name === "install" && stdout.trim()) return { success: true, data: { output: stdout.trim() } };
    return { success: false, error: "engine returned an invalid response" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

let artifactCount = 0;
export function artifactPath(config: RuntimeConfig, kind: string, extension: string): string {
  const directory = config.artifactsDir ?? join(stateDirectory(), "artifacts");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `${config.session}-${kind}-${Date.now()}-${process.pid}-${++artifactCount}.${extension}`);
}

/** Best-effort screenshot of the page as it was when an action failed. */
export async function captureFailure(config: RuntimeConfig): Promise<{ screenshot?: string }> {
  try {
    const path = artifactPath(config, "failure", "png");
    const result = await runEngine({ ...config, timeoutMs: Math.min(config.timeoutMs, 5000), signal: undefined }, ["screenshot", path]);
    return result.success ? { screenshot: path } : {};
  } catch {
    return {};
  }
}

export async function runMcp(config: RuntimeConfig, keepOpen = false): Promise<number> {
  return (await import("./mcp.js")).runMcp(config, keepOpen);
}
