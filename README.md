# Agent-fast

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

Agent-fast avoids recurring browser startup, full DOM dumps, screenshots by default, and unnecessary model steps. It opens the first task URL directly, uses compact interactive snapshots, caps page output, elides older observations, and leaves the native daemon running between direct commands.

Measure warm latency on your own workload rather than relying on vendor comparisons. A fair benchmark should fix the browser, page, model, network, snapshot options, and warm/cold state, and report median and p95 timings. No cross-vendor benchmark is claimed here.

## Verification results

The packaged CLI passed TypeScript build/type checks, dependency audit, a real Chromium form/navigation workflow, MCP initialize/navigate/read/close, and local Ollama read-only and interactive tasks using `qwen3.5:9b`. Negative checks confirmed eval/download/upload/state denial, read-only click denial, domain blocking, argument-override rejection, and ambient API-key stripping. Final answers include independently observed URL and document-title evidence.

On the fixed loopback fixture with Node.js 26.12.1, `agent-browser` 0.41.2, and Chrome 158.0.8127.18, 20 warm `get title` calls measured 120.35 ms median, 126.37 ms mean, and 149.99 ms p95. These timings include spawning the Agent-fast Node.js wrapper and communicating with the already-running native daemon; they are not CDP-only or cross-vendor timings. The four-element interactive snapshot was 134 characters.

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
