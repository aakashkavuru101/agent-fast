import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { afterEach, describe, it, mock } from "node:test";
import { runEngine, runEngineBatch } from "../dist/engine.js";

const config = {
  session: "engine-fault-test", policy: "read-only", allowedDomains: [],
  headed: false, maxOutput: 1000, timeoutMs: 1000,
};

function stubEngine(behavior) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal); return true; };
  child.input = "";
  child.stdin.on("data", (chunk) => child.input += chunk.toString());
  mock.method(childProcess, "spawn", () => {
    queueMicrotask(() => behavior(child));
    return child;
  });
  syncBuiltinESMExports();
  return child;
}

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
      process.stdout.end('{"success":true,"data":{"title":"unverified"}}');
      process.emit("close", 1, null);
    });
    const failed = await runEngine(config, ["get", "title"]);
    assert.equal(failed.success, false);
    assert.match(failed.error, /status 1/);
  });
});
