import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandForTool } from "../dist/agent.js";
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

  it("blocks private hosts and encoded address forms unless the exact host is explicitly allowed", () => {
    for (const host of [
      "127.0.0.1", "127.1", "2130706433", "0x7f000001", "0177.0.0.1", "0.0.0.0",
      "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200",
      "localhost", "LOCALHOST.", "api.localhost", "printer.local", "metadata.google.internal", "intranet",
      "[::]", "[::1]", "[fc00::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::ffff:a9fe:a9fe]",
    ]) {
      assert.throws(() => validateHttpUrl(`http://${host}/`), /private\/loopback/, host);
      for (const name of ["open", "read", "tab_new"]) {
        assert.throws(() => commandForTool({ name, args: { url: `http://${host}/` } }, true), /private\/loopback/);
      }
    }
    assert.equal(validateHttpUrl("http://127.0.0.1/", ["127.0.0.1"]), "http://127.0.0.1/");
    assert.equal(validateHttpUrl("http://[::1]/", ["::1"]), "http://[::1]/");
    assert.throws(() => validateHttpUrl("http://api.localhost/", ["*.localhost"]), /private\/loopback/);
    for (const host of ["example.com", "8.8.8.8", "[2606:4700:4700::1111]", "[::ffff:8.8.8.8]"]) {
      assert.equal(new URL(validateHttpUrl(`https://${host}/`)).protocol, "https:");
    }
  });

  it("rejects unsafe control arguments and interaction attempts in read-only mode", () => {
    for (const [name, args, act] of [
      ["frame", { target: "--action-policy" }, true],
      ["wait_for", { selector: "1000" }, true],
      ["wait_for", { selector: "body", state: "unsupported" }, true],
      ["wait_for", { selector: "body", timeout: 0 }, true],
      ["assert_text", { selector: "--eval", text: "x" }, true],
      ["press", { key: "Enter" }, false],
      ["select", { selector: "select", value: "x" }, false],
      ["select", { selector: "select", value: "--action-policy" }, true],
    ]) assert.throws(() => commandForTool({ name, args }, act));
  });
});
