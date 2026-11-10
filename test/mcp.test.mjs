import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { startMcp } from "./mcp-client.mjs";

describe("owned MCP protocol", () => {
  it("advertises a narrow read-only catalog and rejects policy overrides", async () => {
    const client = await startMcp(["--session", "mcp-protocol"]);
    try {
      const catalog = (await client.request("tools/list")).result.tools;
      const names = catalog.map((tool) => tool.name);
      for (const name of ["agent_fast_wait_for", "agent_fast_frame", "agent_fast_assert_text", "agent_fast_screenshot", "agent_fast_console", "agent_fast_network", "agent_fast_dialog", "agent_fast_batch"]) assert.ok(names.includes(name), name);
      assert.ok(names.every((name) => name.startsWith("agent_fast_")));
      assert.equal(catalog.find((tool) => tool.name === "agent_fast_snapshot").annotations.readOnlyHint, true);
      for (const name of ["agent_fast_eval", "agent_fast_click", "agent_fast_fill", "agent_fast_press", "agent_fast_select", "agent_fast_upload", "agent_fast_hover", "agent_browser_open"]) {
        assert.ok(!names.includes(name));
        assert.equal((await client.tool(name)).error.code, -32602);
      }
      assert.equal((await client.tool("agent_fast_get_title", { session: "other" })).error.code, -32602);
      const privateUrl = await client.tool("agent_fast_open", { url: "http://127.0.0.1/" });
      assert.equal(privateUrl.result.isError, true);
      assert.match(privateUrl.result.content[0].text, /private\/loopback/);
      assert.equal((await client.tool("agent_fast_batch", { steps: [{ action: "click", args: { target: "@e1" } }] })).error.code, -32602);
      assert.equal((await client.tool("agent_fast_wait_for", { selector: "x", timeout: 1.5 })).error.code, -32602);
      assert.equal((await client.tool("agent_fast_dialog", { action: "accept" })).error.code, -32602);
      assert.equal((await client.request("unknown")).error.code, -32601);
      assert.deepEqual((await client.request("ping")).result, {});
    } finally { await client.close(); }
  });

  it("reports the package version and negotiates the protocol version", async () => {
    const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    for (const [requested, expected] of [["2025-06-18", "2025-06-18"], ["2024-11-05", "2024-11-05"], ["1999-01-01", "2025-11-25"]]) {
      const child = spawn(process.execPath, ["dist/cli.js", "mcp"], { stdio: ["pipe", "pipe", "inherit"] });
      const reply = new Promise((resolve) => child.stdout.once("data", (chunk) => resolve(JSON.parse(chunk.toString()))));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: requested } }) + "\n");
      const { result } = await reply;
      child.stdin.end();
      assert.equal(result.protocolVersion, expected);
      assert.deepEqual(result.serverInfo, { name: "agent-fast", version });
    }
  });

  it("recovers from malformed JSON and rejects oversized messages", async () => {
    const client = await startMcp(["--session", "mcp-invalid"]);
    const notices = [];
    client.child.stdout.on("data", (chunk) => notices.push(chunk.toString()));
    try {
      client.child.stdin.write("not-json\n");
      assert.deepEqual((await client.request("ping")).result, {});
      assert.match(notices.join(""), /-32700/);
      client.child.stdin.write("x".repeat(1_000_001) + "\n");
      assert.equal(await client.exited, 1);
      assert.match(notices.join(""), /exceeds 1000000 bytes/);
    } finally { await client.close(); }
  });

  it("exits when a client stops reading responses", async () => {
    const child = spawn(process.execPath, ["dist/cli.js", "--timeout", "100", "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    child.stderr.resume();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }) + "\n");
      child.stdin.end(Array.from({ length: 1000 }, (_, id) => JSON.stringify({ jsonrpc: "2.0", id: id + 1, method: "tools/list" })).join("\n") + "\n");
      assert.equal(await exited, 1);
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      child.stdout.destroy();
    }
  });
});
