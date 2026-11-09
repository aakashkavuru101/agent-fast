# Security policy

## Scope and honest guarantee

Agent-fast is designed to reduce the privileges of a browser-using AI agent. No software can promise that a browser agent is fully secure. Model mistakes, prompt injection, malicious pages, browser vulnerabilities, DNS changes, user-approved actions, and host compromise remain possible. Treat every autonomous browser action as potentially consequential.

## Default protections

- Autonomous runs start with a default-deny read-only policy. Model-driven clicks and fills require `--act`.
- CLI and MCP navigation, autonomous open/read/tab tools, and workflow replay reject literal private/loopback IPs and local hostnames by default, including encoded IPv4 and IPv4-mapped IPv6 forms. An exact `--allowed-domains` entry explicitly permits that host; wildcard entries do not override this check.
- Both supplied policies deny eval, downloads, uploads, network mutation, and saved-state mutation.
- The model receives a narrow tool schema, not a shell, arbitrary JavaScript, arbitrary file access, or a raw engine command channel.
- Engine commands use validated argument arrays without shell interpolation; extra or flag-like positional overrides are rejected.
- Native engine calls and JSON batches have bounded input/output and timeouts. Model tool calls are capped at three ordered actions per iteration.
- Timed-out or output-flooding CLI/batch command clients are force-terminated and their pipes closed. MCP uses this same command executor. This does not cancel an action already dispatched to the browser daemon; its completion is unknown. Check the resulting application state before repeating any interaction.
- Page output is capped and wrapped in content boundaries. Older observations are removed from model history.
- Engine calls, model calls, wait actions, task size, and agent steps are bounded.
- The engine environment contains only required process variables. `AGENT_FAST_API_KEY` and unrelated ambient secrets are not forwarded.
- The external browser-version check is disabled to avoid an additional request on the command path.
- The default browser session is separate from personal profiles. Arbitrary CDP attach, remote providers, raw engine flags, and plugins are not exposed by Agent-fast.
- MCP uses stdio. Agent-fast does not start an HTTP, CDP, dashboard, or live-view listener.
- Autonomous runs close their browser by default. Direct sessions close on explicit `close`.

## Threat model

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Prompt injection in page content | Untrusted-data system rules, content boundaries, narrow tools, read-only default, no eval/download/upload | A model can still choose a harmful allowed action. Boundaries are not proof of intent. |
| Data exfiltration or SSRF | Private-host URL checks on CLI/MCP/model/replay navigation; optional domain allowlist covering navigation/subresources; no personal profile by default | The URL check does not resolve DNS or intercept redirects, page requests, auth-vault navigation, or history. Use OS egress rules for a hard boundary. |
| Purchases, submissions, account changes | Autonomous interaction is opt-in; direct interaction is explicit | `--act` allows ordinary clicks/fills and cannot understand every business consequence. Do not use it unattended for consequential actions. |
| Credential exposure | No model API key inheritance; auth-vault profiles avoid passwords in tasks; no raw cookie/storage mutation | Page snapshots and remote model calls can still expose visible data. The engine and vault are separate trusted components. |
| Context flooding | Output caps, compact snapshots, bounded history and steps | Large or adversarial pages can still waste model calls or obscure important content. |
| Malicious repository/configuration | Packaged explicit policies; no project-controlled engine flags or plugins | Users must still protect their home configuration, executable path, and policy files from other local principals. |
| Browser exploit or engine compromise | Separate session, Chrome sandbox left enabled, least-privilege tools | Agent-fast is not an OS sandbox. Keep Chrome and dependencies updated and use containers/VMs for hostile content. |
| Unsafe remote control | No network listener; MCP stdio only | An MCP client or parent agent has the privileges you grant it and may log page content. |

## Domain allowlists

Use exact domains and necessary CDN origins. An allowlist should be present whenever credentials or sensitive data are involved. The native engine rejects unsupported attach/profile modes when filtering is active, but its documentation still describes WebSocket/EventSource controls as best-effort and recommends denying eval. Agent-fast denies eval and removes those attach modes from its interface.

An allowlist is not a replacement for host/container firewall rules, private-address blocking, or cloud-metadata protection. For high-risk workloads, run in a disposable container or VM with explicit egress policy and no access to host credentials.

Agent-fast's private-host check examines normalized URL hostnames only. It does not stop a public hostname resolving to a private address, DNS rebinding, redirects or page-initiated requests into private networks. MCP uses the same wrapper URL checks as the CLI. Full protection requires request-level enforcement in the upstream engine plus external egress controls; Agent-fast does not claim to be secure by default against SSRF.

## MCP and test execution

Agent-fast's stdio MCP server exposes a closed action catalog and validates tool arguments with JSON Schema. Clients cannot override the configured session, allowlist, executable, or policy through tool arguments. Messages are capped at 1 MB and responses at 2 MB. Commands execute serially in one configured session; the browser closes after client disconnect or orderly server shutdown. A hung action can delay shutdown until its configured deadline.

Batch inputs are validated before execution, and the first execution failure stops the batch. Earlier completed actions are not rolled back. Transport failure, timeout, or excessive output may leave the outcome unknown; the runtime does not automatically retry actions. Browser/daemon loss can still destroy page state and authentication. Explicit reopening starts or reconnects the session; it does not restore the prior transaction.

Frame selection, readiness waits, and text assertions are available in both policies. Keyboard and dropdown actions require the interaction policy. Assertions retry only reads, do not invoke a model, and fail explicitly. These capabilities do not enable eval, filesystem access, upload/download, or raw engine commands for an MCP client.

## Structured output and replay

Schemas are local files capped at 100 KB. Structured results are validated locally with Ajv and standard formats before completion; invalid model output is returned for correction rather than silently accepted.

Workflow files are capped at 1 MB and 100 actions, parsed into a closed action schema, and written atomically with owner-only permissions. Filled values are replaced by generated placeholders and are never stored in the workflow file. Replay parameters are required at run time and unused or missing parameters fail closed.

Use `--param-env NAME` to read replay parameter `NAME` from the same-named environment variable, populated through a secret manager or hidden terminal prompt. Missing variables and duplicate/unused parameters fail closed. Replay does not add parameter variables to the engine's environment allowlist; filled values go to the engine through stdin batch input. Environment variables remain visible to sufficiently privileged local processes. Command-line `--param key=value` remains available for non-sensitive values and can be visible in shell history and process listings. Replay traces and page output can also contain sensitive values; placeholder substitution is not a secret-management boundary.

## Sensitive and regulated data

Do not use Agent-fast on regulated, financial, medical, or other sensitive pages unless you have reviewed the complete data path, model provider, browser profile, logs, and consequences. A local model avoids a third-party inference provider but does not make visible page content safe. Remote models receive page content.

Direct command output is written to stdout; Agent-fast does not add an analytics service. Your terminal, MCP client, model provider, operating system, and engine may have independent logs or state. Close sessions with `agent-fast close` and use `--keep-open` only when persistent state is intentional.

## Updates and reporting

Keep Node.js, Chrome for Testing, `agent-browser`, and Agent-fast dependencies updated. Review dependency advisories and the upstream security documentation.

Report vulnerabilities privately to the project maintainer rather than in a public issue. Include the affected version, platform, policy, reproduction steps, impact, and whether credentials or private network access were involved.
