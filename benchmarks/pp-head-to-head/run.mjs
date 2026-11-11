#!/usr/bin/env node
// One BM2 run for one browser tool: spawns `claude -p` with only that tool's MCP tools and
// saves every stream-json line, timestamped on arrival, to runs/<tool>-<n>.jsonl.
// Usage: node run.mjs <agent-fast|playwright|chrome> <n> [--prompt <text>]
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TOOLS = {
  "agent-fast": { config: "agent-fast.mcp.json", allow: "mcp__agent-fast" },
  playwright: { config: "playwright.mcp.json", allow: "mcp__playwright" },
  chrome: { chrome: true, allow: "mcp__claude-in-chrome" },
};
const MODEL = "claude-opus-5-5";
const EFFORT = "xhigh";
const MAX_MS = 45 * 60_000;

const [tool, n = "1", flag, promptArg] = process.argv.slice(2);
const spec = TOOLS[tool];
if (!spec || !/^\w+$/.test(n)) {
  console.error("usage: node run.mjs <agent-fast|playwright|chrome> <n> [--prompt <text>]");
  process.exit(2);
}
const prompt = flag === "--prompt" ? promptArg : JSON.parse(readFileSync(join(here, "local.json"), "utf8")).prompt;

const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--model", MODEL, "--effort", EFFORT,
  // Plain session: no user settings (hooks, plugins), no built-in tools, nothing outside the allow list.
  "--setting-sources", "project,local", "--tools", "", "--strict-mcp-config",
  "--allowedTools", spec.allow, "--permission-mode", "dontAsk", "--disable-slash-commands"];
if (spec.chrome) args.push("--chrome");
else args.push("--mcp-config", readFileSync(join(here, spec.config), "utf8").replaceAll("${HOME}", homedir()));

// A child launched from inside Claude Code must look like a plain terminal launch.
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT)/.test(k)));

mkdirSync(join(here, "runs"), { recursive: true });
const base = join(here, "runs", `${tool}-${n}`);
const out = createWriteStream(`${base}.jsonl`, { flags: "wx" }); // never overwrite a run
const err = createWriteStream(`${base}.stderr.log`);
const started = Date.now();
const child = spawn("claude", args, { env, stdio: ["ignore", "pipe", "pipe"] });
child.stderr.pipe(err);
const timer = setTimeout(() => child.kill("SIGTERM"), MAX_MS);

createInterface({ input: child.stdout }).on("line", (line) => {
  const t = Date.now();
  let msg;
  try { msg = JSON.parse(line); } catch { out.write(JSON.stringify({ t, text: line }) + "\n"); return; }
  out.write(JSON.stringify({ t, msg }) + "\n");
  if (msg.type === "assistant") for (const c of msg.message?.content ?? []) {
    if (c.type === "tool_use") console.log(`${((t - started) / 1000).toFixed(1)}s ${c.name}`);
  }
  if (msg.type === "result") console.log(`result: ${msg.subtype}, ${msg.num_turns} turns, ${(msg.duration_ms / 1000).toFixed(1)}s`);
});
child.on("close", (code) => {
  clearTimeout(timer);
  out.end();
  console.log(`exit ${code} -> ${base}.jsonl`);
});
