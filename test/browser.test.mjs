import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, afterEach, before, describe, it } from "node:test";
import { commandForTool, executeTool, runAgent } from "../dist/agent.js";
import { runEngine, runEngineBatch } from "../dist/engine.js";
import { loadWorkflow, replayWorkflow, saveWorkflow } from "../dist/workflow.js";

let server;
let origin;
let modelServer;
let modelRequests = 0;
const sessions = new Set();
const temporaryDirectories = [];

function config(name, policy = "act", domains = ["127.0.0.1"]) {
  sessions.add(name);
  return {
    session: name,
    policy,
    allowedDomains: domains,
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
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(request.url === "/next" ? next : root);
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
    assert.equal((await executeTool(call("open", { url: origin }), current, true)).success, true);
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
});
