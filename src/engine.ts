import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { policyPath } from "./config.js";
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

function globalArgs(config: RuntimeConfig, json: boolean): string[] {
  const args = [
    "--session", config.session,
    "--content-boundaries",
    "--max-output", String(config.maxOutput),
    "--action-policy", policyPath(config.policy),
  ];
  if (json) args.push("--json");
  if (config.allowedDomains.length > 0) {
    args.push("--allowed-domains", config.allowedDomains.join(","));
  }
  if (config.executablePath) args.push("--executable-path", config.executablePath);
  if (config.headed) args.push("--headed");
  return args;
}

function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    for (const output of [candidate.stderr, candidate.stdout]) {
      if (typeof output === "string" && output.trim()) return output.trim();
    }
    if (typeof candidate.message === "string") return candidate.message;
  }
  return String(error);
}

function parseEngineResult(output: string): EngineResult | null {
  const lines = output.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && "success" in parsed) {
        return parsed as EngineResult;
      }
    } catch {
    }
  }
  return null;
}

function executeEngine(config: RuntimeConfig, args: string[], input?: string): Promise<{
  stdout: string; stderr: string; code: number;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(nativeEnginePath(), args, {
      env: engineEnvironment(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const outputLimit = input === undefined
      ? Math.min(Math.max(config.maxOutput * 6, 131_072), 2_000_000)
      : 2_000_000;
    const stderrLimit = input === undefined ? outputLimit : 200_000;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(error);
    };
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
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > outputLimit) fail(new Error("engine stdout exceeded output limit; completion is unknown"));
      else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (settled) return;
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > stderrLimit) fail(new Error("engine stderr exceeded output limit; completion is unknown"));
      else stderr += chunk;
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) reject(new Error(`engine terminated by ${signal}; completion is unknown`));
      else if (code === null) reject(new Error("engine exited without a status; completion is unknown"));
      else resolvePromise({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}

export async function runEngine(config: RuntimeConfig, command: string[]): Promise<EngineResult> {
  const [name, ...rest] = command;
  if (!name) return { success: false, error: "missing engine command" };
  const args = [...globalArgs(config, true), name, ...rest];
  try {
    const { stdout, stderr, code } = await executeEngine(config, args);
    const parsed = parseEngineResult(stdout);
    if (parsed && (code === 0 || !parsed.success)) return parsed;
    if (code !== 0) return { success: false, error: stderr.trim() || `engine exited with status ${code}` };
    if (name === "install" && stdout.trim()) {
      return { success: true, data: { output: stdout.trim() } };
    }
    throw new Error("engine returned an invalid response");
  } catch (error) {
    const output = errorText(error);
    return parseEngineResult(output) ?? { success: false, error: output };
  }
}

export async function runEngineBatch(
  config: RuntimeConfig,
  commands: string[][],
): Promise<EngineResult[]> {
  if (commands.length === 0 || commands.length > 50) {
    throw new Error("batch must contain between 1 and 50 commands");
  }
  if (commands.some((command) => command.length === 0 || command.length > 20)) {
    throw new Error("each batch command must contain between 1 and 20 arguments");
  }
  const input = JSON.stringify(commands);
  if (input.length > 1_000_000) throw new Error("batch input exceeds 1000000 characters");
  const { stdout, stderr, code } = await executeEngine(
    config, [...globalArgs(config, true), "batch", "--bail", "--omit-command"], input,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`engine returned an invalid batch response: ${stderr || stdout.slice(0, 2000)}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "object" || item === null || typeof item.success !== "boolean")) {
    throw new Error(`engine returned an invalid batch response: ${stderr || stdout.slice(0, 2000)}`);
  }
  if (code !== 0 && (parsed.length === 0 || parsed.every((item) => item.success))) {
    throw new Error(stderr || `batch exited with status ${code}; completion is unknown`);
  }
  return parsed as EngineResult[];
}

export async function runEngineChecked(config: RuntimeConfig, command: string[]): Promise<EngineResult> {
  const result = await runEngine(config, command);
  if (!result.success) {
    throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  }
  return result;
}

export async function runMcp(config: RuntimeConfig): Promise<number> {
  return (await import("./mcp.js")).runMcp(config);
}
