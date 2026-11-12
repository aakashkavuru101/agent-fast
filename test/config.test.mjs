import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandForTool, detectChallenge } from "../dist/agent.js";
import {
  defaultApiKey,
  defaultModelUrl,
  findBrowser,
  hostExplicitlyAllowed,
  isPrivateAddress,
  modelEndpoint,
  parsePositiveInteger,
  validateDomains,
  validateHttpUrl,
  validateSession,
} from "../dist/config.js";
import { diffTrees } from "../dist/mcp.js";

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

  it("routes a model to its vendor by name and everything else to Ollama", () => {
    assert.equal(defaultModelUrl("claude-opus-5-5"), "https://api.anthropic.com");
    assert.match(defaultModelUrl("gpt-5"), /api\.openai\.com/);
    assert.match(defaultModelUrl("gemini-3-pro"), /googleapis\.com.*openai/);
    assert.match(defaultModelUrl("qwen3:4b"), /127\.0\.0\.1:11434/);
  });

  it("sends a vendor key only to that vendor's own API", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    assert.equal(defaultApiKey("gpt-5", defaultModelUrl("gpt-5")), "sk-test");
    assert.equal(defaultApiKey("gpt-5", "https://gateway.example/v1/chat/completions"), undefined);
    assert.equal(defaultApiKey("qwen3:4b", defaultModelUrl("qwen3:4b")), undefined);
    delete process.env.OPENAI_API_KEY;
  });

  it("diffs trees by counted lines", () => {
    const before = '- button "Delete"\n- button "Delete"\n- text "Same"';
    assert.equal(diffTrees(before, '- button "Delete"\n- text "Same"'),
      'Changes since the previous snapshot (2 unchanged lines omitted):\n- - button "Delete"');
    assert.equal(diffTrees(before, before + '\n- link "New"'), 'Changes since the previous snapshot (3 unchanged lines omitted):\n+ - link "New"');
  });

  it("names the human check a page shows", () => {
    assert.equal(detectChallenge('- iframe "Widget containing a Cloudflare security challenge"'), "Cloudflare security challenge");
    assert.equal(detectChallenge('- button "Sign in"'), null);
  });

  it("picks the first installed browser and none when nothing is installed", () => {
    assert.equal(findBrowser(["/nonexistent/chrome", process.execPath, "/nonexistent/brave"]), process.execPath);
    assert.equal(findBrowser(["/nonexistent/chrome"]), undefined);
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
      ["snapshot", { selector: "--action-policy" }, false],
      ["assert_text", { selector: "--eval", text: "x" }, true],
      ["press", { key: "--help" }, true],
      ["auth_login", { profile: "--password" }, true],
      ["upload", { target: "@e1", files: [] }, true],
      ["dialog", { action: "accept" }, false],
      ["dialog", { action: "run" }, true],
      ...["click", "fill", "type", "hover", "check", "drag", "press", "select", "upload", "download", "tab_close", "auth_login", "click_text", "fill_label"]
        .map((name) => [name, { target: "@e1", source: "@e1", text: "x", key: "Enter", selector: "s", value: "v", files: ["a"], profile: "p", label: "l" }, false]),
    ]) assert.throws(() => commandForTool({ name, args }, act), undefined, `${name} ${JSON.stringify(args)}`);
  });

  it("finds the iframe that encloses a ref in a snapshot tree", async () => {
    const { enclosingFrame } = await import("../dist/agent.js");
    const tree = '- main [ref=e1]\n  - Iframe "Studio" [ref=e2]\n    - tree\n      - treeitem "btnSmoke" [level=2, ref=e24]\n- button "Top" [ref=e3]';
    assert.equal(enclosingFrame(tree, "@e24"), "@e2");
    assert.equal(enclosingFrame(tree, "e3"), null);
    assert.equal(enclosingFrame(tree, "@e99"), null);
  });

  it("reads the text a wait can match from a snapshot tree", async () => {
    const { treeTexts } = await import("../dist/agent.js");
    const tree = [
      '- button "Saved" [ref=e1]', "- paragraph", '  - StaticText "Shadow text"',
      '- Iframe "Studio" [ref=e2]', '  - button "Say \\"hi\\" [now]" [ref=e3]', '  - combobox "Property" [expanded=false, ref=e4]: OnSelect',
      '  - textbox "Code" [ref=e5]: If(x,', "line two)", '  - status "Progress": Saved', "  - paragraph", '    - StaticText "a: b"',
      '- link "After the frame" [ref=e6]',
    ].join("\n");
    // Outside frames only text nodes count: an aria-label such as "Saved" is not page text. Roles, refs, and the frame title never count.
    assert.deepEqual(treeTexts(tree), ["Shadow text", 'Say "hi" [now]', "Property", "OnSelect", "Code", "If(x,", "Progress", "Saved", "a: b"]);
  });

  it("accepts values that start with a hyphen and locators by role and name", () => {
    assert.deepEqual(commandForTool({ name: "fill", args: { target: "e2", text: "-5" } }, true), [["fill", "@e2", "-5"]]);
    assert.deepEqual(commandForTool({ name: "fill", args: { target: "@e2", text: "" } }, true), [["fill", "@e2", ""]]);
    assert.deepEqual(commandForTool({ name: "type", args: { text: "--help" } }, true), [["keyboard", "type", "--help"]]);
    assert.equal(commandForTool({ name: "click", args: { role: "button", name: "Save", nth: 1 } }, true), null);
    // executeTool runs every click, so the covered-click fallback also applies inside batches and replays.
    assert.equal(commandForTool({ name: "click", args: { target: "@e3", double: true } }, true), null);
    assert.deepEqual(commandForTool({ name: "read", args: { url: "https://example.com/" } }, false), [["open", "https://example.com/"], ["read"]]);
    assert.deepEqual(commandForTool({ name: "snapshot", args: { selector: "main" } }, false), [["snapshot", "-i", "-s", "main"]]);
    // Waited-for text never reaches the engine's command line, so it may start with a hyphen.
    assert.equal(commandForTool({ name: "wait_for", args: { text: "-5 items" } }, false), null);
    assert.deepEqual(commandForTool({ name: "snapshot", args: { full: true, selector: "#log" } }, false), [["snapshot", "-s", "#log"]]);
    assert.deepEqual(commandForTool({ name: "dialog", args: { action: "dismiss" } }, false), [["dialog", "dismiss"]]);
  });
});
