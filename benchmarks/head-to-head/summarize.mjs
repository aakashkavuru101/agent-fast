#!/usr/bin/env node
// Summarizes runs/<tool>/<task>.jsonl into two Markdown tables: one row per tool, and a pass matrix.
// Usage: node summarize.mjs [tool ...]   (default: every tool with a runs/ directory)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tasks } from "./tasks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p95 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(0.95 * xs.length) - 1] : NaN); // nearest rank
const squash = (s) => String(s ?? "").replace(/\s+/g, "");

/** One task's run: lines are [{t, msg}] as written by run.mjs; expect must appear in the final answer. */
export function summarize(lines, expect) {
  const calls = [], results = new Map(), turns = new Set();
  let final;
  for (const { t, msg } of lines) {
    if (!msg) continue;
    if (msg.type === "result") final = msg;
    for (const c of msg.message?.content ?? []) {
      if (msg.type === "assistant") turns.add(msg.message.id);
      if (c.type === "tool_use" && c.name.startsWith("mcp__")) calls.push({ id: c.id, name: c.name.split("__").pop(), t });
      if (c.type === "tool_result") results.set(c.tool_use_id, { t, error: c.is_error === true });
    }
  }
  const timed = calls.map((c) => ({ ...c, ms: results.has(c.id) ? results.get(c.id).t - c.t : NaN, error: results.get(c.id)?.error ?? false }));
  const ms = timed.map((c) => c.ms).filter(Number.isFinite);
  const u = final?.usage ?? {};
  return {
    wallMs: lines.length ? lines.at(-1).t - lines[0].t : 0,
    calls: calls.length,
    errors: timed.filter((c) => c.error).length,
    medianMs: median(ms),
    p95Ms: p95(ms),
    turns: turns.size,
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    costUsd: final?.total_cost_usd ?? 0,
    success: Boolean(final && !final.is_error && expect && squash(final.result).includes(squash(expect))),
  };
}
const suite = tasks("http://127.0.0.1:38473");
const read = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const navigatedTo = (lines, host) => lines.some(({ msg }) => (msg?.message?.content ?? [])
  .some((c) => c.type === "tool_use" && JSON.stringify(c.input ?? {}).includes(host)));

/** One tool's runs: per-task results plus totals. */
export function toolSummary(tool) {
  const dir = join(here, "runs", tool);
  const perTask = suite.map((task) => {
    const file = join(dir, `${task.name}.jsonl`);
    if (!existsSync(file)) return { task: task.name, missing: true };
    const lines = read(file);
    const r = summarize(lines, task.expect);
    const final = lines.map((l) => l.msg).find((m) => m?.type === "result");
    return { task: task.name, ...r, success: r.success && !(task.forbid && navigatedTo(lines, task.forbid)),
      answer: String(final?.result ?? "").slice(0, 60).replace(/\s+/g, " ") };
  });
  const ran = perTask.filter((t) => !t.missing);
  const ms = ran.flatMap((t) => (Number.isFinite(t.medianMs) ? [t] : [])); // tasks with timed calls
  const sum = (key) => ran.reduce((n, t) => n + t[key], 0);
  return {
    tool, perTask, ran: ran.length, passed: ran.filter((t) => t.success).length,
    wallMs: sum("wallMs"), calls: sum("calls"), errors: sum("errors"), turns: sum("turns"),
    inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), costUsd: sum("costUsd"),
    medianMs: ms.length ? ms.map((t) => t.medianMs).sort((a, b) => a - b)[ms.length >> 1] : NaN,
  };
}

export function tables(summaries) {
  const s = (ms) => (ms / 1000).toFixed(0);
  const overall = ["| Tool | Passed | Wall s | Browser calls | Errors | Median call ms | Model turns | Input tokens | Output tokens | API-equiv. USD |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...summaries.map((r) => `| ${r.tool} | ${r.passed} of ${r.ran} | ${s(r.wallMs)} | ${r.calls} | ${r.errors} | ${Math.round(r.medianMs)} | ${r.turns} | ${r.inputTokens.toLocaleString("en-US")} | ${r.outputTokens.toLocaleString("en-US")} | ${r.costUsd.toFixed(2)} |`)];
  const matrix = [`| Task | ${summaries.map((r) => r.tool).join(" | ")} |`, `|---|${summaries.map(() => "---").join("|")}|`,
    ...suite.map((task, i) => `| ${task.name} | ${summaries.map((r) => {
      const t = r.perTask[i];
      return t.missing ? "–" : `${t.success ? "pass" : "FAIL"} ${s(t.wallMs)} s, ${t.calls} calls${t.errors ? `, ${t.errors} err` : ""}`;
    }).join(" | ")} |`)];
  return `${overall.join("\n")}\n\n${matrix.join("\n")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runs = join(here, "runs");
  const tools = process.argv.length > 2 ? process.argv.slice(2) : existsSync(runs) ? readdirSync(runs) : [];
  if (!tools.length) { console.error("no runs yet: node run.mjs <tool>"); process.exit(2); }
  const summaries = tools.map(toolSummary);
  console.log(tables(summaries));
  for (const r of summaries) for (const t of r.perTask) if (!t.missing && !t.success) console.log(`\n${r.tool}/${t.task} answered: ${t.answer}`);
}
