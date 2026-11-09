import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, afterEach, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { commandForTool, executeTool, runAgent } from "../dist/agent.js";
import { runEngine, runEngineBatch } from "../dist/engine.js";
import { loadWorkflow, replayWorkflow, saveWorkflow } from "../dist/workflow.js";
import { startMcp } from "./mcp-client.mjs";

let server;
let origin;
let modelServer;
let modelRequests = 0;
const sessions = new Set();
const temporaryDirectories = [];
const execFileAsync = promisify(execFile);

function config(name, policy = "act", domains = ["127.0.0.1"]) {
  sessions.add(name);
  return {
    session: name,
    policy,
    allowedDomains: domains,
    executablePath: process.env.CHROME_PATH,
    headed: false,
    maxOutput: 20000,
    timeoutMs: 60000,
  };
}

function call(name, args = {}) {
  return { id: name, name, args };
}

before(async () => {
  const root = `<!doctype html><title>Agent-fast fixture</title><h1>Agent-fast fixture</h1><label for="q">Search</label><input id="q"><button id="go" onclick="event.preventDefault();document.querySelector('#output').textContent='Clicked: '+document.querySelector('#q').value">Go</button><a href="/next">More information</a><output id="output"></output>`;
  const next = `<!doctype html><title>Fixture next</title><h1>Next page</h1><p>Navigation succeeded</p>`;
  const dynamic = `<!doctype html><title>Dynamic fixture</title><button onclick="setTimeout(()=>{document.querySelector('#ready').hidden=false;document.querySelector('#ready').textContent='Ready'},100)">Load</button><div id="ready" hidden>Loading</div><iframe id="outer" src="/outer"></iframe>`;
  const outer = `<!doctype html><iframe id="inner" src="/inner"></iframe>`;
  const inner = `<!doctype html><label for="search">Frame search</label><input id="search" onkeydown="if(event.key==='Enter')document.querySelector('#result').textContent=this.value"><select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select><output id="result"></output>`;
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    const cross = `<!doctype html><title>Cross-origin fixture</title><iframe id="cross" src="http://localhost:${server.address().port}/inner"></iframe>`;
    response.end(({ "/next": next, "/dynamic": dynamic, "/outer": outer, "/inner": inner, "/cross": cross })[request.url] ?? root);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  modelServer = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      modelRequests++;
      const valid = modelRequests > 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: valid ? "valid" : "invalid",
              type: "function",
              function: {
                name: "done",
                arguments: JSON.stringify({
                  answer: valid ? "validated" : "invalid",
                  result: { title: valid ? "Agent-fast fixture" : 123 },
                }),
              },
            }],
          },
        }],
      }));
    });
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  for (const session of sessions) {
    await runEngine(config(session), ["close"]);
  }
  sessions.clear();
});

after(async () => {
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => modelServer.close(resolve)),
  ]);
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("real Chromium workflows", () => {
  it("executes native, batched, semantic, tab, and history actions", async () => {
    const current = config("browser-core");
    const opened = await executeTool(call("open", { url: origin }), current, true);
    assert.equal(opened.success, true, JSON.stringify(opened));
    const snapshot = await executeTool(call("snapshot"), current, true);
    assert.match(snapshot.data.snapshot, /textbox "Search".*ref=e2/);
    assert.equal((await executeTool(call("fill_label", { label: "Search", text: "native batch" }), current, true)).success, true);
    assert.equal((await executeTool(call("click_text", { text: "Go" }), current, true)).success, true);
    const results = await runEngineBatch(current, [["get", "text", "#output"], ["get", "title"]]);
    assert.equal(results[0].result.text, "Clicked: native batch");
    assert.equal(results[1].result.title, "Agent-fast fixture");
    assert.equal((await executeTool(call("click_text", { text: "More information" }), current, true)).success, true);
    const state = await executeTool(call("get_state"), current, true);
    assert.equal(state.data.title, "Fixture next");
    assert.equal((await executeTool(call("tab_new", { url: origin }), current, true)).success, true);
    assert.equal((await executeTool(call("tab_list"), current, true)).success, true);
    assert.equal((await executeTool(call("tab_switch", { target: "t1" }), current, true)).success, true);
    assert.equal((await executeTool(call("back"), current, true)).success, true);
  });

  it("enforces dangerous-action, read-only, domain, and argument boundaries", async () => {
    const current = config("browser-negative");
    for (const command of [["eval", "document.title"], ["download", "a", "/tmp/example"], ["upload", "@e2", "/tmp/example"], ["state", "save", "example"]]) {
      const result = await runEngine(current, command);
      assert.equal(result.success, false);
      assert.match(String(result.error), /denied by policy/);
    }
    const readOnlyClick = await runEngine(config("browser-negative-read", "read-only"), ["click", "@e1"]);
    assert.equal(readOnlyClick.success, false);
    assert.match(String(readOnlyClick.error), /denied by policy/);
    const blocked = await runEngine(config("browser-domain", "act", ["example.com"]), ["open", origin]);
    assert.equal(blocked.success, false);
    assert.match(String(blocked.error), /not in the allowed domains/);
    for (const args of [["snapshot", "--", "--action-policy", "/tmp/unsafe"], ["fill", "@e2", "--", "--action-policy"]]) {
      const result = spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /accepts at most|must not start with a hyphen/);
    }
    const privateNavigation = await executeTool(call("open", { url: origin }), config("browser-private", "act", []), true).catch((error) => error);
    assert.match(String(privateNavigation), /private\/loopback/);
    const privateCli = spawnSync(process.execPath, ["dist/cli.js", "open", origin], { encoding: "utf8" });
    assert.notEqual(privateCli.status, 0);
    assert.match(privateCli.stderr, /private\/loopback/);
  });

  it("replays workflows without storing filled secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-fast-flow-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "workflow.json");
    await saveWorkflow(path, [
      { step: 0, action: "open", args: { url: origin }, result: {} },
      { step: 1, action: "fill_label", args: { label: "Search", text: "secret-value" }, result: {} },
      { step: 2, action: "click_text", args: { text: "Go" }, result: {} },
      { step: 3, action: "get_text", args: { selector: "#output" }, result: {} },
    ]);
    const serialized = await readFile(path, "utf8");
    assert.doesNotMatch(serialized, /secret-value/);
    assert.match(serialized, /\{\{value1\}\}/);
    const workflow = await loadWorkflow(path);
    const trace = await replayWorkflow(workflow, config("browser-replay"), { value1: "secret-value" }, executeTool, commandForTool);
    assert.match(JSON.stringify(trace), /Clicked: secret-value/);
    assert.deepEqual(trace.map((entry) => entry.step), [1, 2, 3, 4]);
    const longTrace = await replayWorkflow({ version: 1, steps: Array.from({ length: 51 }, () => ({ action: "get_text", args: { selector: "#output" } })) },
      config("browser-replay"), {}, executeTool, commandForTool);
    assert.equal(longTrace.length, 51);
    assert.equal(longTrace[50].step, 51);
    await assert.rejects(replayWorkflow(workflow, config("browser-private-replay", "act", []), { value1: "secret-value" }, executeTool, commandForTool), /private\/loopback/);

    const cliArgs = ["dist/cli.js", "--session", "browser-env-replay", "--allowed-domains", "127.0.0.1", "--act", "flow", path];
    sessions.add("browser-env-replay");
    const env = { ...process.env, value1: "env-secret-value" };
    const { stdout } = await execFileAsync(process.execPath, [...cliArgs, "--param-env", "value1"], { env });
    assert.match(JSON.stringify(JSON.parse(stdout)), /Clicked: env-secret-value/);
    for (const [extra, message, variables] of [
      [["--param-env", "value1", "--param", "value1=other"], /duplicate parameter/, env],
      [["--param-env", "value1"], /missing environment parameter/, { ...process.env, value1: undefined }],
      [["--param-env", "value1", "--param-env", "value1"], /duplicate parameter/, env],
      [["--param-env", "bad-name"], /environment variable/, env],
      [["--param-env", "value1", "--param-env", "unused"], /unused workflow parameter/, { ...env, unused: "unused" }],
    ]) {
      await assert.rejects(execFileAsync(process.execPath, [...cliArgs, ...extra], { env: variables }), (error) => {
        assert.match(error.stderr, message);
        assert.doesNotMatch(error.stderr, /env-secret-value/);
        return true;
      });
    }
  });

  it("rejects invalid structured output and accepts corrected output", async () => {
    modelRequests = 0;
    const endpoint = `http://127.0.0.1:${modelServer.address().port}/v1/chat/completions`;
    const result = await runAgent({
      task: `Open ${origin} and return its title`,
      act: false,
      maxSteps: 4,
      keepOpen: false,
      schema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
    }, config("browser-schema", "read-only"), {
      model: "mock",
      endpoint,
      timeoutMs: 10000,
    });
    assert.equal(modelRequests, 2);
    assert.equal(result.status, "completed");
    assert.equal(result.result.title, "Agent-fast fixture");
    assert.equal(result.evidence.title, "Agent-fast fixture");
  });

  it("supports MCP initialize, navigate, read, and close", async () => {
    const child = spawn(process.execPath, ["dist/cli.js", "--session", "browser-mcp", "--allowed-domains", "127.0.0.1", "mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    sessions.add("browser-mcp");
    const responses = new Map();
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      const message = JSON.parse(line);
      if (message.id) responses.set(message.id, message);
    });
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-fast-test", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agent_browser_open", arguments: { url: origin } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agent_browser_get_title", arguments: {} } });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "agent_browser_close", arguments: {} } });
    const deadline = Date.now() + 30000;
    while (![1, 2, 3, 4].every((id) => responses.has(id))) {
      assert.ok(Date.now() < deadline, "MCP timed out");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (const id of [1, 2, 3, 4]) {
      assert.equal(responses.get(id).error, undefined);
      assert.notEqual(responses.get(id).result?.isError, true);
    }
    assert.equal(responses.get(3).result.content[0].text, "Agent-fast fixture");
    child.kill("SIGTERM");
  });

  it("handles delayed elements, nested frames, dropdowns, keyboard input, and assertions", async () => {
    const current = config("browser-compatibility");
    assert.equal((await executeTool(call("open", { url: `${origin}/dynamic` }), current, true)).success, true);
    assert.equal((await executeTool(call("click_text", { text: "Load" }), current, true)).success, true);
    assert.equal((await executeTool(call("wait_for", { selector: "#ready", timeout: 2000 }), current, true)).success, true);
    assert.equal((await executeTool(call("assert_text", { selector: "#ready", text: "Ready", timeout: 1000 }), current, true)).success, true);
    assert.equal((await executeTool(call("frame", { target: "#outer" }), current, true)).success, true);
    const frameSnapshot = await executeTool(call("snapshot"), current, true);
    const nestedFrame = frameSnapshot.data.snapshot.match(/iframe[^\n]*ref=(e[0-9]+)/i)?.[1];
    assert.ok(nestedFrame, JSON.stringify(frameSnapshot));
    const selected = await executeTool(call("frame", { target: `@${nestedFrame}` }), current, true);
    assert.equal(selected.success, true, JSON.stringify(selected));
    assert.equal((await executeTool(call("select", { selector: "#choice", value: "b" }), current, true)).success, true);
    const innerSnapshot = await executeTool(call("snapshot"), current, true);
    const searchRef = innerSnapshot.data.snapshot.match(/textbox "Frame search"[^\n]*ref=(e[0-9]+)/)?.[1];
    assert.ok(searchRef, JSON.stringify(innerSnapshot));
    assert.equal((await executeTool(call("fill", { target: searchRef, text: "nested frame passed" }), current, true)).success, true);
    assert.equal((await executeTool(call("press", { key: "Enter" }), current, true)).success, true);
    assert.equal((await executeTool(call("assert_text", { selector: "#result", text: "nested frame passed", timeout: 1000 }), current, true)).success, true);
    assert.equal((await executeTool(call("frame", { target: "main" }), current, true)).success, true);
    const mismatch = await executeTool(call("assert_text", { selector: "#ready", text: "wrong", timeout: 100 }), current, true);
    assert.equal(mismatch.success, false);
    assert.equal(mismatch.code, "assertion_failed");
    for (const command of [["wait-for", "#ready"], ["assert-text", "#ready", "Ready"]]) {
      const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "--session", current.session,
        "--allowed-domains", "127.0.0.1", ...command]);
      assert.equal(JSON.parse(stdout).success, true);
    }
  });

  it("keeps MCP usable after failures and validates batches before acting", async () => {
    const session = "browser-mcp-reliable";
    sessions.add(session);
    const client = await startMcp(["--session", session, "--act", "--allowed-domains", "127.0.0.1", "--timeout", "2000"]);
    try {
      assert.equal((await client.tool("agent_browser_open", { url: origin })).result.isError, false);
      const overridden = await client.tool("agent_browser_open", { url: origin, session: "escape" });
      assert.equal(overridden.error.code, -32602);
      const invalid = await client.tool("agent_fast_batch", { steps: [
        { action: "click_text", args: { text: "Go" } },
        { action: "open", args: { url: "https://user:password@example.com" } },
      ] });
      assert.equal(invalid.result.isError, true);
      assert.equal((await client.tool("agent_browser_get_text", { selector: "#output" })).result.structuredContent.data.text, "");
      const timeout = await client.tool("agent_browser_wait_for", { selector: "#missing", timeout: 50 });
      assert.equal(timeout.result.isError, true);
      const missing = await client.tool("agent_browser_assert_text", { selector: "#missing", text: "Ready", timeout: 50 });
      assert.equal(missing.result.isError, true);
      assert.deepEqual((await client.request("ping")).result, {});
      assert.equal((await client.tool("agent_browser_get_title")).result.content[0].text, "Agent-fast fixture");
      const batched = await client.tool("agent_fast_batch", { steps: [
        { action: "fill_label", args: { label: "Search", text: "batched" } },
        { action: "click_text", args: { text: "Go" } },
        { action: "assert_text", args: { selector: "#output", text: "Clicked: batched", timeout: 500 } },
      ] });
      assert.equal(batched.result.isError, false, JSON.stringify(batched));
      assert.equal(batched.result.structuredContent.data.steps, 3);
      const failed = await client.tool("agent_fast_batch", { steps: [
        { action: "assert_text", args: { selector: "#output", text: "wrong", timeout: 50 } },
        { action: "click_text", args: { text: "More information" } },
      ] });
      assert.equal(failed.result.isError, true);
      assert.equal((await client.tool("agent_browser_get_url")).result.content[0].text, origin + "/");
      await client.tool("agent_browser_close");
      assert.equal((await client.tool("agent_browser_open", { url: `${origin}/next` })).result.isError, false);
      assert.equal((await client.tool("agent_browser_get_title")).result.content[0].text, "Fixture next");
    } finally { await client.close(); }
  });

  it("interacts with controls inside a site-isolated cross-origin iframe", {
    skip: process.env.AGENT_FAST_TEST_CROSS_ORIGIN === "1" ? false
      : "Native agent-browser 0.41.2 stalls during this navigation; retained as a compatibility reproduction",
  }, async () => {
    const current = config("browser-cross-origin", "act", ["127.0.0.1", "localhost"]);
    const opened = await executeTool(call("open", { url: `${origin}/cross` }), current, true);
    assert.equal(opened.success, true, JSON.stringify(opened));
    const selected = await executeTool(call("frame", { target: "#cross" }), current, true);
    assert.equal(selected.success, true, JSON.stringify(selected));
    const snapshot = await executeTool(call("snapshot"), current, true);
    const target = snapshot.data.snapshot.match(/textbox "Frame search"[^\n]*ref=(e[0-9]+)/)?.[1];
    assert.ok(target, JSON.stringify(snapshot));
    assert.equal((await executeTool(call("fill", { target, text: "cross-origin passed" }), current, true)).success, true);
    assert.equal((await executeTool(call("press", { key: "Enter" }), current, true)).success, true);
    const matched = await executeTool(call("assert_text", { selector: "#result", text: "cross-origin passed", timeout: 1000 }), current, true);
    assert.equal(matched.success, true, JSON.stringify(matched));
  });

  it("keeps MCP alive when its browser daemon terminates", { skip: process.platform === "win32" }, async () => {
    const session = "browser-mcp-engine-loss";
    sessions.add(session);
    const client = await startMcp(["--session", session, "--allowed-domains", "127.0.0.1"]);
    try {
      assert.equal((await client.tool("agent_browser_open", { url: origin })).result.isError, false);
      const pidPath = join(homedir(), ".agent-browser", `${session}.pid`);
      const pid = Number((await readFile(pidPath, "utf8")).trim());
      assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
      process.kill(pid, "SIGTERM");
      const deadline = Date.now() + 5000;
      while (await readFile(pidPath, "utf8").then(() => true, () => false)) {
        assert.ok(Date.now() < deadline, "test daemon did not shut down");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual((await client.request("ping")).result, {});
      assert.equal((await client.tool("agent_browser_open", { url: `${origin}/next` })).result.isError, false);
      assert.equal((await client.tool("agent_browser_get_title")).result.content[0].text, "Fixture next");
    } finally { await client.close(); }
  });
});
