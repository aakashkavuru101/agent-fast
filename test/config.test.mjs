import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandForTool } from "../dist/agent.js";
import {
  hostExplicitlyAllowed,
  isPrivateAddress,
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
      "[64:ff9b::7f00:1]", "[64:ff9b:1::a00:1]", "[2002:7f00:1::1]",
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

  it("enforces the allowlist on navigation and expands presets", () => {
    assert.throws(() => validateHttpUrl("https://evil.example/", ["example.com"]), /not in the allowed domains/);
    assert.equal(validateHttpUrl("https://example.com/a", ["*.example.com"]), "https://example.com/a");
    assert.equal(validateHttpUrl("https://app.example.com/", ["*.example.com"]), "https://app.example.com/");
    assert.throws(() => validateHttpUrl("https://notexample.com/", ["*.example.com"]), /not in the allowed domains/);
    const microsoft = validateDomains(undefined, ["microsoft"]);
    for (const url of ["https://make.powerautomate.com/", "https://make.powerapps.com/", "https://login.microsoftonline.com/common"]) {
      assert.equal(validateHttpUrl(url, microsoft), url);
    }
    assert.throws(() => validateHttpUrl("https://evil.example/", microsoft), /not in the allowed domains/);
    assert.throws(() => validateDomains(undefined, ["unknown"]), /unknown --allow-preset/);
    // "*" is a legal host character: a wildcard entry must not double as an exact private-host opt-in.
    assert.equal(hostExplicitlyAllowed("*.example.com", ["*.example.com"]), false);
    assert.equal(hostExplicitlyAllowed("127.0.0.1", ["127.0.0.1"]), true);
    for (const address of ["::ffff:0:127.0.0.1", "fec0::1", "64:ff9b::a00:1"]) assert.equal(isPrivateAddress(address), true, address);
  });

  it("rejects malformed arguments and interaction attempts in read-only mode", () => {
    for (const [name, args, act] of [
      ["wait_for", { selector: "1000" }, true],
      ["wait_for", { selector: "body", state: "unsupported" }, true],
      ["wait_for", { selector: "body", timeout: 0 }, true],
      ["wait_for", { selector: "body", text: "both" }, true],
      ["wait_for", {}, true],
      ["click", {}, true],
      ["click", { target: "#css" }, true],
      ["click", { role: "button" }, true],
      ["drag", { source: "@e1", target: "body" }, true],
      ["tab_switch", { target: "--session" }, true],
      ["tab_switch", { target: "close" }, false],
      ["tab_switch", { target: "new" }, false],
      ["frame", { target: "--action-policy" }, true],
      ["get_text", { selector: "--fn" }, true],
      ["assert_text", { selector: "--eval", text: "x" }, true],
      ["wait_for", { text: "--timeout" }, true],
      ["press", { key: "--help" }, true],
      ["auth_login", { profile: "--password" }, true],
      ["upload", { target: "@e1", files: [] }, true],
      ["dialog", { action: "accept" }, false],
      ["dialog", { action: "run" }, true],
      ...["click", "fill", "type", "hover", "check", "drag", "press", "select", "upload", "download", "tab_close", "auth_login", "click_text", "fill_label"]
        .map((name) => [name, { target: "@e1", source: "@e1", text: "x", key: "Enter", selector: "s", value: "v", files: ["a"], profile: "p", label: "l" }, false]),
    ]) assert.throws(() => commandForTool({ name, args }, act), undefined, `${name} ${JSON.stringify(args)}`);
  });

  it("accepts values that start with a hyphen and locators by role and name", () => {
    assert.deepEqual(commandForTool({ name: "fill", args: { target: "e2", text: "-5" } }, true), [["fill", "@e2", "-5"]]);
    assert.deepEqual(commandForTool({ name: "fill", args: { target: "@e2", text: "" } }, true), [["fill", "@e2", ""]]);
    assert.deepEqual(commandForTool({ name: "type", args: { text: "--help" } }, true), [["keyboard", "type", "--help"]]);
    assert.equal(commandForTool({ name: "click", args: { role: "button", name: "Save", nth: 1 } }, true), null);
    assert.deepEqual(commandForTool({ name: "click", args: { target: "@e3", double: true } }, true), [["dblclick", "@e3"]]);
    assert.deepEqual(commandForTool({ name: "read", args: { url: "https://example.com/" } }, false), [["open", "https://example.com/"], ["read"]]);
    assert.deepEqual(commandForTool({ name: "dialog", args: { action: "dismiss" } }, false), [["dialog", "dismiss"]]);
  });
});
