# Security policy

## Scope and honest guarantee

Agent-fast is designed to reduce the privileges of a browser-using AI agent. No software can promise that a browser agent is fully secure. Model mistakes, prompt injection, malicious pages, browser vulnerabilities, user-approved actions, and host compromise remain possible. Treat every autonomous browser action as potentially consequential.

## Default protections

- **Network boundary.** Each session's browser is launched with a local egress proxy as its only route out, including for loopback. For every request the proxy checks the host against the allowlist, resolves it, refuses private, loopback, link-local, carrier-grade NAT, multicast, NAT64, 6to4, and Teredo addresses, and then connects to the address it checked. Navigation, redirects, subresources, iframes, WebSockets, and auth-vault navigation are all covered. Non-proxied WebRTC UDP is disabled.
- **Private hosts are opt-in.** An exact `--allowed-domains` entry such as `127.0.0.1` permits that private host. Wildcard entries never do.
- **Early URL errors.** CLI, MCP, autonomous tools, and replay reject private hosts and hosts outside the allowlist before navigating. This check is for readable errors; the proxy is the enforcement.
- **Read-only by default.** Autonomous runs, replay, and MCP start with a default-deny read-only policy. Interaction requires `--act`.
- **Navigation scope for the model.** Without an allowlist, an autonomous run may only navigate to the sites named in the task. `--open-web` removes that limit.
- **No code or state access.** Both policies deny JavaScript eval, network interception, cookies, web storage, saved state, and clipboard access. The model receives a narrow tool schema, not a shell, arbitrary JavaScript, arbitrary file access, or a raw engine command channel.
- **Confined files.** Screenshots and recordings are written to generated paths in the artifacts directory. Uploads are refused unless `--upload-dir` is set, and then only regular files that resolve inside it (symbolic links are followed first). The `download` tool is refused unless `--download-dir` is set, and saves there under generated names. A download that a page starts when an element is clicked is saved in that directory, or in `~/.agent-fast/downloads` when none is set, never in the user's own Downloads folder.
- **No argument injection.** After a session's first command, actions are sent to the engine daemon as JSON over its local socket. Before that, and on Windows, commands go to the engine's client as a JSON batch on stdin, where session, policy, and launch options cannot be set. Typed text is passed literally on both paths, and selectors that begin with a hyphen are rejected.
- **Bounded execution.** Engine calls, model calls, waits, task size, output size, and agent steps are bounded. Timed-out or output-flooding engine clients are force-terminated. This does not cancel an action already dispatched to the browser; its completion is unknown. Check the resulting application state before repeating any interaction.
- **Cover checks.** The engine refuses to click an element that something else covers. Inside a frame, the engine also reports covers where none is visible (seen in Power Apps Studio). There, Agent-fast clicks the element's on-screen position instead, so whatever is topmost at that point receives the click, as it would for a person; the result says so. Outside frames the refusal stands.
- **Clean environment.** The engine receives only required process variables. `AGENT_FAST_API_KEY` and unrelated ambient secrets are not forwarded. The engine's external browser-version check is disabled.
- **Separate browser.** The default session is separate from personal profiles. `--profile` always names a dedicated directory. Arbitrary CDP attach, remote providers, raw engine flags, and plugins are not exposed.
- **No listeners beyond loopback.** MCP uses stdio. The proxy binds to `127.0.0.1` and reaches only what the session's rules allow. Agent-fast does not start an HTTP control API, dashboard, or live-view listener.

## Threat model

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Prompt injection in page content | Untrusted-data system rules, narrow tools, read-only default, navigation scope, no eval | A model can still choose a harmful allowed action. In `--act` mode it can click links and submit forms on the pages it is allowed to reach. |
| Data exfiltration | Navigation scope for the model; allowlist enforced on every request by the proxy; no personal profile | Without an allowlist, a page's own scripts can send what the page contains to any public host, as in any browser. An allowed site can itself be the destination. |
| SSRF and private-network access | Proxy checks the resolved address and connects to it, defeating DNS rebinding and encoded or embedded addresses | A host you explicitly allow is trusted. The proxy governs the browser's traffic only. |
| Purchases, submissions, account changes | Autonomous interaction is opt-in; direct interaction is explicit | `--act` allows ordinary interaction and cannot understand every business consequence. Do not use it unattended for consequential actions. |
| Credential exposure | No model API key inheritance; auth-vault profiles keep passwords out of tasks; no cookie or storage access; typed values redacted from run and replay traces and from workflow files | Page snapshots, screenshots, recordings, and remote model calls can expose visible data. A `--profile` directory holds live session cookies; protect it like a credential. |
| Context flooding | Output caps with visible truncation markers, compact snapshots, bounded history and steps | Large or adversarial pages can still waste model calls or obscure important content. |
| Malicious repository/configuration | Packaged explicit policies; no project-controlled engine flags or plugins | Users must still protect their home directory, executable path, and policy files from other local principals. |
| Other local processes | State files are owner-only; the daemon socket and proxy are local | A process running as the same user can drive the engine daemon or use the proxy. Agent-fast does not defend against the local user. |
| Browser exploit or engine compromise | Separate session, Chrome sandbox left enabled, least-privilege tools | Agent-fast is not an OS sandbox. A compromised browser can ignore the proxy. Keep Chrome and dependencies updated and use containers/VMs for hostile content. |
| Unsafe remote control | No network listener; MCP stdio only | An MCP client or parent agent has the privileges you grant it and may log page content. |

## Domain allowlists

`*.example.com` covers `example.com` and all of its subdomains; a plain entry covers that exact host. Use an allowlist whenever credentials or sensitive data are involved, and include the CDN hosts the application needs. `agent-fast blocked` lists what the proxy refused in the current session.

A session keeps the allowlist it was started with. A command that names a different allowlist for a running session is refused; close the session first.

`--allow-preset microsoft` adds the Microsoft-operated domains used by Power Platform, Microsoft 365, Azure sign-in, and their static assets. It is broad by design and includes domains that host tenant content, such as `*.sharepoint.com` and `*.azureedge.net`. Prefer an explicit list when you need a tighter boundary.

The proxy is not a replacement for host or container firewall rules. It governs the browser launched by Agent-fast and nothing else. For high-risk workloads, run in a disposable container or VM with explicit egress policy and no access to host credentials.

## Direct daemon transport

The engine's command client forwards one JSON message to a per-session daemon. Agent-fast sends that message itself once a session is verified, which removes a process spawn per action. The safeguards:

- The daemon enforces the action policy it was launched with, so a denied action is denied on either path.
- The direct path is used only after a command has succeeded through the engine's own client with the same session, policy, allowlist, executable, headed mode, and profile, and only while that same daemon process is running. Any failure returns the session to the client path.
- Only the fixed message shapes Agent-fast itself produces are sent; anything else uses the client.
- The message shapes are specific to the pinned `agent-browser` version. Re-verify them before upgrading that dependency.

## MCP and test execution

Agent-fast's stdio MCP server exposes a closed action catalog and validates tool arguments with JSON Schema. Clients cannot override the configured session, allowlist, executable, or policy through tool arguments. Messages are capped at 1 MB and responses at 2 MB. Browser actions execute serially in one configured session; protocol requests are answered without waiting for them. Each server uses its own session unless one is named, and closes its browser when the client disconnects unless `--keep-open` is set.

Batch inputs are validated before execution, and the first execution failure stops the batch. Earlier completed actions are not rolled back. Cancellation, transport failure, timeout, or excessive output may leave the outcome unknown; the runtime does not automatically retry actions. Browser/daemon loss can still destroy page state and authentication.

Failure screenshots and recordings can contain whatever the page showed, including personal data. They are written to an owner-only directory and are never uploaded. Delete them when they are no longer needed.

## Structured output and replay

Schemas are local files capped at 100 KB. Structured results are validated locally with Ajv and standard formats before completion; invalid model output is returned for correction rather than silently accepted.

Workflow files are capped at 1 MB and 100 actions, parsed into a closed action schema, and written atomically with owner-only permissions. Typed values are replaced by generated placeholders and are never stored in the workflow file. Replay parameters are required at run time and unused or missing parameters fail closed.

Use `--param-env NAME` to read replay parameter `NAME` from the same-named environment variable, populated through a secret manager or hidden terminal prompt. Environment variables remain visible to sufficiently privileged local processes. Command-line `--param key=value` remains available for non-sensitive values and can be visible in shell history and process listings. Replay traces and page output can also contain sensitive values; placeholder substitution is not a secret-management boundary.

## Sensitive and regulated data

Do not use Agent-fast on regulated, financial, medical, or other sensitive pages unless you have reviewed the complete data path, model provider, browser profile, logs, artifacts, and consequences. A local model avoids a third-party inference provider but does not make visible page content safe. Remote models receive page content.

Direct command output is written to stdout; Agent-fast does not add an analytics service. Your terminal, MCP client, model provider, operating system, and engine may have independent logs or state. Close sessions with `agent-fast close` and use `--keep-open` only when persistent state is intentional.

## Updates and reporting

Keep Node.js, Chrome for Testing, `agent-browser`, and Agent-fast dependencies updated. Review dependency advisories and the upstream security documentation.

Report vulnerabilities privately to the project maintainer rather than in a public issue. Include the affected version, platform, policy, reproduction steps, impact, and whether credentials or private network access were involved.
