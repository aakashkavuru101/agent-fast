import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  modelEndpoint,
  parsePositiveInteger,
  validateDomains,
  validateHttpUrl,
  validateSession,
} from "../dist/config.js";

describe("configuration validation", () => {
  it("accepts safe sessions, URLs, domains, and limits", () => {
    assert.equal(validateSession("agent-fast_test-1"), "agent-fast_test-1");
    assert.equal(validateHttpUrl("https://example.com"), "https://example.com/");
    assert.deepEqual(validateDomains("example.com,*.example.com"), ["example.com", "*.example.com"]);
    assert.equal(parsePositiveInteger("20", "steps", 50), 20);
    assert.equal(
      modelEndpoint("http://127.0.0.1:11434/v1"),
      "http://127.0.0.1:11434/v1/chat/completions",
    );
  });

  it("rejects credential-bearing URLs and unsafe model endpoints", () => {
    assert.throws(() => validateHttpUrl("https://user:pass@example.com"), /no credentials/);
    assert.throws(() => validateHttpUrl("file:///etc/passwd"), /HTTP\(S\)/);
    assert.throws(() => modelEndpoint("http://example.com/v1"), /HTTPS/);
  });

  it("rejects invalid sessions, domains, and numeric limits", () => {
    assert.throws(() => validateSession("../escape"), /session/);
    assert.throws(() => validateDomains("https://example.com"), /invalid domain/);
    assert.throws(() => parsePositiveInteger("0", "steps", 50), /positive integer/);
    assert.throws(() => parsePositiveInteger("51", "steps", 50), /between 1 and 50/);
  });
});
