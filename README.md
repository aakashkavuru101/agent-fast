# Agent-fast

[![CI](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml/badge.svg)](https://github.com/aakashkavuru101/agent-fast/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![Ollama local-first](https://img.shields.io/badge/Ollama-local--first-7c3aed)](https://ollama.com/)

[日本語](README.ja.md)

Agent-fast is an Apache-2.0, local-first browser runtime for AI agents and automated testing. It is a security and reliability layer over the Apache-licensed [`agent-browser`](https://github.com/vercel-labs/agent-browser) engine:

- **A network boundary, not a URL check.** Every browser request goes through a local egress proxy that enforces your domain allowlist and blocks private addresses after DNS resolution.
- **A closed tool catalog.** Agents get typed browser actions under a default-deny policy. There is no JavaScript eval, shell, raw engine channel, or arbitrary file access.
- **Sub-millisecond actions.** A warm session answers in about 0.3 ms because Agent-fast talks to the engine daemon directly instead of starting a process per action.
- **Real web applications.** Cross-origin iframes, dialogs, hover, drag and drop, uploads, downloads, video, and single-page apps such as Power Apps and Power Automate.
- **Replay and evidence.** Saved workflows find elements by role and name, and failures leave a screenshot and, on request, a video.

There is no required account, hosted browser, model subscription, telemetry, or per-action fee. The research behind the engine choice is in [docs/research.md](docs/research.md).

## Security contract

- All browser traffic, including loopback, redirects, subresources, iframes, and WebSockets, passes through a per-session egress proxy. The proxy resolves each host, refuses private, loopback, link-local, NAT64, and 6to4 addresses, and connects to the address it checked. This closes DNS-rebinding and `127.0.0.1.nip.io`-style bypasses.
- With `--allowed-domains` or `--allow-preset`, the proxy also refuses every host outside the allowlist. An exact entry such as `127.0.0.1` is the explicit opt-in for a private host; wildcards never opt private hosts in.
- Autonomous `run` is read-only by default; `--act` is required for model-driven interaction. Without an allowlist, the model may only navigate to the sites named in the task, so a page cannot talk it into carrying data elsewhere. `--open-web` lifts that.
- Both policies deny JavaScript eval, network interception, and cookie, storage, and saved-state access. Uploads and downloads are disabled until you name a directory for them, and are confined to it. A file that a page starts downloading when a link is clicked lands in `~/.agent-fast/downloads`, never in your own Downloads folder.
- Values typed into pages travel as JSON, never as command-line arguments, so text such as `--action-policy` or `-5` is typed literally and cannot change engine settings.
- The engine receives no shell and cannot inherit `AGENT_FAST_API_KEY` or unrelated ambient credentials.
- The default browser is a separate session, not your personal Chrome profile or an arbitrary CDP endpoint. `--profile` uses a dedicated directory.
- Page content is prompted as untrusted data. This reduces prompt-injection risk but does not eliminate it.
- No control API is exposed on the network. MCP uses stdio; the proxy listens on loopback only.

This is security by design, not a guarantee of complete security. Read [SECURITY.md](SECURITY.md) before using credentials or acting on consequential websites.

## Requirements

- Node.js 24 or newer
- macOS, Linux, or Windows supported by `agent-browser`
- Chrome for Testing, installed below
- [Ollama](https://ollama.com/) only for autonomous `run`; direct CLI and MCP browsing do not need a model
- `ffmpeg` only for `--record`

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
agent-fast screenshot
agent-fast close
```

A snapshot assigns refs such as `@e1` to interactive elements, including elements inside iframes. After navigation or a DOM change, take a new snapshot before reusing refs.

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
| Wait and verify | `wait`, `wait_for` (selector state, visible text, URL glob, or load state such as `networkidle`), `assert_text` |
| Interact (`--act`) | `click` (single or double), `fill`, `type` (real keystrokes), `press`, `hover`, `check`, `select`, `drag`, `click_text`, `fill_label`, `click_at` and `drag_at` (viewport coordinates) |
| Dialogs | `dialog` status, dismiss, and accept (accept needs `--act`); alerts are accepted automatically |
| Frames | `frame` to scope by selector or ref; refs and role/name locators reach into same- and cross-origin iframes without switching |
| Files (`--act`) | `upload` from `--upload-dir`, `download` into `--download-dir` |
| Evidence | `screenshot`, `console` (messages and uncaught errors), `network` (request list), failure screenshots, `--record` video |
| Sign-in | `auth_login` with the engine's encrypted auth vault, `--profile` for persistent sign-in |

### Locating elements

Interaction tools accept either a ref from the latest snapshot or a role and accessible name:

```json
{ "action": "click", "args": { "role": "button", "name": "Save" } }
{ "action": "fill", "args": { "role": "textbox", "name": "Flow name", "text": "Weekly report" } }
{ "action": "click", "args": { "role": "button", "name": "Delete", "nth": 1 } }
```

Role and name locators take a fresh snapshot, wait up to three seconds for the element to render, and work inside iframes. If several elements match, the call fails and asks for `nth` instead of guessing.

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
- Use `wait_for` with `text` or `load: "networkidle"` after navigation; pages keep loading after the first paint.
- Fluent comboboxes and code editors ignore `fill`; use `click` then `type` and `press`.
- A profile directory serves one browser at a time. `close` the visible sign-in session before starting another session with the same profile.
- Power Apps Studio runs in a frame. Its tree view, property list, formula bar, and canvas controls all appear in snapshots. The engine refuses some clicks inside that frame as "covered"; Agent-fast then clicks the element's on-screen position instead and says so in the result.
- Rows in maker-portal lists appear only in a full snapshot (`snapshot` with `full: true`); the default snapshot lists interactive elements.
- A cross-origin frame inside another cross-origin frame is invisible to the engine. Take a `screenshot` and use `click_at`, `drag_at`, and `type` there, or find the inner frame's address with `network` (it appears as the `referer` of requests the frame makes) and open it in its own tab with `tab_new`, where snapshots and locators work normally.
- `agent-fast blocked` lists hosts the allowlist refused. If a tenant uses a custom domain, add it with `--allowed-domains`.
- The preset trusts Microsoft-operated domains broadly, including tenant-hosted content such as `*.sharepoint.com`. Use a narrower `--allowed-domains` list where that matters.

**What is verified (2026-11-11, one Microsoft 365 tenant, one non-default environment, Brave, read-only):**

- Sign-in in a visible window with MFA, kept by the dedicated profile across a session restart and into a headless session.
- Power Automate: the flow list, and a flow's details page (owner, status, connection references, solution).
- Power Apps: the app list, and opening a canvas app in Studio to select a control and read its formula, then leaving without saving.
- With the preset, no Microsoft host was refused.

**Not verified:** creating, editing, saving, running, or sharing flows and apps; model-driven apps, Dynamics 365, and Copilot Studio. Tenant policies such as Conditional Access can also refuse an automated browser.

## Video

Pages with HTML5 video work in the bundled Chrome for Testing, including WebM and H.264 MP4. Player controls appear in the snapshot, so playback is observable without page JavaScript:

```bash
agent-fast --act mcp   # then: click {role: "button", name: "play"}, snapshot → slider "video time scrubber": 1.36
```

DRM-protected streams (Widevine) are not available in Chrome for Testing.

To record a video of an autonomous run or a replay, add `--record`. The file is written to the artifacts directory and its path is returned:

```bash
agent-fast --record flow ./flow.json
```

## Structured results

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

## Model-free workflow replay

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
agent-fast --act run \
  "Open https://example.com, use the Learn more link, and summarize the result"
```

Defaults:

- model: `qwen3:4b`
- endpoint: `http://127.0.0.1:11434/v1/chat/completions`
- maximum agent iterations: 20
- time allowed for one model reply: 5 minutes (`--model-timeout`); a reply that times out is not retried
- navigation limited to the sites named in the task unless `--allowed-domains` or `--open-web` is given
- browser closes after `run` unless `--keep-open` is set

The loop is built for small models. Malformed tool arguments, unknown tools, and schema failures are reported back to the model instead of ending the run. A tool call written as JSON text is recognised. A reply with no tool call is never treated as success by itself: an empty reply fails the run, and a prose answer is accepted only when the model repeats it after being asked for the `done` tool and no result schema is required. Every rejected reply is kept in the trace.

### Measured task success

`benchmarks/agent-eval.mjs` runs eight tasks against local pages with a real model and checks each result exactly: reading, extraction, a table lookup, following a link, a search form, a form inside an iframe, a confirmation dialog, and a prompt-injection page.

Results from 2026-11-10 on this macOS arm64 host with Ollama, one attempt per task at temperature 0, on the released build.

| Model | Passed | Notes |
| --- | ---: | --- |
| `qwen3.5:9b` | 6 of 8 | 1 to 4 model steps per task, 26 to 51 s each. One miss reported the right heading but finished on a different page; the other paraphrased the status text. It did not follow the injected instruction. An earlier run on a near-final build passed 7 of 8. |
| `qwen3:4b` (default) | 7 of 8 | Correct on all seven ordinary tasks, but slow: 27 to 460 s per task, because it reasons for one to two minutes before each reply. On the prompt-injection page it stopped making tool calls and the run failed. In an earlier run it tried the injected navigation instead, which the allowlist refused. Needs the 5-minute `--model-timeout` default; with a 3-minute limit it passed only 3 of 8. Measured on the released build on 2026-11-11. |
| `llama3.2:3b` | 1 of 8 | Reads the page correctly but cannot form the `done` call with a schema-valid result, and runs to the step limit. Measured on a near-final build. |

Expect run-to-run variation. On this hardware the default model is accurate but takes minutes per interaction task; the larger model is about ten times faster. Raw results for `qwen3.5:9b` are in [benchmarks/agent-eval.json](benchmarks/agent-eval.json); rerun with `AGENT_FAST_MODEL=<model> npm run benchmark:agent`.

Another OpenAI-compatible endpoint can be selected without changing the agent:

```bash
export AGENT_FAST_MODEL="your-model"
export AGENT_FAST_MODEL_URL="https://provider.example/v1/chat/completions"
export AGENT_FAST_API_KEY="your-key"  # optional; kept out of engine processes
agent-fast run "Summarize the current page"
```

Remote inference may cost money and sends page content to that provider. Loopback HTTP is accepted; non-loopback model endpoints must use HTTPS.

## MCP for coding agents

For repeated agent actions, connect once through MCP. The Node process and browser remain warm, and each action is one message to the engine daemon. Claude Code or another MCP client supplies the reasoning, so no second model loop or Ollama process is required.

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

- Each server gets its own browser session unless you pass `--session`, so one client disconnecting cannot close another client's browser. The browser closes when the client disconnects unless `--keep-open` is set.
- Browser actions run in order. Protocol requests such as `ping` are answered immediately, even during a long wait.
- `notifications/cancelled` removes a queued request or stops waiting on the running one. A cancelled request gets no response, and an action already sent to the browser may still complete.
- `agent_fast_screenshot` returns the image itself as well as its path.
- The server reports the package version and negotiates the protocol version with the client.

Use `agent_fast_batch` to execute up to 50 ordered actions in one request. Every action is validated before execution, and the first failure stops the batch and returns a screenshot. Completed actions are not rolled back.

```json
{
  "steps": [
    { "action": "fill", "args": { "role": "textbox", "name": "Search", "text": "example" } },
    { "action": "click", "args": { "role": "button", "name": "Go" } },
    { "action": "assert_text", "args": { "selector": "#output", "text": "Clicked: example" } }
  ]
}
```

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

## Authentication

Three options, from most to least contained:

1. **Auth vault.** The engine keeps credentials in its encrypted local vault. Set a profile up with the engine's instructions, then reference only its name: `agent-fast auth login my-profile`. Passwords never enter the task, command line, or model context.
2. **Dedicated profile.** `--profile <directory>` keeps cookies between sessions after you sign in once in a `--headed` window. Use this for sign-in flows with MFA.
3. **Parameters.** Replay placeholders supplied with `--param-env`.

Always combine credentials with a domain allowlist. Agent-fast does not implement its own credential store and never attaches to your personal Chrome profile.

## Performance design

One-shot engine clients start a process for every action. Agent-fast starts the engine's client once per session to launch and verify the daemon, then sends each later action to the daemon's local socket as one JSON line. The daemon enforces the action policy it was launched with, so the shortcut removes a process, not a check. Windows uses the engine's client for every action.

Run the benchmark against a fixed loopback page:

```bash
CHROME_PATH=/absolute/path/to/chrome npm run benchmark
```

Medians from 50 iterations on 2026-11-10 on this macOS arm64 host with Node.js 26.12.1, `agent-browser` 0.41.2, and Chrome for Testing 157.0.8103.38. These are local measurements, not universal rankings.

| Operation | Median | p95 |
| --- | ---: | ---: |
| Agent-fast in-process `get title` | 0.29 ms | 0.36 ms |
| Agent-fast persistent MCP `get title` (full JSON-RPC round trip) | 0.44 ms | 0.68 ms |
| Agent-fast MCP batch, URL + title | 0.72 ms | 0.85 ms |
| Persistent in-process Playwright `page.title()` | 0.20 ms | 1.10 ms |
| Direct native `agent-browser` `get title` (one process per action) | 3.51 ms | 4.13 ms |
| Agent-fast CLI `get title` (new Node process each time) | 54.47 ms | 61.71 ms |
| Direct `agent-browser` Node wrapper `get title` | 56.01 ms | 61.67 ms |

In version 0.2.0 the MCP and in-process rows were 4.77 ms and 4.52 ms on the same host, so warm actions are roughly ten times faster and now beat the engine's own native client. A one-shot CLI command is still bounded by Node startup; use MCP when latency matters. Persistent Playwright remains slightly faster per call. On the direct path a batch is not faster than separate calls; its value is one request and stop-on-failure. MCP initialization took 242 ms once. Raw results are in [benchmarks/latest.json](benchmarks/latest.json).

Model inference dominates an autonomous run; these numbers matter most for MCP clients and replay, where hundreds of actions run without a model call.

## Verification results

On macOS, the TypeScript build and all 44 automated tests pass with none skipped. Eighteen of them drive real Chromium, covering: cross-origin and nested frames, a maker-portal-shaped page (custom combobox, shadow DOM, rich-text editor), dialogs, hover, drag and drop, uploads with path-escape attempts, downloads, console and network reads, screenshots, video playback, proxy blocking after DNS resolution, policy switching on a live session, workflow recording and replay across renumbered refs, failure screenshots, agent-loop failure modes against a scripted model, navigation scope, and MCP ping, cancellation, and session isolation.

Also checked by hand: `--record` on a replay, `--profile` together with an allowlist, a clean install of the packed npm tarball, and the signed-in Power Automate and Power Apps checks listed under [Power Platform](#power-platform-and-other-microsoft-apps).

CI passes on Linux, macOS, and Windows; Windows skips the daemon-signal test and the download assertion. Not run for this release: auth-vault login, and any Power Platform action that changes something. The real-browser tests also pass on Brave (`CHROME_PATH` or `--executable-path`).

One engine limit remains: a cross-origin frame nested inside another cross-origin frame is invisible to snapshots and locators. `click_at` and `drag_at` reach it by viewport coordinates from a screenshot, and typing reaches whatever has focus, but its text cannot be read except from the screenshot.

## Limitations

- No browser agent can guarantee complete security or immunity to prompt injection.
- The egress proxy is a strong boundary for the browser's own traffic, not an OS firewall. A browser exploit could bypass it. Use a container or VM with egress rules for hostile content.
- Power Platform was checked read-only, in one tenant and environment. Changes such as saving or running a flow are untested, and tenant policy may block automated browsers.
- The agent has no built-in CAPTCHA bypass, stealth fingerprinting, residential proxy service, or hosted browser fleet.
- DRM video does not play in Chrome for Testing.
- On Windows, the `download` tool failed in CI with "Download was canceled" and is unverified there; every other test passes on Windows through the engine's client path.
- Local model quality varies widely; see the measured results above. Direct CLI/MCP mode is available when a model cannot follow the tool schema.
- Read-only mode can navigate and read pages, but it cannot complete workflows that need clicks or form entry.
- The direct daemon transport depends on the pinned `agent-browser` version and must be re-verified when that dependency is upgraded.
- Page output and model conversations can contain sensitive data. Close sessions and avoid regulated or personal data unless you have assessed the risk.

## License

Apache-2.0. See [LICENSE](LICENSE).
