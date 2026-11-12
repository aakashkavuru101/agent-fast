#!/usr/bin/env node
// Renders the README benchmark charts as SVG, one light and one dark file each, into benchmarks/charts/.
// The numbers are the published ones: head-to-head/results-2026-11-12.md (second run), latest.json
// medians, and agent-eval.json. Usage: node benchmarks/charts.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THEMES = {
  light: { text: "#1f2328", muted: "#59636e", bar: "#2a78d6", other: "#b3b1ab" },
  dark: { text: "#f0f6fc", muted: "#9198a1", bar: "#3987e5", other: "#5c5a55" },
};
const FONT = "font-family=\"-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif\"";
const ROW = 26;
const BAR = 14;
const LABEL_W = 230;
const BAR_W = 150;
const VALUE_W = 70;

const figures = {
  "head-to-head": {
    title: "Ten browsing tasks, same model (claude-opus-5-5), one session per task, lower is better",
    rows: [
      { label: "Agent-fast 0.4.0", highlight: true },
      { label: "Playwright MCP 0.0.83" },
      { label: "Chrome DevTools MCP 1.12.0" },
      { label: "Claude in Chrome" },
      { label: "agent-browser 0.41.2 (MCP)" },
    ],
    columns: [
      { title: "Wall time", values: [87, 122, 120, 164, 192], format: (v) => `${v} s` },
      { title: "Browser calls", values: [22, 31, 31, 34, 38], format: (v) => `${v}` },
      { title: "Model turns", values: [31, 40, 37, 42, 42], format: (v) => `${v}` },
      { title: "Input tokens", values: [280964, 425863, 554753, 644060, 1651353], format: (v) => `${(v / 1000).toFixed(0)}k` },
    ],
    note: "All five passed 10 of 10. Second run of 2026-11-12; the first run gave the same order.",
  },
  latency: {
    title: "Warm action latency, median of 50, Brave (Chromium 157)",
    rows: [
      { label: "Playwright, persistent page.title()" },
      { label: "Agent-fast in-process get title", highlight: true },
      { label: "Agent-fast MCP get title", highlight: true },
      { label: "Agent-fast MCP batch: url, title", highlight: true },
      { label: "agent-browser native get title" },
    ],
    columns: [{ title: "Median", values: [0.17, 0.31, 0.5, 1.35, 3.72], format: (v) => `${v.toFixed(2)} ms` }],
    note: "One-shot CLI commands (Agent-fast or the agent-browser wrapper) take about 58 ms: Node startup, not the browser.",
  },
  "agent-eval": {
    title: "Eight local tasks with a free local model through Ollama, one attempt each",
    rows: [{ label: "qwen3:4b (default)" }, { label: "qwen3.5:9b" }, { label: "llama3.2:3b" }],
    columns: [{ title: "Tasks passed of 8", values: [7, 6, 1], max: 8, format: (v) => `${v} of 8` }],
    note: "Hosted models run the same eval with their key set.",
  },
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// A bar with a rounded data end and a square start on the baseline.
const bar = (x, y, w, fill) => {
  const r = Math.min(4, w / 2);
  return `<path d="M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${BAR - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}z" fill="${fill}"/>`;
};

function render({ title, rows, columns, note }, t) {
  // 6.6 px per character approximates the 12 to 14 px system font, so a long note or title widens the figure.
  const width = Math.max(LABEL_W + columns.length * (BAR_W + VALUE_W) + 16, Math.ceil(Math.max(title.length * 7.4, note.length * 6.6)));
  const top = 58;
  const height = top + rows.length * ROW + 34;
  const mixed = rows.some((row) => row.highlight); // only then do the other rows go muted
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${FONT} font-size="13" role="img" aria-label="${esc(title)}">`,
    `<text x="0" y="16" font-size="14" font-weight="600" fill="${t.text}">${esc(title)}</text>`];
  columns.forEach((column, c) => {
    const x = LABEL_W + c * (BAR_W + VALUE_W);
    const max = column.max ?? Math.max(...column.values);
    out.push(`<text x="${x}" y="${top - 12}" fill="${t.muted}" font-size="12">${esc(column.title)}</text>`);
    out.push(`<line x1="${x}" y1="${top - 4}" x2="${x}" y2="${top + rows.length * ROW - 6}" stroke="${t.other}" stroke-opacity="0.5"/>`);
    column.values.forEach((value, i) => {
      const y = top + i * ROW;
      const w = Math.max(2, Math.round((value / max) * BAR_W));
      out.push(bar(x, y, w, !mixed || rows[i].highlight ? t.bar : t.other));
      out.push(`<text x="${x + w + 6}" y="${y + BAR - 2}" fill="${t.text}" font-size="12">${esc(column.format(value))}</text>`);
    });
  });
  rows.forEach((row, i) => {
    const y = top + i * ROW + BAR - 2;
    out.push(`<text x="0" y="${y}" fill="${t.text}" font-weight="${row.highlight ? 600 : 400}">${esc(row.label)}</text>`);
  });
  out.push(`<text x="0" y="${height - 8}" fill="${t.muted}" font-size="12">${esc(note)}</text>`, "</svg>\n");
  return out.join("\n");
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "charts");
mkdirSync(dir, { recursive: true });
for (const [name, figure] of Object.entries(figures)) {
  for (const [theme, t] of Object.entries(THEMES)) writeFileSync(join(dir, `${name}-${theme}.svg`), render(figure, t));
}
console.log(`wrote ${Object.keys(figures).length * 2} charts to ${dir}`);
