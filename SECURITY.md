# Security policy

## Scope and honest guarantee

Agent-fast is designed to reduce the privileges of a browser-using AI agent. No software can promise that a browser agent is fully secure. Model mistakes, prompt injection, malicious pages, browser vulnerabilities, DNS changes, user-approved actions, and host compromise remain possible. Treat every autonomous browser action as potentially consequential.

## Default protections

- Autonomous runs start with a default-deny read-only policy. Model-driven clicks and fills require `--act`.
- Both supplied policies deny eval, downloads, uploads, network mutation, and saved-state mutation.
- The model receives a narrow tool schema, not a shell, arbitrary JavaScript, arbitrary file access, or a raw engine command channel.
- Engine commands use validated argument arrays without shell interpolation; extra or flag-like positional overrides are rejected.
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
| Data exfiltration or SSRF | Optional domain allowlist covering navigation/subresources, no personal profile by default, no arbitrary model fetch tool | Allowed origins can be malicious or redirect; DNS and browser/network behavior remain relevant. Use OS egress rules for a hard boundary. |
| Purchases, submissions, account changes | Autonomous interaction is opt-in; direct interaction is explicit | `--act` allows ordinary clicks/fills and cannot understand every business consequence. Do not use it unattended for consequential actions. |
| Credential exposure | No model API key inheritance; auth-vault profiles avoid passwords in tasks; no raw cookie/storage mutation | Page snapshots and remote model calls can still expose visible data. The engine and vault are separate trusted components. |
| Context flooding | Output caps, compact snapshots, bounded history and steps | Large or adversarial pages can still waste model calls or obscure important content. |
| Malicious repository/configuration | Packaged explicit policies; no project-controlled engine flags or plugins | Users must still protect their home configuration, executable path, and policy files from other local principals. |
| Browser exploit or engine compromise | Separate session, Chrome sandbox left enabled, least-privilege tools | Agent-fast is not an OS sandbox. Keep Chrome and dependencies updated and use containers/VMs for hostile content. |
| Unsafe remote control | No network listener; MCP stdio only | An MCP client or parent agent has the privileges you grant it and may log page content. |

## Domain allowlists

Use exact domains and necessary CDN origins. An allowlist should be present whenever credentials or sensitive data are involved. The native engine rejects unsupported attach/profile modes when filtering is active, but its documentation still describes WebSocket/EventSource controls as best-effort and recommends denying eval. Agent-fast denies eval and removes those attach modes from its interface.

An allowlist is not a replacement for host/container firewall rules, private-address blocking, or cloud-metadata protection. For high-risk workloads, run in a disposable container or VM with explicit egress policy and no access to host credentials.

## Sensitive and regulated data

Do not use Agent-fast on regulated, financial, medical, or other sensitive pages unless you have reviewed the complete data path, model provider, browser profile, logs, and consequences. A local model avoids a third-party inference provider but does not make visible page content safe. Remote models receive page content.

Direct command output is written to stdout; Agent-fast does not add an analytics service. Your terminal, MCP client, model provider, operating system, and engine may have independent logs or state. Close sessions with `agent-fast close` and use `--keep-open` only when persistent state is intentional.

## Updates and reporting

Keep Node.js, Chrome for Testing, `agent-browser`, and Agent-fast dependencies updated. Review dependency advisories and the upstream security documentation.

Report vulnerabilities privately to the project maintainer rather than in a public issue. Include the affected version, platform, policy, reproduction steps, impact, and whether credentials or private network access were involved.
