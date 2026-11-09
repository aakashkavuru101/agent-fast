import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { policyPath } from "../dist/config.js";
import { nativeEnginePath, runEngine, runEngineBatch } from "../dist/engine.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const chromePath = process.env.CHROME_PATH;
const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? "50");
if (!chromePath) throw new Error("CHROME_PATH is required");
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1000) {
  throw new Error("BENCHMARK_ITERATIONS must be between 1 and 1000");
}
process.env.AGENT_BROWSER_NO_VERSION_CHECK = "1";

const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>Agent-fast benchmark</title><h1>Agent-fast benchmark</h1><a href='/next'>Next</a>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const config = {
  session: "benchmark-fast",
  policy: "act",
  allowedDomains: ["127.0.0.1"],
  executablePath: chromePath,
  headed: false,
  maxOutput: 20000,
  timeoutMs: 60000,
};
const wrapper = join(dirname(require.resolve("agent-browser/package.json")), "bin", "agent-browser.js");

function directArgs(session) {
  return [
    "--session", session,
    "--content-boundaries",
    "--max-output", "20000",
    "--action-policy", policyPath("act"),
    "--executable-path", chromePath,
    "--json",
  ];
}

async function direct(executable, session, command) {
  const args = command[0] === wrapper
    ? [wrapper, ...directArgs(session), ...command.slice(1)]
    : [...directArgs(session), ...command];
  const { stdout } = await execFileAsync(executable, args, {
    timeout: 60000,
    maxBuffer: 1000000,
    env: { ...process.env, AGENT_BROWSER_NO_VERSION_CHECK: "1", NO_COLOR: "1" },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.success, true, JSON.stringify(result));
  return result;
}

async function measure(name, action) {
  const times = [];
  for (let index = 0; index < iterations; index++) {
    const started = performance.now();
    await action();
    times.push(performance.now() - started);
  }
  times.sort((left, right) => left - right);
  const median = iterations % 2 === 0
    ? (times[iterations / 2 - 1] + times[iterations / 2]) / 2
    : times[(iterations - 1) / 2];
  return {
    name,
    medianMs: median,
    meanMs: times.reduce((sum, value) => sum + value, 0) / times.length,
    p95Ms: times[Math.ceil(iterations * 0.95) - 1],
    minMs: times[0],
    maxMs: times[times.length - 1],
  };
}

let playwrightBrowser;
try {
  await runEngine(config, ["open", origin]);
  await direct(nativeEnginePath(), "benchmark-native", ["open", origin]);
  await direct(process.execPath, "benchmark-node", [wrapper, "open", origin]);
  playwrightBrowser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await playwrightBrowser.newPage();
  await page.goto(origin);

  const results = [];
  results.push(await measure("agent-fast-native-get-title", () => runEngine(config, ["get", "title"])));
  results.push(await measure("agent-browser-native-get-title", () => direct(nativeEnginePath(), "benchmark-native", ["get", "title"])));
  results.push(await measure("agent-browser-node-wrapper-get-title", () => direct(process.execPath, "benchmark-node", [wrapper, "get", "title"])));
  results.push(await measure("playwright-persistent-get-title", () => page.title()));
  results.push(await measure("agent-fast-state-batch", () => runEngineBatch(config, [["get", "url"], ["get", "title"]])));
  results.push(await measure("agent-fast-state-separate", async () => {
    await runEngine(config, ["get", "url"]);
    await runEngine(config, ["get", "title"]);
  }));
  const snapshot = await runEngine(config, ["snapshot", "-i"]);
  console.log(JSON.stringify({ iterations, results, snapshotCharacters: snapshot.data.snapshot.length }, null, 2));
} finally {
  if (playwrightBrowser) await playwrightBrowser.close();
  await Promise.all([
    runEngine(config, ["close"]),
    direct(nativeEnginePath(), "benchmark-native", ["close"]),
    direct(process.execPath, "benchmark-node", [wrapper, "close"]),
  ]);
  await new Promise((resolve) => server.close(resolve));
}
