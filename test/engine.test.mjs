import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { runEngine, runEngineBatch } from "../dist/engine.js";
import { executeTool } from "../dist/agent.js";
import { ensureProxy, stopProxy } from "../dist/proxy.js";

const config = {
  session: "engine-fault-test", policy: "read-only", allowedDomains: [],
  headed: false, maxOutput: 1000, timeoutMs: 1000,
};

function engineChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal); return true; };
  child.input = "";
  child.stdin.on("data", (chunk) => child.input += chunk.toString());
  return child;
}

function stubEngine(behavior) {
  const first = engineChild();
  let next = first;
  mock.method(childProcess, "spawn", (_command, args) => {
    const child = next;
    child.args = args;
    next = engineChild();
    queueMicrotask(() => behavior(child));
    return child;
  });
  syncBuiltinESMExports();
  return first;
}

// The engine is stubbed below, so the real egress proxy must already be running.
before(() => ensureProxy(config.session, config.allowedDomains));
after(() => stopProxy(config.session));

afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});

describe("engine failure containment", () => {
  it("bounds a hung command even when the process never closes after being killed", async () => {
    const child = stubEngine((process) => {
      setTimeout(() => {
        process.stdout.end('[{"success":true}]');
        process.emit("close", 0, null);
      }, 100);
    });
    await assert.rejects(runEngineBatch({ ...config, timeoutMs: 10 }, [["get", "title"]]), /timed out/);
    assert.deepEqual(child.signals, ["SIGKILL"]);
    assert.equal(child.stdin.destroyed, true);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
  });

  it("contains a broken input pipe instead of emitting an unhandled error", async () => {
    const child = stubEngine((process) => {
      setTimeout(() => process.emit("close", 1, null), 25);
      process.stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
    });
    await assert.rejects(runEngineBatch(config, [["get", "title"]]), /broken pipe/);
    assert.deepEqual(child.signals, ["SIGKILL"]);
  });

  it("stops excess output without waiting for the engine to close", async () => {
    const child = stubEngine((process) => {
      process.stderr.write("x".repeat(200_001));
      process.stdout.end('[{"success":true}]');
      process.emit("close", 0, null);
    });
    await assert.rejects(runEngineBatch(config, [["get", "title"]]), /output limit/);
    assert.deepEqual(child.signals, ["SIGKILL"]);
  });

  it("sends batch input over stdin and preserves native failure results", async () => {
    const child = stubEngine((process) => {
      process.stdout.end('[{"success":false,"error":"denied by policy"}]');
      process.emit("close", 1, null);
    });
    assert.deepEqual(await runEngineBatch(config, [["fill", "@e1", "secret"]]), [
      { success: false, error: "denied by policy" },
    ]);
    assert.equal(child.input, '[["fill","@e1","secret"]]');
    assert.ok(!child.args.includes("secret"), "values must travel on stdin, never on the command line");
    assert.ok(!child.args.includes("--allowed-domains"), "containment is the egress proxy");
    assert.ok(child.args.includes("--download-path"), "clicked downloads must not land in the user's Downloads folder");
    assert.match(child.args.join(" "), /--proxy http:\/\/127\.0\.0\.1:[0-9]+ --proxy-bypass <-loopback>/);
    assert.deepEqual(child.signals, []);
  });

  it("does not accept partial success after an abnormal exit", async () => {
    stubEngine((process) => {
      process.stdout.end('[{"success":true}]');
      process.emit("close", null, "SIGSEGV");
    });
    await assert.rejects(runEngineBatch(config, [["get", "title"]]), /SIGSEGV/);
  });

  it("contains single-command timeouts and rejects success from a failed process", async () => {
    const child = stubEngine((process) => {
      setTimeout(() => process.emit("close", 0, null), 100);
    });
    const result = await runEngine({ ...config, timeoutMs: 10 }, ["get", "title"]);
    assert.equal(result.success, false);
    assert.match(result.error, /timed out.*completion is unknown/);
    assert.deepEqual(child.signals, ["SIGKILL"]);

    stubEngine((process) => {
      process.stdout.end('[{"success":true,"result":{"title":"unverified"}}]');
      process.emit("close", 1, null);
    });
    const failed = await runEngine(config, ["get", "title"]);
    assert.equal(failed.success, false);
    assert.match(failed.error, /status 1/);
  });

  it("reports assertion expiry during native reads without discarding the observation error", async () => {
    let elapsed = 0;
    let requests = 0;
    mock.method(performance, "now", () => elapsed);
    stubEngine((process) => {
      if (++requests === 1) {
        process.stdout.end('[{"success":true}]');
        process.emit("close", 0, null);
      } else {
        elapsed = 101;
        process.stdout.end('[{"success":false,"error":"engine command timed out"}]');
        process.emit("close", 1, null);
      }
    });
    const result = await executeTool({ id: "assert", name: "assert_text", args: {
      selector: "#status", text: "Saved", timeout: 100,
    } }, config, false);
    // Readiness, one read, then the failure screenshot.
    assert.equal(requests, 3);
    assert.equal(result.code, "assertion_failed");
    assert.equal(result.data.observationError, "engine command timed out");
  });

  it("does not dispatch a read when the assertion deadline expired during readiness", async () => {
    let elapsed = 0;
    let requests = 0;
    mock.method(performance, "now", () => elapsed);
    stubEngine((process) => {
      requests++;
      elapsed = 101;
      process.stdout.end('[{"success":true}]');
      process.emit("close", 0, null);
    });
    const result = await executeTool({ id: "assert", name: "assert_text", args: {
      selector: "#status", text: "Saved", timeout: 100,
    } }, config, false);
    // Readiness and the failure screenshot; no text read is dispatched.
    assert.equal(requests, 2);
    assert.equal(result.code, "assertion_failed");
  });
});

describe("result normalization", () => {
  it("removes engine bookkeeping and cuts long strings with a visible marker", async () => {
    const { normalizeResult } = await import("../dist/engine.js");
    const result = normalizeResult({ success: true, result: { text: "x".repeat(50), lifecycle: { launched: true } } }, 10);
    assert.deepEqual(result, { success: true, data: { text: `${"x".repeat(10)}\n[truncated 40 characters]` } });
    assert.equal(JSON.parse(JSON.stringify(result)).data.text.length, 10 + "\n[truncated 40 characters]".length);
  });

  it("maps fixed command shapes to daemon messages and leaves unknown shapes to the command client", async () => {
    const { wireFor } = await import("../dist/daemon.js");
    assert.deepEqual(wireFor(["fill", "@e2", "--action-policy"]), { action: "fill", selector: "@e2", value: "--action-policy" });
    assert.deepEqual(wireFor(["wait", "#a", "--state", "hidden", "--timeout", "50"]), { action: "wait", selector: "#a", state: "hidden", timeout: 50 });
    assert.deepEqual(wireFor(["frame", "main"]), { action: "mainframe" });
    assert.deepEqual(wireFor(["wait", "--text", "--timeout", "--timeout", "50"]), { action: "wait", text: "--timeout", timeout: 50 });
    assert.deepEqual(wireFor(["mouse", "move", "10", "20"]), { action: "mousemove", x: 10, y: 20 });
    assert.deepEqual(wireFor(["tab", "close"]), { action: "tab_close" });
    for (const command of [["eval", "1"], ["auth", "login", "x"], ["close"], ["batch"], ["wait", "#ready"], ["get", "cdp-url"]]) {
      assert.equal(wireFor(command), null, command.join(" "));
    }
  });
});
