# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama local-first](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[日本語](README.ja.md)

Agent-fast is an Apache-2.0, local-first browser runtime for AI agents and automated testing. It combines a native persistent Chrome daemon, compact accessibility refs, an event-driven MCP server, deterministic replay, and a bounded autonomous loop that works with a free local model through Ollama.

There is no required account, hosted browser, model subscription, telemetry, or per-action fee. You supply the machine, Chrome, and a compatible local model. Agent-fast builds on the Apache-licensed [`agent-browser`](https://github.com/vercel-labs/agent-browser) engine; the research behind that choice is in [docs/research.md](docs/research.md).

## Security contract

- Autonomous `run` is read-only by default. `--act` is required for model-driven clicks and fills.
- CLI, MCP, autonomous tools, and replay reject private/loopback URL hosts unless their exact host is explicitly allowlisted. This is a hostname check, not a network boundary: DNS, redirects, page requests, history, and auth-vault navigation remain outside this check.
- Direct `click`, `fill`, and `auth login` commands are explicit user-requested actions.
- Both policies deny JavaScript eval, downloads, uploads, network mutation, and saved-state mutation.
- Every engine call has an explicit policy, content boundaries, output caps, and timeout.
- The engine receives arguments without a shell and cannot inherit `AGENT_FAST_API_KEY` or unrelated ambient credentials.
- The default is a separate local browser session, not your personal Chrome profile or an arbitrary CDP endpoint.
- Page content is marked and prompted as untrusted data. This reduces prompt-injection risk but does not eliminate it.
- No control API is exposed on the network. MCP uses stdio.

This is security by design, not a guarantee of complete security. Read [SECURITY.md](SECURITY.md) before using credentials or acting on consequential websites.

## Requirements

- Node.js 24 or newer
- macOS, Linux, or Windows supported by `agent-browser`
- Chrome for Testing, installed below
- [Ollama](https://ollama.com/) only for autonomous `run`; direct CLI and MCP browsing do not need a model

## Install

```bash
npm install
npm run build
node dist/cli.js install
```

Optionally expose the CLI on your PATH:

```bash
npm link
agent-fast doctor
```

The examples below use `agent-fast`; substitute `node dist/cli.js` if you did not link it.

## Direct browsing

```bash
agent-fast open https://example.com
agent-fast snapshot
agent-fast get text body
agent-fast get url
agent-fast close
```

A snapshot assigns refs such as `@e1` to interactive elements. After navigation or a DOM change, take a new snapshot before reusing refs.

```bash
agent-fast click @e1
agent-fast fill @e2 "search text"
agent-fast scroll down 800
```

Direct clicks and fills express your own action and therefore use the interaction policy. Autonomous actions require the separate `--act` opt-in.

To contain navigation and subresources, provide an allowlist. Include required CDN origins or the page may break:

```bash
agent-fast --allowed-domains "example.com,*.example.com,cdn.example.net" open https://example.com
agent-fast --allowed-domains "example.com,*.example.com,cdn.example.net" snapshot
```

Persist the same session and allowlist on every related command. Session security settings are retained by the native engine.

For a trusted local development server, explicitly opt in with `--allowed-domains 127.0.0.1` (or its exact hostname). Wildcard patterns do not opt private hosts in.

## AI-agent capabilities

Version 0.2.0 executes the native engine directly and batches compatible operations. The autonomous loop accepts up to three ordered tool calls per model iteration and supports:

- compact snapshots, readable-page extraction, and batched URL/title state;
- history and tab refs such as `t1` from `tab_list`;
- semantic text/label actions when numeric element refs become stale;
- auth-vault profiles in `--act` mode;
- JSON-Schema-valid structured outcomes;
- deterministic workflow replay with no model calls.

### Structured results

Supply a local JSON Schema to require machine-readable output in `result`:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "url": { "type": "string", "format": "uri" }
  },
  "required": ["title", "url"],
  "additionalProperties": false
}
```

```bash
agent-fast --schema ./schema.json run \
  "Open https://example.com and return the actual title and URL in result"
```

Invalid results are returned to the model for correction. The final response also contains independently observed URL/title evidence.

### Model-free workflow replay

Save a successful run, then replay it without another model call:

```bash
agent-fast --act --save-flow ./flow.json run \
  "Open https://example.com and inspect the page"
agent-fast flow ./flow.json
```

Filled values are never written to the workflow file. They become placeholders such as `{{value1}}` and must be supplied at replay time:

```bash
agent-fast --act flow ./login-flow.json --param-env value1
```

Set `value1` in the environment through your secret manager or a hidden terminal prompt before running this command. Repeat `--param-env NAME` for each parameter. Missing, duplicate, and unused parameters fail closed. `--param value1=replacement` remains available for non-sensitive values, which are visible in shell history and process listings. Filled values travel to the engine over stdin; replay traces and page output may still expose them.

Workflow files are written atomically with owner-only permissions. Replay uses the same action, domain, output, timeout, and read/act policy checks.

## Free autonomous agent

Start Ollama and pull a tool-capable model:

```bash
ollama pull qwen3:4b
ollama serve
```

Then run a read-only research task:

```bash
agent-fast run "Open https://example.com and report the page title and main heading"
```

Allow ordinary interaction explicitly:

```bash
agent-fast --act --allowed-domains "example.com,*.example.com" run \
  "Open https://example.com, use the More information link, and summarize the result"
```

Defaults:

- model: `qwen3:4b`
- endpoint: `http://127.0.0.1:11434/v1/chat/completions`
- maximum agent iterations: 20
- browser closes after `run` unless `--keep-open` is set

Another OpenAI-compatible endpoint can be selected without changing the agent:

```bash
export AGENT_FAST_MODEL="your-model"
export AGENT_FAST_MODEL_URL="https://provider.example/v1/chat/completions"
export AGENT_FAST_API_KEY="your-key"  # optional; kept out of engine processes
agent-fast run "Summarize the current page"
```

Remote inference may cost money and sends page content to that provider. Loopback HTTP is accepted; non-loopback model endpoints must use HTTPS.

## MCP for coding agents

For repeated agent actions, connect once through MCP. The Node process and browser remain warm; each action avoids a fresh Node startup. Claude Code or another MCP client supplies the reasoning, so no second model loop or Ollama process is required.

```bash
agent-fast mcp
```

Or configure a client with the built CLI:

```json
{
  "mcpServers": {
    "agent-fast": {
      "command": "node",
      "args": ["/absolute/path/to/agent-fast/dist/cli.js", "mcp"]
    }
  }
}
```

Use `agent-fast --act mcp` only when the client should interact. Agent-fast owns the MCP server and reuses CLI action validation, private-host URL checks, bounded engine execution, and the configured session. Tool arguments cannot change the session, domain allowlist, or policy. Actions execute in order, failures return explicit tool errors, and the browser closes when the client disconnects. The underlying engine's broad tool catalog is not exposed; clients should discover the supported tools with `tools/list`.

Use `agent_fast_batch` to execute up to 50 ordered actions in one request. Compatible actions share native batches. Every action is validated before execution, and the first execution failure stops the batch. Completed actions are not rolled back. For example, its arguments can be:

```json
{
  "steps": [
    { "action": "fill_label", "args": { "label": "Search", "text": "example" } },
    { "action": "click_text", "args": { "text": "Go" } },
    { "action": "assert_text", "args": { "selector": "#output", "text": "Clicked: example" } }
  ]
}
```

## Automated testing

Use readiness conditions and explicit assertions in CLI, MCP, autonomous runs, and saved workflows:

```bash
agent-fast wait-for '#ready'
agent-fast frame '#app-frame'
agent-fast snapshot
agent-fast fill @e2 'test input'
agent-fast select '#country' 'JP'
agent-fast press Enter
agent-fast assert-text '#status' 'Saved'
agent-fast frame main
```

`wait_for` supports visible, hidden, attached, and detached states through MCP/workflows. `assert_text` retries reads until the exact text matches and reports a failure on timeout. Both accept a timeout capped at 30 seconds and the configured command deadline. Keyboard and dropdown actions require `--act` in autonomous/MCP/replay mode.

For nested frames, snapshot the selected frame and switch using its fresh iframe ref. CSS frame selectors and semantic text/label locators resolve from the main document in the current engine; inside frames use fresh refs for clicking/filling. These primitives are tested against local dynamic pages, not yet against authenticated Microsoft workloads. Applications needing file uploads/downloads or arbitrary page JavaScript remain outside the supplied policies.

A site-isolated cross-origin iframe fixture stalled during navigation with `agent-browser` 0.41.2 and the domain filter enabled. Its reproduction is retained as an explicitly skipped test. Cross-origin iframe compatibility is not qualified; the passing nested-frame test uses same-origin frames. This engine limitation matters for embedded enterprise applications and remains unresolved.

To rerun that known-failing reproduction after an engine/browser change:

```bash
AGENT_FAST_TEST_CROSS_ORIGIN=1 node --test --test-name-pattern=site-isolated test/browser.test.mjs
```

Set `CHROME_PATH` to test another Chromium executable. Ordinary tests leave this reproduction skipped.

## Authentication

The underlying engine can keep credentials in its encrypted local auth vault. Use its official vault setup instructions, then reference only the profile name:

```bash
agent-fast auth login my-profile
```

Do not put passwords in the task, command line, or model context. Prefer a dedicated browser profile and a domain allowlist for authenticated work. Agent-fast does not implement its own credential store.

## Performance design

Agent-fast launches the native engine binary directly instead of spawning a second Node.js wrapper. Compatible operations share JSON batches, startup open+snapshot and URL+title state reads are batched, and model calls accept up to three ordered actions per iteration. The daemon remains warm between commands.

Run the independent benchmark against a fixed loopback page:

```bash
CHROME_PATH=/absolute/path/to/chrome npm run benchmark
```

The following medians are from 50 iterations on 2026-11-09 on this macOS arm64 host with Node.js 26.12.1, `agent-browser` 0.41.2, and Chrome 158.0.8127.18. Each CLI sample starts a new Node process with `dist/cli.js` and reads from a warm daemon. In-process rows exclude Node startup. These are local measurements, not universal rankings.

| Operation | Median |
| --- | ---: |
| Agent-fast CLI `get title` (includes Node startup) | 63.01 ms |
| Agent-fast persistent MCP `get title` | 4.93 ms |
| Agent-fast MCP batched URL+title | 5.48 ms |
| Agent-fast in-process native `get title` | 4.77 ms |
| Direct native `agent-browser` `get title` | 3.72 ms |
| Direct `agent-browser` Node-wrapper `get title` | 57.81 ms |
| Persistent in-process Playwright `page.title()` | 0.17 ms |
| Agent-fast in-process batched URL+title | 5.22 ms |
| Agent-fast in-process separate URL+title calls | 9.24 ms |

MCP initialization took 97.92 ms once in this sample. MCP rows include the complete local JSON-RPC round trip through a running Agent-fast process; they exclude model inference, browser launch, navigation, and sign-in. A one-off CLI command still pays Node startup. The table compares different usage modes. Raw results, including p95 and environment metadata, are in [benchmarks/latest.json](benchmarks/latest.json).

The earlier 94.4% speedup claim compared a full CLI invocation with an in-process call and is withdrawn. This benchmark does not rerun the old Agent-fast CLI, so it makes no before/after CLI speedup claim. The wrapper row is direct `agent-browser`, not the previous Agent-fast CLI. Raw persistent Playwright and direct native `agent-browser` are faster in this comparison.

## Verification results

The current macOS verification passes TypeScript build/type checks and the automated suite, including eight real Chromium workflows and six command-executor fault-injection tests. Coverage includes nested-frame refs, dropdowns, keyboard input, delayed readiness, assertions, MCP error recovery, daemon termination and explicit reopening, malformed/oversized protocol messages, policy boundaries, and replay across multiple native batches. CI is configured for Linux, macOS, and Windows; those new matrix jobs have not been run here, and the daemon signal test is skipped on Windows. Live Microsoft workloads, Ollama tasks, public-site replay, and auth-vault login were not run for this change.

Final answers include independently observed URL and document-title evidence. Benchmark code and repeatable tests are included in the repository.

## Limitations

- No browser agent can guarantee complete security or immunity to prompt injection.
- Domain filtering is not an OS firewall. Use container and network egress controls for strong isolation.
- The agent has no built-in CAPTCHA bypass, stealth fingerprinting, residential proxy service, or hosted browser fleet.
- Local model quality and tool-call support vary. Direct CLI/MCP mode is available when a model cannot follow the strict tool schema.
- Read-only mode can navigate and read pages, but it cannot complete workflows that need clicks or form entry.
- Fill text and selector arguments cannot start with a hyphen; this prevents engine-option overrides in the current release.
- Page output and model conversations can contain sensitive data. Close sessions and avoid regulated or personal data unless you have assessed the risk.

## License

Apache-2.0. See [LICENSE](LICENSE).
