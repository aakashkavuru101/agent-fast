import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { policyPath } from "./config.js";
import type { EngineResult, RuntimeConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function engineEntry(): string {
  const packagePath = require.resolve("agent-browser/package.json");
  return join(dirname(packagePath), "bin", "agent-browser.js");
}

function engineEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME", "PATH", "USER", "LOGNAME", "SHELL", "TERM", "TMPDIR", "TEMP", "TMP",
    "SystemRoot", "windir", "LOCALAPPDATA", "APPDATA", "NO_COLOR",
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

export async function runEngine(config: RuntimeConfig, command: string[]): Promise<EngineResult> {
  const [name, ...rest] = command;
  if (!name) return { success: false, error: "missing engine command" };
  const args = [...globalArgs(config, true), name, ...rest];
  try {
    const { stdout } = await execFileAsync(process.execPath, [engineEntry(), ...args], {
      env: engineEnvironment(),
      timeout: config.timeoutMs,
      killSignal: "SIGTERM",
      maxBuffer: Math.min(Math.max(config.maxOutput * 6, 131_072), 2_000_000),
      windowsHide: true,
    });
    const parsed = parseEngineResult(stdout);
    if (parsed) return parsed;
    if (name === "install" && stdout.trim()) {
      return { success: true, data: { output: stdout.trim() } };
    }
    throw new Error("engine returned an invalid response");
  } catch (error) {
    const output = errorText(error);
    return parseEngineResult(output) ?? { success: false, error: output };
  }
}

export async function runEngineChecked(config: RuntimeConfig, command: string[]): Promise<EngineResult> {
  const result = await runEngine(config, command);
  if (!result.success) {
    throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  }
  return result;
}

export function runMcp(config: RuntimeConfig): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [engineEntry(), ...globalArgs(config, false), "mcp"], {
      env: engineEnvironment(),
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`MCP server stopped by ${signal}`));
      else resolvePromise(code ?? 1);
    });
  });
}
