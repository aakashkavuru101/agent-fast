#!/usr/bin/env node
// Runs the task suite through one browser tool: one `claude -p` session per task, only that tool's
// MCP tools, every stream-json line timestamped on arrival into runs/<tool>/<task>.jsonl.
// Usage: node run.mjs <agent-fast|playwright|chrome|chrome-devtools|browser-use|agent-browser> [--tasks a,b] [--force]
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { serve } from "../fixtures.mjs";
import { PREAMBLE, tasks } from "./tasks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TOOLS = {
  "agent-fast": { config: "agent-fast.mcp.json", allow: "mcp__agent-fast" },
  playwright: { config: "playwright.mcp.json", allow: "mcp__playwright" },
  "chrome-devtools": { config: "chrome-devtools.mcp.json", allow: "mcp__chrome-devtools" },
  "browser-use": { config: "browser-use.mcp.json", allow: "mcp__browser-use" },
  "agent-browser": { config: "agent-browser.mcp.json", allow: "mcp__agent-browser" },
  chrome: { chrome: true, allow: "mcp__claude-in-chrome" },
};
const MODEL = "claude-opus-5-5";
const EFFORT = "xhigh";
const PORT = 38473; // fixed, so a rerun of one task gets the same URLs
const MAX_MS = 10 * 60_000;

const argv = process.argv.slice(2);
const tool = argv.shift();
const spec = TOOLS[tool];
if (!spec) { console.error(`usage: node run.mjs <${Object.keys(TOOLS).join("|")}> [--tasks a,b] [--force]`); process.exit(2); }
const only = argv.includes("--tasks") ? argv[argv.indexOf("--tasks") + 1].split(",") : null;
const force = argv.includes("--force");

const server = await serve(PORT);
const origin = `http://127.0.0.1:${PORT}`;
const baseArgs = ["--output-format", "stream-json", "--verbose", "--model", MODEL, "--effort", EFFORT,
  // Plain session: no user settings (hooks, plugins), no built-in tools, nothing outside the allow list.
  "--setting-sources", "project,local", "--tools", "", "--strict-mcp-config",
  "--allowedTools", spec.allow, "--permission-mode", "dontAsk", "--disable-slash-commands"];
if (spec.chrome) baseArgs.push("--chrome");
else baseArgs.push("--mcp-config", readFileSync(join(here, spec.config), "utf8")
  .replaceAll("${HOME}", homedir()).replaceAll("${REPO}", resolve(here, "..", "..")));
// A child launched from inside Claude Code must look like a plain terminal launch.
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT)/.test(k)));

const dir = join(here, "runs", tool);
mkdirSync(dir, { recursive: true });

for (const task of tasks(origin)) {
  if (only && !only.includes(task.name)) continue;
  const base = join(dir, task.name);
  if (existsSync(`${base}.jsonl`)) {
    if (!force) { console.log(`${task.name}: kept (use --force to rerun)`); continue; }
    rmSync(`${base}.jsonl`);
  }
  const out = createWriteStream(`${base}.jsonl`, { flags: "wx" });
  const err = createWriteStream(`${base}.stderr.log`);
  const started = Date.now();
  const child = spawn("claude", ["-p", PREAMBLE + task.prompt, ...baseArgs], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.pipe(err);
  const timer = setTimeout(() => child.kill("SIGTERM"), MAX_MS);
  await new Promise((done) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const t = Date.now();
      let msg;
      try { msg = JSON.parse(line); } catch { out.write(JSON.stringify({ t, text: line }) + "\n"); return; }
      out.write(JSON.stringify({ t, msg }) + "\n");
      if (msg.type === "result") console.log(`${task.name}: ${msg.subtype}, ${msg.num_turns} turns, ${(msg.duration_ms / 1000).toFixed(1)} s, answer: ${String(msg.result ?? "").slice(0, 80).replace(/\n/g, " ")}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      if (code !== 0) console.log(`${task.name}: exit ${code} after ${((Date.now() - started) / 1000).toFixed(0)} s`);
      done();
    });
  });
}
server.closeAllConnections();
server.close();
