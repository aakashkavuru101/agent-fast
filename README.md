# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama local-first](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[日本語](README.ja.md)

Agent-fast is an Apache-2.0, local-first browser agent for AI agents. It combines a native persistent Chrome daemon, compact accessibility refs, a secured MCP/CLI interface, and a bounded autonomous loop that works with a free local model through Ollama.

There is no required account, hosted browser, model subscription, telemetry, or per-action fee. You supply the machine, Chrome, and a compatible local model. Agent-fast builds on the Apache-licensed [`agent-browser`](https://github.com/vercel-labs/agent-browser) engine; the research behind that choice is in [docs/research.md](docs/research.md).

## Security contract

- Autonomous `run` is read-only by default. `--act` is required for model-driven clicks and fills.
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
agent-fast --act flow ./login-flow.json --param value1="replacement"
```

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

Use `agent-fast --act mcp` only when the client should be allowed to click and fill. The MCP server retains the same domain, output, environment, and action-policy restrictions as the CLI.

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

The following medians are from 50 iterations on this macOS arm64 host with Node.js 26.12.1, `agent-browser` 0.41.2, and Chrome 158.0.8127.18. They are local measurements, not universal rankings.

| Operation | Median |
| --- | ---: |
| Agent-fast native `get title` | 6.71 ms |
| Direct native `agent-browser` `get title` | 4.91 ms |
| Previous Node-wrapper `get title` | 59.40 ms |
| Persistent in-process Playwright `page.title()` | 0.22 ms |
| Agent-fast batched URL+title | 6.26 ms |
| Agent-fast separate URL+title calls | 10.96 ms |

Native execution reduced the earlier 120.35 ms Agent-fast baseline by 94.4%. Batching reduced URL+title state-read time by 42.9%. Raw persistent Playwright and direct native `agent-browser` are faster in this comparison; Agent-fast does not claim to beat every alternative at every operation.

## Verification results

The packaged CLI passes TypeScript build/type checks, dependency audit, 10 automated tests covering real Chromium workflows and negative security cases, MCP initialize/navigate/read/close, structured-output correction with a mock model, and live Ollama tasks using `qwen3.5:9b`. The tests cover native/batched/semantic/tab/history actions, domain and argument boundaries, secret-free replay files, and structured results. Model-free replay and JSON Schema `uri` format validation also pass on the live public site.

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
