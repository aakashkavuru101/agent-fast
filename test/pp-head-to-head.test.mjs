import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarize } from "../benchmarks/pp-head-to-head/summarize.mjs";

const use = (t, id, name, msgId) => ({ t, msg: { type: "assistant", message: { id: msgId, content: [{ type: "tool_use", id, name: `mcp__x__${name}`, input: {} }] } } });
const res = (t, id, isError = false) => ({ t, msg: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError }] } } });

describe("pp-head-to-head summary", () => {
  it("computes wall time, latency, errors, retries, turns, tokens and success", () => {
    const lines = [
      { t: 1000, msg: { type: "system", subtype: "init" } },
      use(1100, "a", "open", "m1"), res(1300, "a"), // 200 ms
      use(1400, "b", "wait_for", "m2"), res(2400, "b", true), // 1000 ms, error
      use(2500, "c", "wait_for", "m3"), res(2600, "c"), // 100 ms, retry
      use(2700, "d", "click", "m4"), res(3100, "d"), // 400 ms
      { t: 3200, msg: { type: "assistant", message: { id: "m5", content: [{ type: "text", text: "done" }] } } },
      { t: 3300, msg: { type: "result", is_error: false, result: "1行目:\nUpdateContext( {ctx: true", total_cost_usd: 1.5,
        usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 7 } } },
    ];
    const r = summarize(lines, "UpdateContext({ctx: true");
    assert.equal(r.wallMs, 2300);
    assert.equal(r.calls, 4);
    assert.equal(r.errors, 1);
    assert.equal(r.retries, 1);
    assert.equal(r.medianMs, 300); // (200 + 400) / 2
    assert.equal(r.p95Ms, 1000);
    assert.equal(r.turns, 5);
    assert.equal(r.inputTokens, 60);
    assert.equal(r.outputTokens, 7);
    assert.equal(r.success, true);
    assert.deepEqual(r.slowest, ["wait_for 1 s (2)", "click 0 s (1)", "open 0 s (1)"]);
    assert.equal(summarize(lines, "UpdateContext({other").success, false);
  });
});
