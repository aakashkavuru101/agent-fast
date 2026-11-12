# Agent-fast guide

The full reference behind the [README](../README.md): every command, the tool catalog, locators, structured results, testing, video, fingerprint, performance design, and what the test suite covers.

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
| Fallbacks | A failed lookup by an interaction tool returns a screenshot for `click_at` and `drag_at`; `handoff` lets a person solve a human check in a visible window |

### Locating elements

Interaction tools accept either a ref from the latest snapshot or a role and accessible name:

```json
{ "action": "click", "args": { "role": "button", "name": "Save" } }
{ "action": "fill", "args": { "role": "textbox", "name": "Flow name", "text": "Weekly report" } }
{ "action": "click", "args": { "role": "button", "name": "Delete", "nth": 1 } }
```

Role and name locators take a fresh snapshot, wait up to three seconds for the element to render, and work inside iframes. If several elements match, the call fails and asks for `nth` instead of guessing.

## MCP sessions and batches

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

Invalid results are returned to the model for correction. The final response also contains independently observed URL and title evidence.

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

On macOS, the TypeScript build and all 56 automated tests pass with none skipped. Twenty-one of them drive a real browser, covering: browser detection and a headless fingerprint, a failed lookup returning the page as an image, a human check handed to a visible window and kept across the restart, snapshot diffs, cross-origin and nested frames, an enterprise-app-shaped page (custom combobox, shadow DOM, rich-text editor), dialogs, hover, drag and drop, uploads with path-escape attempts, downloads, console and network reads, screenshots, video playback, proxy blocking after DNS resolution, policy switching on a live session, workflow recording and replay across renumbered refs, failure screenshots, agent-loop failure modes against a scripted model, navigation scope, and MCP ping, cancellation, and session isolation.

CI runs the suite on Linux, macOS, and Windows with the runner's own Chrome; Windows skips the daemon-signal test and the download assertion. The suite also passes on Brave (`CHROME_PATH` or `--executable-path`). Not run for this release: auth-vault login.

One engine limit remains: a cross-origin frame nested inside another cross-origin frame is invisible to snapshots and locators. `click_at` and `drag_at` reach it by viewport coordinates from a screenshot, and typing reaches whatever has focus, but its text cannot be read except from the screenshot.

