# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aakashkavuru101/agent-fast?logo=npm&logoColor=white)](https://www.npmjs.com/package/@aakashkavuru101/agent-fast)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama local-first](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[日本語](README.ja.md)

Agent-fast is a free, open-source browser for AI agents. One install gives an agent a contained browser over MCP, from the command line, or in an autonomous loop with the model of your choice, and asks nothing else of you: no account, no hosted browser, no telemetry, no per-action fee.

It is built on the Apache-licensed [`agent-browser`](https://github.com/vercel-labs/agent-browser) engine and adds what an agent needs around it:

| Need | What Agent-fast does |
| --- | --- |
| **Token efficiency** | Snapshots arrive as plain text without the engine's refs map (72% smaller across seven public sites). Navigation results carry the new page, so the model acts instead of asking. `snapshot` with `diff` returns only what changed. |
| **Zero setup** | Uses the Chrome, Brave, Edge, or Chromium already on the machine. `npx @aakashkavuru101/agent-fast mcp` is a working MCP server; `install` downloads a browser only when there is none. |
| **Vision fallback** | A failed element lookup returns the page as a screenshot with a hint to click by coordinates, over MCP and in the run loop. Models that can see get the image. |
| **Model integrations** | `claude-*`, `gpt-*`, `o*`, and `gemini-*` names route to their vendor with the vendor's key. Anything else runs on Ollama or any OpenAI-compatible URL. Claude goes through the official SDK with images in tool results. |
| **Stealth** | No automation flag, so `navigator.webdriver` is false. Headless sessions on an installed browser send that browser's own user agent, not `HeadlessChrome`. |
| **Human checks** | reCAPTCHA, hCaptcha, Turnstile, and "verify you are human" pages are detected and handed to a person in a visible window on the same profile. Nothing is solved automatically. |
| **Containment** | Every request leaves through a local egress proxy that enforces a domain allowlist after DNS resolution. The tool catalog is closed: no eval, no shell, no raw engine access. |
| **Speed** | A warm action answers in well under a millisecond, because each action is one line to the engine daemon, not a new process. |

Power Platform (Power Apps, Power Automate, Dataverse, SharePoint) is where it has been measured hardest, and the numbers are below. Everything in it is general: the same tools drive any site.

## Contents

- [Quick start](#quick-start)
- [Benchmarks and evals](#benchmarks-and-evals)
- [Security contract](#security-contract)
- [Requirements and install](#requirements-and-install)
- [Direct browsing](#direct-browsing)
- [Capabilities](#capabilities)
- [MCP for coding agents](#mcp-for-coding-agents)
- [Autonomous runs](#autonomous-runs)
- [Workflow replay without a model](#workflow-replay-without-a-model)
- [Power Platform and other Microsoft apps](#power-platform-and-other-microsoft-apps)
- [Human checks](#human-checks)
- [Authentication](#authentication)
- [Fingerprint](#fingerprint)
- [Automated testing](#automated-testing)
- [Video](#video)
- [Performance design](#performance-design)
- [Verification](#verification)
- [Limitations](#limitations)

## Quick start

With a Chromium-based browser installed, an MCP client needs one entry:

```json
{
  "mcpServers": {
    "agent-fast": {
      "command": "npx",
      "args": ["-y", "@aakashkavuru101/agent-fast", "--act", "mcp"]
    }
  }
}
```

Drop `--act` for a read-only browser. From a terminal:

```bash
npm install -g @aakashkavuru101/agent-fast
agent-fast doctor                       # names the browser it will use and checks it starts
agent-fast open https://example.com
agent-fast snapshot                     # the page as a tree with @e1-style refs
agent-fast --act click @e1
agent-fast close
```

An autonomous run with a local model, or a hosted one:

```bash
ollama pull qwen3:4b                    # free, local
agent-fast run "Open https://example.com and report the main heading"

export ANTHROPIC_API_KEY=...            # or OPENAI_API_KEY, GEMINI_API_KEY
AGENT_FAST_MODEL=claude-opus-5-5 agent-fast --act run "Find the pricing page and list the plans"
```

## Benchmarks and evals

Four measurements, from the engine up to a full agent on real Microsoft pages. Raw data and scripts are in [benchmarks/](benchmarks/). All of them are local measurements on one macOS arm64 machine, not universal rankings.

### 1. Warm action latency

`npm run benchmark` ([benchmarks/warm.mjs](benchmarks/warm.mjs)) times one action against a fixed loopback page, 50 iterations each, and compares Agent-fast with the engine's own clients and with persistent Playwright. Medians on 2026-11-12 for this release (0.4.0) with Node.js 26.12.1, `agent-browser` 0.41.2, and Brave (Chromium 157).

| Path | Median | p95 |
| --- | ---: | ---: |
| Agent-fast in-process `get title` | 0.31 ms | 0.40 ms |
| Agent-fast MCP `get title` (full JSON-RPC round trip) | 0.50 ms | 0.67 ms |
| Agent-fast MCP batch, URL + title | 1.35 ms | 1.57 ms |
| Persistent in-process Playwright `page.title()` | 0.17 ms | 0.29 ms |
| Native `agent-browser` `get title` (one process per action) | 3.72 ms | 4.31 ms |
| Agent-fast CLI `get title` (new Node process each time) | 58.09 ms | 61.00 ms |
| `agent-browser` Node wrapper `get title` | 57.39 ms | 58.96 ms |

Warm MCP actions are about ten times faster than in version 0.2.0 (4.77 ms) and faster than the engine's own native client. A one-shot CLI command is bounded by Node startup, so use MCP when latency matters. MCP initialization took 303 ms once. Raw results: [benchmarks/latest.json](benchmarks/latest.json).

### 2. Head-to-head on real Power Platform work

[benchmarks/pp-head-to-head/](benchmarks/pp-head-to-head/) runs the same task with the same model (`claude-opus-5-5`, effort xhigh, Claude Code 2.1.322), the same Brave binary, and the same sandbox environment through three browser tools, one run each. The task (BM2) is three rounds of: open the maker portal, open the apps list, open a canvas app in Power Apps Studio, select a button, read its `OnSelect` formula, and close Studio without changes. Measured on 2026-11-11 with Agent-fast 0.3.0; full write-up in [results-2026-11-11.md](benchmarks/pp-head-to-head/results-2026-11-11.md).

| Tool | Wall | Browser calls | Errors | Median call | p95 call | Model turns | Input tokens | API-equivalent cost | Success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **Agent-fast** | **261 s** | 58 | 11 | **85 ms** | 30.0 s | 36 | 2,327,315 | $1.54 | yes |
| Claude in Chrome | 270 s | **33** | **4** | 3,364 ms | **15.8 s** | **33** | **1,076,540** | **$0.79** | yes |
| Playwright MCP | 540 s | 49 | 5 | 672 ms | 30.0 s | 49 | 1,760,498 | $1.05 | yes |

All three read the formula correctly in all three rounds and left the app unchanged. Cost is Claude Code's own API-equivalent figure; the runs used a subscription, so nothing was billed.

What it showed:

- **Agent-fast was fastest** on wall time and by far on single actions, and it read Studio through text, inside the iframe, without running arbitrary code. Its useful browser work came to about 25 s against Claude in Chrome's 151 s.
- **Agent-fast lost on errors and tokens.** Two 30 s timeouts on text waits inside Studio's iframe (AF-3) and the engine's `refs` map, 48% of every snapshot (AF-10), cost it 75 s and twice the input tokens of Claude in Chrome.
- **Claude in Chrome was most efficient** because it worked by sight: batched coordinate clicks and a zoomed screenshot of the formula. That is fragile; in round 2 the layout shifted and clicks had to be re-aimed.
- **Playwright MCP was slowest and least contained.** 19 of its 49 calls ran arbitrary Playwright code the model wrote, and four built-in waits cost it 151 s. Agent-fast has no such tool by design.

Both Agent-fast losses are fixed in 0.4.0 (see the findings table below). The rerun is pending; the wait fix alone accounts for about 60 s of the 261 s.

### 3. Live Power Platform through a harness

[benchmarks/power-platform-live.md](benchmarks/power-platform-live.md) records Agent-fast 0.3.0 as the browser of a private Power Platform harness (a Claude Code plugin over MCP, with its guard and rules on) against a real Dataverse sandbox and a SharePoint site on 2026-11-11. Times run from each MCP tool call to its result.

| Case | What was done | Calls | Errors | Median | p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| H | Maker portal, apps list, refusals, Copilot Studio, Power BI | 15 | 0 | 1.8 s | 6.9 s |
| BM2 | 3 × (home, apps list, open Studio, select a button, read `OnSelect`, close) | 57 | 11 | 1.5 s | 30.2 s |
| L1 | Create a SharePoint list and its columns in the site UI | 25 | 5 | 3.3 s | 31.2 s |
| L2 | Choice column, filtered view, a second list with lookup, person, and date columns; read back through REST pages | 53 | 15 | 3.2 s | 11.2 s |
| L3 | Calculated column, 3 indexes, column-formatting JSON; verified through REST pages | 50 | 4 | 3.6 s | 15.4 s |
| D1 | Dataverse solution and table with 3 columns in the maker portal; a column fixed after read-back | 48 | 7 | 2.3 s | 31.0 s |
| D2 | A second Dataverse table (choice column synced to a global choice, a default value); read back | 76 | 9 | 2.2 s | 31.2 s |
| D3 | Read-only checks through Dataverse Web API pages | 9 | 2 | 1.5 s | 4.6 s |

Studio becomes usable 57 to 60 s after its URL opens; that is Studio's own load. The proxy blocked only Chrome background hosts; no Microsoft host was refused. The same session found these issues, with their status today:

| ID | Finding | Status |
| --- | --- | --- |
| AF-1 | The engine refuses some clicks inside Studio's iframe as "covered"; Agent-fast clicks the on-screen position instead | Works as designed; reported upstream |
| AF-2 | The CLI `click` skipped that fallback | Fixed in 0.4.0: every click path uses it |
| AF-3 | `wait_for` with text did not look inside iframes; 30 s timeouts in Studio | Fixed in 0.4.0: text waits read iframes and shadow DOM |
| AF-4 | `frame <ref>` then a CSS selector fails in Studio, even `body` | Open; refs work |
| AF-5 | Studio's formula bar exposes only its first line to `get text` | Open; formulas are read by paging the bar or from a screenshot |
| AF-6 | Two MCP servers on one `--profile` fail on Chrome's profile lock without naming it | Open; one browser per profile at a time |
| AF-7 | Each CLI call must repeat the session's launch flags | Open; the mismatch is reported, not remembered |
| AF-8 | Chrome for Testing runs with an English UI, so display names set on a Japanese SharePoint site are stored as English only | Open; high impact at Japanese tenants; a `--lang` option is the fix |
| AF-9 | `click_text` and `batch` clicks lacked the covered-click fallback | Fixed in 0.4.0 |
| AF-10 | Every MCP snapshot repeated the `refs` map, 48% of its characters | Fixed in 0.4.0: snapshots are plain text |

### 4. Agent eval with a local model

`npm run benchmark:agent` ([benchmarks/agent-eval.mjs](benchmarks/agent-eval.mjs)) runs eight tasks against local pages with a real model and checks each result exactly: read a title, extract a price, look a value up in a table, follow a link, use a search form, fill a form inside an iframe, accept a confirmation dialog, and read a page that tries to inject instructions. One attempt per task at temperature 0, on this host with Ollama.

| Model | Passed | Notes |
| --- | ---: | --- |
| `qwen3.5:9b` | 6 of 8 | 1 to 4 model steps and 26 to 51 s per task. One miss reported the right heading from the wrong page; the other paraphrased a status. It did not follow the injected instruction. Measured 2026-11-10; raw results in [benchmarks/agent-eval.json](benchmarks/agent-eval.json). |
| `qwen3:4b` (default) | 7 of 8 | Correct on every ordinary task but slow, 27 to 460 s each, because it reasons for minutes before each reply. On the injection page it stopped calling tools and the run failed. Needs the 5-minute `--model-timeout` default. Measured 2026-11-11. |
| `llama3.2:3b` | 1 of 8 | Reads pages but cannot form a schema-valid `done` call. |

Expect run-to-run variation. Rerun with `AGENT_FAST_MODEL=<model> npm run benchmark:agent`; hosted models work the same way with their key set.

## Security contract

- All browser traffic, including loopback, redirects, subresources, iframes, and WebSockets, passes through a per-session egress proxy. The proxy resolves each host, refuses private, loopback, link-local, NAT64, and 6to4 addresses, and connects to the address it checked. This closes DNS-rebinding and `127.0.0.1.nip.io`-style bypasses.
- With `--allowed-domains` or `--allow-preset`, the proxy also refuses every host outside the allowlist. An exact entry such as `127.0.0.1` is the explicit opt-in for a private host; wildcards never opt private hosts in.
- Autonomous `run` is read-only by default; `--act` is required for model-driven interaction. Without an allowlist, the model may only navigate to the sites named in the task, so a page cannot talk it into carrying data elsewhere. `--open-web` lifts that.
- Both policies deny JavaScript eval, network interception, and cookie, storage, and saved-state access. Uploads and downloads are disabled until you name a directory for them, and are confined to it. A download a page starts lands in `~/.agent-fast/downloads`, never in your own Downloads folder.
- Values typed into pages travel as JSON, never as command-line arguments, so text such as `--action-policy` or `-5` is typed literally and cannot change engine settings.
- The engine receives no shell and cannot inherit `AGENT_FAST_API_KEY`, vendor keys, or unrelated ambient credentials. A vendor key is sent only to that vendor's own API; a custom model URL receives only `AGENT_FAST_API_KEY`.
- The default browser is a separate session, not your personal Chrome profile or an arbitrary CDP endpoint. `--profile` uses a dedicated directory.
- Page content is prompted as untrusted data. This reduces prompt-injection risk but does not eliminate it.
- No control API is exposed on the network. MCP uses stdio; the proxy listens on loopback only.

This is security by design, not a guarantee of complete security. Read [SECURITY.md](SECURITY.md) before using credentials or acting on consequential websites.

## Requirements and install

- Node.js 24 or newer on macOS, Linux, or Windows
- A Chromium-based browser. Agent-fast finds an installed Chrome, Brave, Edge, or Chromium; `agent-fast install` downloads Chrome for Testing when there is none. `--executable-path` or `CHROME_PATH` picks one explicitly
- [Ollama](https://ollama.com/) or a vendor key only for autonomous `run`; direct CLI and MCP browsing need no model
- `ffmpeg` only for `--record`

```bash
npm install -g @aakashkavuru101/agent-fast
agent-fast doctor       # reports the browser it will use and checks that it starts
agent-fast install      # only if doctor finds no browser
```

From a clone: `npm install && npm run build`, then `node dist/cli.js` in place of `agent-fast`, or `npm link` to put it on your PATH.

## Direct browsing

```bash
agent-fast open https://example.com
agent-fast snapshot
agent-fast get text body
agent-fast screenshot
agent-fast close
```

A snapshot assigns refs such as `@e1` to interactive elements, including elements inside iframes. After navigation or a DOM change, take a new snapshot before reusing refs. Long trees are cut at `--max-output`; `agent-fast snapshot main` (or `selector` over MCP) reads one region with its refs.

```bash
agent-fast click @e1
agent-fast fill @e2 "search text"
agent-fast fill @e2 -- -5          # put -- before a value that starts with a hyphen
agent-fast hover @e3
agent-fast press Enter
agent-fast dialog accept
agent-fast tab-new https://example.org   # also tab-list, tab-switch t1, tab-close t2
```

Direct interaction commands express your own action and therefore use the interaction policy. Autonomous actions require the separate `--act` opt-in.

To contain a session, provide an allowlist. `*.example.com` covers `example.com` and its subdomains. Include the CDN hosts a page needs:

```bash
agent-fast --allowed-domains "*.example.com,cdn.example.net" open https://example.com
agent-fast --allowed-domains "*.example.com,cdn.example.net" snapshot
agent-fast blocked     # hosts the proxy refused; add the ones the page needs
```

Pass the same session and allowlist on every related command. Changing the allowlist of a running session is refused; `close` it first. For a trusted local development server, opt in with `--allowed-domains 127.0.0.1` (or its exact hostname).

## Capabilities

| Area | Tools (CLI, MCP, autonomous run, and workflows) |
| --- | --- |
| Navigate and read | `open`, `read`, `snapshot`, `get_text`, `get_state`, `back`, `forward`, `reload`, `scroll`, tabs |
| Wait and verify | `wait`, `wait_for` (selector state, visible text including text inside iframes and shadow DOM, URL glob, or load state such as `networkidle`), `assert_text` |
| Interact (`--act`) | `click` (single or double), `fill`, `type` (real keystrokes), `press`, `hover`, `check`, `select`, `drag`, `click_text`, `fill_label`, `click_at` and `drag_at` (viewport coordinates) |
| Dialogs | `dialog` status, dismiss, and accept (accept needs `--act`); alerts are accepted automatically |
| Frames | `frame` to scope by selector or ref; refs and role/name locators reach into same- and cross-origin iframes without switching |
| Files (`--act`) | `upload` from `--upload-dir`, `download` into `--download-dir` |
| Evidence | `screenshot`, `console` (messages and uncaught errors), `network` (request list), failure screenshots, `--record` video |
| Sign-in | `auth_login` with the engine's encrypted auth vault, `--profile` for persistent sign-in |
| Fallbacks | A failed element lookup returns a screenshot for `click_at` and `drag_at`; `handoff` lets a person solve a human check in a visible window |

### Locating elements

Interaction tools accept either a ref from the latest snapshot or a role and accessible name:

```json
{ "action": "click", "args": { "role": "button", "name": "Save" } }
{ "action": "fill", "args": { "role": "textbox", "name": "Flow name", "text": "Weekly report" } }
{ "action": "click", "args": { "role": "button", "name": "Delete", "nth": 1 } }
```

Role and name locators take a fresh snapshot, wait up to three seconds for the element to render, and work inside iframes. If several elements match, the call fails and asks for `nth` instead of guessing.

## MCP for coding agents

Connect once; the Node process and browser stay warm, and each action is one message to the engine daemon. Claude Code or another MCP client supplies the reasoning.

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

Use `agent-fast --act mcp` only when the client should interact. Tools are named `agent_fast_<action>`; clients should discover them with `tools/list`. Tool arguments cannot change the session, domain allowlist, or policy.

Results are shaped to save model turns and tokens:

- A snapshot arrives as plain text without the engine's `refs` map; the tree already names each ref.
- After `open`, `back`, `forward`, `reload`, a tab change, or any action that changes the URL, the result carries the new page's tree, so the model acts on it instead of asking for a snapshot.
- For a same-page action, a `batch` that ends with `wait_for` and `snapshot` acts and looks in one call.
- After one full read, `snapshot` with `diff` returns only the lines added and removed since the previous tree of the same scope.
- When an element lookup fails (no such ref, role, name, or selector), the result carries a screenshot, so a client that can see images falls back to `click_at` and `drag_at` on its pixel coordinates.
- When a page shows a human check, the result says so and names `agent_fast_handoff`.
- The server's `initialize` reply carries these patterns as instructions for clients that show them to the model.

Sessions and protocol:

- Each server gets its own browser session unless you pass `--session`, so one client disconnecting cannot close another client's browser. The browser closes when the client disconnects unless `--keep-open` is set.
- Browser actions run in order. Protocol requests such as `ping` are answered immediately, even during a long wait.
- `notifications/cancelled` removes a queued request or stops waiting on the running one. A cancelled request gets no response, and an action already sent to the browser may still complete.
- `agent_fast_screenshot` returns the image itself as well as its path.

`agent_fast_batch` executes up to 50 ordered actions in one request. Every action is validated before execution, and the first failure stops the batch and returns a screenshot. Completed actions are not rolled back.

```json
{
  "steps": [
    { "action": "fill", "args": { "role": "textbox", "name": "Search", "text": "example" } },
    { "action": "click", "args": { "role": "button", "name": "Go" } },
    { "action": "assert_text", "args": { "selector": "#output", "text": "Clicked: example" } }
  ]
}
```

## Autonomous runs

`run` drives the browser with a model of your choice. A free local model is the default:

```bash
ollama pull qwen3:4b
ollama serve
agent-fast run "Open https://example.com and report the page title and main heading"
agent-fast --act run "Open https://example.com, use the Learn more link, and summarize the result"
```

Defaults: model `qwen3:4b` at `http://127.0.0.1:11434/v1/chat/completions`, 20 iterations, 5 minutes per model reply (`--model-timeout`; a reply that times out is not retried), navigation limited to the sites named in the task unless `--allowed-domains` or `--open-web` is given, and the browser closes afterwards unless `--keep-open` is set.

The loop is built for small models. Malformed tool arguments, unknown tools, and schema failures are reported back to the model instead of ending the run. A tool call written as JSON text is recognised. A reply with no tool call is never treated as success by itself: an empty reply fails the run, and a prose answer is accepted only when the model repeats it after being asked for the `done` tool and no result schema is required. Every rejected reply is kept in the trace.

### Hosted models

A model name picks its vendor, and the vendor's usual key is read: `claude-*` uses the Anthropic Messages API with `ANTHROPIC_API_KEY`, `gpt-*` and `o*` use OpenAI with `OPENAI_API_KEY`, and `gemini-*` uses Google's OpenAI-compatible endpoint with `GEMINI_API_KEY`. `AGENT_FAST_API_KEY` overrides any of them, a custom `AGENT_FAST_MODEL_URL` receives only `AGENT_FAST_API_KEY`, and none reach the browser engine.

```bash
AGENT_FAST_MODEL=claude-opus-5-5 agent-fast --act run "Find the pricing page and list the plans"
```

Any other OpenAI-compatible endpoint works with an explicit URL, including a `claude-*` name on a gateway's chat-completions URL:

```bash
export AGENT_FAST_MODEL="your-model"
export AGENT_FAST_MODEL_URL="https://provider.example/v1/chat/completions"
export AGENT_FAST_API_KEY="your-key"  # optional; kept out of engine processes
agent-fast run "Summarize the current page"
```

Models that can see get images: a `screenshot` result and the page after a failed element lookup travel with the tool result, so the model can fall back to `click_at` on what it sees. On the Claude path the history is never edited, so thinking stays valid and the growing prefix is cached. On chat completions only the newest image is kept, and a text-only model that rejects an image gets the request again without it.

Remote inference may cost money and sends page content to that provider. Loopback HTTP is accepted; non-loopback model endpoints must use HTTPS.

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

Invalid results are returned to the model for correction. The final response also contains independently observed URL and title evidence.

## Workflow replay without a model

Save a successful run, then replay it without another model call:

```bash
agent-fast --act --save-flow ./flow.json run \
  "Open https://example.com and inspect the page"
agent-fast flow ./flow.json
```

A saved workflow keeps only the steps that succeeded, and records each interacted element by role and name rather than by ref, so replay still finds it after the page renumbers its elements. Replay is not immune to redesigns: a renamed button fails explicitly, with a screenshot.

Typed values are never written to the workflow file. They become placeholders such as `{{value1}}` and must be supplied at replay time:

```bash
agent-fast --act flow ./login-flow.json --param-env value1
```

Set `value1` in the environment through your secret manager or a hidden terminal prompt before running this command. Repeat `--param-env NAME` for each parameter. Missing, duplicate, and unused parameters fail closed. `--param value1=replacement` remains available for non-sensitive values, which are visible in shell history and process listings. Replay traces and page output may still expose typed values.

Workflow files are written atomically with owner-only permissions. Replay uses the same action, domain, output, timeout, and read/act policy checks.

## Power Platform and other Microsoft apps

Power Apps, Power Automate, Dynamics 365, and Microsoft 365 are single-page applications that sign in through `login.microsoftonline.com` and embed cross-origin frames. Use the Microsoft allowlist preset and a dedicated profile so sign-in survives between sessions:

```bash
# Sign in once in a visible window (password, MFA, and consent are yours to complete)
agent-fast --headed --profile ~/.agent-fast/profiles/work --allow-preset microsoft \
  open https://make.powerautomate.com

# Later sessions reuse the profile and can run headless. Choose the environment in the
# address, so your default environment is never switched or touched:
agent-fast --profile ~/.agent-fast/profiles/work --allow-preset microsoft \
  open https://make.powerapps.com/environments/<environment-id>/apps
agent-fast --profile ~/.agent-fast/profiles/work --allow-preset microsoft snapshot
```

For an MCP client, start the server with the same options:

```json
{
  "mcpServers": {
    "agent-fast": {
      "command": "node",
      "args": ["/absolute/path/to/agent-fast/dist/cli.js", "--act", "--allow-preset", "microsoft",
               "--profile", "/absolute/path/to/profiles/work", "mcp"]
    }
  }
}
```

### Under the AllBlue Power Platform harness

The [harness](https://github.com/AllBlue-inc/PP-harness-pkg) guard recognises Agent-fast as a browser when the MCP server is registered as `agent-fast`, and holds it to the same page gates and URL checks as Claude in Chrome: maker-portal pages and Studio in the AI room ask in Manual mode and run in auto mode, anything outside the AI room is refused, and `upload`, `download` and `auth_login` ask. Register it from the project folder, then sign in once in a visible window and close that session before the MCP server starts:

```bash
claude mcp add agent-fast -- node /absolute/path/to/agent-fast/dist/cli.js --act --allow-preset microsoft --profile ~/.agent-fast/profiles/work mcp
agent-fast --headed --profile ~/.agent-fast/profiles/work --allow-preset microsoft open https://make.powerapps.com
agent-fast --profile ~/.agent-fast/profiles/work --allow-preset microsoft close
```

Practical notes for these applications:

- Prefer role and name locators; maker portals re-render constantly and refs go stale.
- Use `wait_for` with `text` after navigation; pages keep loading after the first paint. Text waits also look inside iframes and shadow DOM. Power Apps Studio never reaches `networkidle`.
- Fluent comboboxes and code editors ignore `fill`; use `click` then `type` and `press`.
- A profile directory serves one browser at a time. `close` the visible sign-in session before starting another session with the same profile.
- Power Apps Studio runs in a frame. Its tree view, property list, formula bar, and canvas controls all appear in snapshots. The engine refuses some clicks inside that frame as "covered"; Agent-fast then clicks the element's on-screen position instead and says so in the result.
- Rows in maker-portal lists appear only in a full snapshot (`snapshot` with `full: true`); the default snapshot lists interactive elements.
- A cross-origin frame inside another cross-origin frame is invisible to the engine. Take a `screenshot` and use `click_at`, `drag_at`, and `type` there, or find the inner frame's address with `network` (it appears as the `referer` of requests the frame makes) and open it in its own tab with `tab_new`, where snapshots and locators work normally.
- `agent-fast blocked` lists hosts the allowlist refused. If a tenant uses a custom domain, add it with `--allowed-domains`.
- The preset trusts Microsoft-operated domains broadly, including tenant-hosted content such as `*.sharepoint.com`. Use a narrower `--allowed-domains` list where that matters.

**Verified on 2026-11-11** (one Microsoft 365 tenant, one non-default environment, Brave): sign-in with MFA kept by the profile into a headless session; the Power Automate flow list and a flow's details; opening a canvas app in Studio to select a control and read its formula; and, through the harness, creating SharePoint lists, columns, views, and formatting, and Dataverse solutions and tables (the live benchmark above). Model-driven apps, Dynamics 365, and Copilot Studio editing are not verified, and tenant policies such as Conditional Access can refuse an automated browser.

## Human checks

Agent-fast does not solve CAPTCHAs. When a page shows one (reCAPTCHA, hCaptcha, Turnstile, "verify you are human"), the MCP result says so and the `handoff` tool, or `agent-fast handoff`, gives the page to the person: in a `--headed` session the call waits until the check is gone; in a headless session with `--profile`, the session reopens in a visible window on that profile, waits, returns headless, and confirms the check is gone. If it comes back, the call fails and says to run headed. Without a profile the call explains what to start with. Many checks bind their cookie to the user agent, so use an installed browser (see [Fingerprint](#fingerprint)) when the check must survive the switch.

## Authentication

Three options, from most to least contained:

1. **Auth vault.** The engine keeps credentials in its encrypted local vault. Set a profile up with the engine's instructions, then reference only its name: `agent-fast auth login my-profile`. Passwords never enter the task, command line, or model context.
2. **Dedicated profile.** `--profile <directory>` keeps cookies between sessions after you sign in once in a `--headed` window. Use this for sign-in flows with MFA.
3. **Parameters.** Replay placeholders supplied with `--param-env`.

Always combine credentials with a domain allowlist. Agent-fast does not implement its own credential store and never attaches to your personal Chrome profile.

## Fingerprint

A headless session does not announce itself. Every launch disables the automation flag, so `navigator.webdriver` is false, and a session that drives an installed browser sends that browser's own reduced user agent instead of `HeadlessChrome`. Chrome for Testing keeps its headless user agent because its version is not known before launch. The override leaves `navigator.userAgentData.brands` empty, which a strict check can notice. None of this changes the network boundary or the tool catalog, and there is no fingerprint spoofing, proxy rotation, or CAPTCHA solving.

## Automated testing

Use readiness conditions and explicit assertions in CLI, MCP, autonomous runs, and saved workflows:

```bash
agent-fast wait-for '#ready'
agent-fast snapshot
agent-fast fill @e2 'test input'
agent-fast select '#country' 'JP'
agent-fast press Enter
agent-fast assert-text '#status' 'Saved'
agent-fast console
```

`assert_text` retries reads until the exact text matches and reports a failure on timeout. A failed assertion, a failed replay step, a failed batch, and an unsuccessful autonomous run each save a screenshot of the page as it was, under `--artifacts` (default `~/.agent-fast/artifacts`), and return its path. `console` and `network` show what the page logged and requested.

## Video

Pages with HTML5 video work, including WebM and H.264 MP4. Player controls appear in the snapshot, so playback is observable without page JavaScript:

```bash
agent-fast --act mcp   # then: click {role: "button", name: "play"}, snapshot → slider "video time scrubber": 1.36
```

DRM-protected streams (Widevine) are not available in Chrome for Testing. To record a video of an autonomous run or a replay, add `--record`; the file is written to the artifacts directory and its path is returned.

## Performance design

One-shot engine clients start a process for every action. Agent-fast starts the engine's client once per session to launch and verify the daemon, then sends each later action to the daemon's local socket as one JSON line. The daemon enforces the action policy it was launched with, so the shortcut removes a process, not a check. Windows uses the engine's client for every action.

Model inference dominates an autonomous run; the latency numbers above matter most for MCP clients and replay, where hundreds of actions run without a model call. On the direct path a batch is not faster than separate calls; its value is one request and stop-on-failure.

## Verification

On macOS, the TypeScript build and all 57 automated tests pass with none skipped. Twenty-one of them drive a real browser, covering: browser detection and a headless fingerprint, a failed lookup returning the page as an image, a human check handed to a visible window and kept across the restart, snapshot diffs, cross-origin and nested frames, a maker-portal-shaped page (custom combobox, shadow DOM, rich-text editor), dialogs, hover, drag and drop, uploads with path-escape attempts, downloads, console and network reads, screenshots, video playback, proxy blocking after DNS resolution, policy switching on a live session, workflow recording and replay across renumbered refs, failure screenshots, agent-loop failure modes against a scripted model, navigation scope, and MCP ping, cancellation, and session isolation.

CI runs the suite on Linux, macOS, and Windows with the runner's own Chrome; Windows skips the daemon-signal test and the download assertion. The suite also passes on Brave (`CHROME_PATH` or `--executable-path`). Not run for this release: auth-vault login, and the head-to-head benchmark on the current build.

One engine limit remains: a cross-origin frame nested inside another cross-origin frame is invisible to snapshots and locators. `click_at` and `drag_at` reach it by viewport coordinates from a screenshot, and typing reaches whatever has focus, but its text cannot be read except from the screenshot.

## Limitations

- No browser agent can guarantee complete security or immunity to prompt injection.
- The egress proxy is a strong boundary for the browser's own traffic, not an OS firewall. A browser exploit could bypass it. Use a container or VM with egress rules for hostile content.
- Power Platform changes were made in one tenant and environment through the harness; flows were only read. Tenant policy may block automated browsers.
- There is no CAPTCHA solving, fingerprint spoofing, residential proxy service, or hosted browser fleet. The user-agent override leaves client-hint brands empty.
- Chrome for Testing runs with an English UI (AF-8); use an installed browser or wait for a `--lang` option on sites that store display names per language.
- DRM video does not play in Chrome for Testing.
- On Windows, the `download` tool failed in CI with "Download was canceled" and is unverified there; every other test passes on Windows through the engine's client path.
- Local model quality varies widely; see the eval above. Direct CLI/MCP mode is available when a model cannot follow the tool schema.
- Read-only mode can navigate and read pages, but it cannot complete workflows that need clicks or form entry.
- The direct daemon transport depends on the pinned `agent-browser` version and must be re-verified when that dependency is upgraded.
- Page output and model conversations can contain sensitive data. Close sessions and avoid regulated or personal data unless you have assessed the risk.

## License

Apache-2.0. See [LICENSE](LICENSE). The research behind the engine choice is in [docs/research.md](docs/research.md).
