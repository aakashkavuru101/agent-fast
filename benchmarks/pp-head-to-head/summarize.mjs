#!/usr/bin/env node
// Summarize run.mjs logs as a Markdown table.
// Usage: node summarize.mjs runs/<tool>-<n>.jsonl ... [--expect <formula start>]
// (--expect defaults to local.json's expectFormulaStart)
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p95 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(0.95 * xs.length) - 1] : NaN); // nearest rank
const squash = (s) => String(s ?? "").replace(/\s+/g, "");

/** lines: [{t, msg}] as written by run.mjs; expect: the formula's first line. */
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
  // A retry: the same tool called again right after that tool failed.
  const retries = timed.filter((c, i) => i > 0 && timed[i - 1].error && timed[i - 1].name === c.name).length;
  const byTool = {};
  for (const c of timed) if (Number.isFinite(c.ms)) (byTool[c.name] ??= { n: 0, ms: 0 }), byTool[c.name].n++, (byTool[c.name].ms += c.ms);
  const u = final?.usage ?? {};
  return {
    wallMs: lines.length ? lines.at(-1).t - lines[0].t : 0,
    calls: calls.length,
    errors: timed.filter((c) => c.error).length,
    retries,
    medianMs: median(ms),
    p95Ms: p95(ms),
    turns: turns.size,
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    costUsd: final?.total_cost_usd ?? 0,
    success: Boolean(final && !final.is_error && expect && squash(final.result).includes(squash(expect))),
    slowest: Object.entries(byTool).sort((a, b) => b[1].ms - a[1].ms).slice(0, 3)
      .map(([name, v]) => `${name} ${(v.ms / 1000).toFixed(0)} s (${v.n})`),
  };
}

const readRun = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

export function table(rows) {
  const s = (ms) => (ms / 1000).toFixed(1);
  const head = "| Run | Wall s | Browser calls | Errors | Retries | Median ms | p95 ms | Model turns | Input tokens | Output tokens | Cost USD | Success | Most time in (total, calls) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  return [head, ...rows.map(([name, r]) =>
    `| ${name} | ${s(r.wallMs)} | ${r.calls} | ${r.errors} | ${r.retries} | ${Math.round(r.medianMs)} | ${Math.round(r.p95Ms)} | ${r.turns} | ${r.inputTokens} | ${r.outputTokens} | ${r.costUsd.toFixed(2)} | ${r.success ? "yes" : "no"} | ${r.slowest.join(", ")} |`)].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--expect");
  const local = join(dirname(fileURLToPath(import.meta.url)), "local.json");
  const expect = i >= 0 ? argv.splice(i, 2)[1] : existsSync(local) ? JSON.parse(readFileSync(local, "utf8")).expectFormulaStart : undefined;
  if (!argv.length) { console.error("usage: node summarize.mjs <run.jsonl>... [--expect <text>]"); process.exit(2); }
  console.log(table(argv.map((f) => [basename(f, ".jsonl"), summarize(readRun(f), expect)])));
}
