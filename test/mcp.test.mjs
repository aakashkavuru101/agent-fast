import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { startMcp } from "./mcp-client.mjs";

describe("owned MCP protocol", () => {
  it("advertises a narrow read-only catalog and rejects policy overrides", async () => {
    const client = await startMcp(["--session", "mcp-protocol"]);
    try {
      const catalog = (await client.request("tools/list")).result.tools;
      const names = catalog.map((tool) => tool.name);
      for (const name of ["agent_browser_wait_for", "agent_browser_frame", "agent_browser_assert_text", "agent_fast_batch"]) assert.ok(names.includes(name));
      for (const name of ["agent_browser_eval", "agent_browser_click", "agent_browser_fill", "agent_browser_press", "agent_browser_select"]) {
        assert.ok(!names.includes(name));
        assert.equal((await client.tool(name)).error.code, -32602);
      }
      assert.equal((await client.tool("agent_browser_get_title", { session: "other" })).error.code, -32602);
      const privateUrl = await client.tool("agent_browser_open", { url: "http://127.0.0.1/" });
      assert.equal(privateUrl.result.isError, true);
      assert.match(privateUrl.result.content[0].text, /private\/loopback/);
      assert.equal((await client.tool("agent_fast_batch", { steps: [{ action: "click", args: { target: "@e1" } }] })).error.code, -32602);
      assert.equal((await client.tool("agent_browser_wait_for", { selector: "x", timeout: 1.5 })).error.code, -32602);
      assert.equal((await client.request("unknown")).error.code, -32601);
      assert.deepEqual((await client.request("ping")).result, {});
    } finally { await client.close(); }
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
