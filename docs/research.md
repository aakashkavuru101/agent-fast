# Browser-agent research

## Method and evidence boundaries

This review combines public product documentation, license files, code from official repositories, and controlled REA browser captures of all nine supplied sites. Repository commits are recorded below so later changes are not silently mixed into these conclusions.

Each REA capture launched a new headless Chromium 158 profile, loaded only the supplied public page, waited 2.5 seconds, and collected accessibility, DOM, console, page-error, and network metadata. No credentials, clicks, forms, or state-changing actions were used. REA reported owned-browser cleanup. Captures for agent-browser, Browser Use, Browserless, and Steel ended with some network requests unfinished; later activity is unknown. Event order is provider receipt order, not proof of causality. Request and response bodies were not selected.

Vendor performance and compliance statements are identified as claims, not independent measurements. Public landing pages do not reveal proprietary hosted internals. The research did not create accounts, run paid services, execute authenticated workflows, or reproduce vendor benchmarks.

## Comparison

| Product | Primary layer | Open terms and free local use | Main security observations | Performance evidence |
| --- | --- | --- | --- | --- |
| Playwright | Cross-browser automation library, test runner, CLI, MCP | Apache-2.0; free locally | Fresh contexts support test isolation; agent/network policy remains the integrator's responsibility | Mature auto-waiting and persistent automation primitives; no benchmark reproduced |
| agent-browser | Native Rust CLI and persistent CDP daemon | Apache-2.0; free locally | Policies, domain filtering, content boundaries, output caps, auth vault; upstream restrictions are opt-in | Vendor reports compact refs and low per-command overhead; architecture supports warm commands |
| Browser Use | Python autonomous agent and browser library plus cloud | MIT; local browser and Ollama supported | Domain controls, sensitive-data redaction/warnings, custom-tool restrictions; anonymous telemetry is opt-out | Cloud/agent benchmark claims not reproduced |
| Claude in Chrome | Proprietary browser extension and Cowork integration | Paid plans; not open source | Site/action permissions, safety classifiers, protected/prohibited actions, explicit screenshot privacy risks | No independent performance data; internal attack-resistance claim is vendor-scoped |
| Browserbase | Hosted browser, search, fetch, agents, runtime, model gateway | Proprietary hosted service; limited free tier; Stagehand is separate MIT code | Vendor documents VM-per-browser, isolated subnets, no VM reuse, no GPU, retention controls | Hosted internals and latency claims unobserved |
| Kernel | Open browser images/server plus hosted unikernel infrastructure | Apache-2.0 images; self-hostable; hosted usage billed | Container/unikernel isolation; public live-view URL warning is explicit | Vendor reports fast restore/action rates; not reproduced |
| Stagehand | Browser-adjacent extension and TS/Python/Go SDK | MIT; local CLI needs no key; model/hosting costs depend on use | Declarative Net Request domain policy, scoped AI primitives, security reporting policy | Vendor claims 2x speed and 80% token improvement; methodology not independently verified |
| Browserless | Docker browser service, CDP/Playwright/Puppeteer, queues and APIs | SSPL-1.0 or commercial license, not permissive Apache/MIT terms | Token is configurable; private-network blocking is opt-in in source; self-host exposure must be controlled | Production/uptime/case-study figures are vendor claims |
| Steel | Apache browser API/UI and managed cloud | Apache-2.0; free self-hosted core | Self-hosted API and CDP have no built-in authentication; loopback binding and external auth are required | Vendor reports sub-second session starts; not reproduced |

## Playwright

**Observed and source facts.** Playwright provides one automation API for Chromium, Firefox, and WebKit, with Node.js, Python, .NET, and Java distributions. Its differentiators are actionable-element auto-waiting, role/label locators, isolated browser contexts, parallel testing, and detailed traces. The current product surface also includes an agent CLI and MCP server using structured accessibility snapshots and refs. The license is Apache-2.0.

**Design lesson.** Use proven browser lifecycle and locator ideas rather than inventing another protocol. Accessibility refs are cheaper and less ambiguous than screenshot-only control, while traces are essential for debugging. A browser context is useful state isolation, but it is not a complete host, prompt-injection, or network-security boundary.

Sources: [site](https://playwright.dev/), [repository](https://github.com/microsoft/playwright), [license](https://raw.githubusercontent.com/microsoft/playwright/main/LICENSE). Repository commit: `84e2bdcaa5a6e4a9e8afcbe8b1bca4ff8a8cb69a`. REA Evidence: `ev_f78a2616441fbc9253ca1780414092c5de77d6e22fb7c7e55dfe8f7264a23a31`.

## agent-browser

**Observed and source facts.** A native Rust CLI communicates with a persistent per-session daemon over a local socket; the daemon drives Chrome through CDP. Compact accessibility snapshots produce refs such as `@e1`. The command surface covers navigation, forms, tabs, frames, screenshots, network, storage, recording, debugging, MCP, and workflows. Chrome for Testing is the default; other engines and remote providers exist.

The source contains fail-closed action-policy loading, durable session security settings, document-aware ref invalidation, domain filtering, output limits, content boundaries, confirmation gates, and an encrypted auth vault. Upstream documentation is explicit that navigation/action/output restrictions are opt-in and that browser filtering is not an operating-system firewall. The license is Apache-2.0.

**Design lesson.** This is the strongest base for the requested fast, free engine: native persistent control avoids browser startup per command and avoids a JavaScript automation client on the hot path. Agent-fast therefore wraps this engine but changes the default contract to restrictive policies, strips ambient credentials, disables the external browser-version check, and adds a bounded local-model loop.

Sources: [site](https://agent-browser.dev/), [repository](https://github.com/vercel-labs/agent-browser), [security guide](https://agent-browser.dev/security), [license](https://raw.githubusercontent.com/vercel-labs/agent-browser/main/LICENSE). Repository commit: `4b0e9f01fa8d214d39bbfe5391257640634fb9a0`. REA Evidence: `ev_447977d5c6495b33d538b786edeccfae4d01fc6ad3f959dec23ec35eb8e74247`.

## Browser Use

**Observed and source facts.** The MIT-licensed Python library implements an iterative agent: browser state is summarized, an LLM selects structured actions, the browser executes them, and history is recorded. It supports multiple model providers, Ollama, custom tools, structured output, sensitive-data placeholders, replay, CDP, and local/cloud browsers. Source warnings explicitly call out using sensitive data without a domain allowlist. Anonymous telemetry is documented with an opt-out.

The hosted agent and stealth browser are separate paid services. Published pricing lists browsers at $0.02/hour plus traffic and model charges. Local use of the library, browser, and a local model requires no Browser Use API key, but still consumes local hardware and model resources.

**Design lesson.** A bounded action schema, useful history, and direct opening of a task URL reduce latency. Sensitive values should stay out of model context, and domain controls matter most when credentials are present. Completion reported by a model is not independent proof of an external side effect.

Sources: [site](https://browser-use.com/), [repository](https://github.com/browser-use/browser-use), [documentation index](https://docs.browser-use.com/llms.txt), [pricing](https://browser-use.com/pricing), [license](https://raw.githubusercontent.com/browser-use/browser-use/main/LICENSE). Repository commit: `b49a68e4060acb226da8f784194fef301c53a6d7`. REA Evidence: `ev_0a6a104736402706dde6da785b80046c1e3d437a627d0609235ea64a8ba1dd69`.

## Claude in Chrome

**Observed facts.** Claude in Chrome is a proprietary extension for paid plans. It works with the user's existing tabs and authenticated state, clicking, typing, navigating, and producing deliverables. This makes it convenient but gives page content and screenshots access to potentially sensitive account data.

Official safety documentation describes manual, automatic, and skip-approval modes; per-site permissions; explicit approval for protected actions; prohibited actions; incoming prompt-injection classifiers; and pre-action safety review. Anthropic explicitly warns that defenses are imperfect, visible sensitive information enters screenshots/conversations, and a separate profile and restrictive allowlist are safer. Its reported attack-success figure is an internal test result, not a universal security guarantee.

**Design lesson.** Sensitive actions need policy outside the model, and users need a clear distinction between read-only and acting modes. Existing personal profiles increase capability but also blast radius. Agent-fast therefore starts with a separate session and does not expose personal-profile attachment.

Sources: [product page](https://claude.com/claude-in-chrome), [permissions guide](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide), [safety guide](https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely). Extension internals were not available as source. REA Evidence: `ev_dd6c06ac859817dc61d3906850069c5630b2e60d5a8a8915cc5f1e1628fe5961`.

## Browserbase

**Observed and vendor-documented facts.** Browserbase is a hosted platform for cloud browsers, agents, search, fetch, functions, and model access. It supports Playwright, Puppeteer, Selenium, and Stagehand. Its security documentation states one browser per VM, isolated subnets and firewalls, fresh VMs after sessions, no shared GPU, regional controls, optional logging/replay, SOC 2 Type II, HIPAA options, and third-party testing. These are vendor declarations; the hosted implementation was not independently inspected.

The service is proprietary and cloud-first. The current pricing page includes a limited free tier and metered browser hours, agent runs, search/fetch, proxies, and models. Browserbase's on-prem answer is consulting/hybrid architecture rather than a generally distributed open-source Browserbase server. Stagehand is a separate MIT-licensed project.

**Design lesson.** Strong hosted isolation is valuable but not required for a free local agent. Keep cloud integration optional and avoid making a paid account part of the core workflow.

Sources: [site](https://www.browserbase.com/), [platform docs](https://docs.browserbase.com/introduction), [security architecture](https://docs.browserbase.com/account/enterprise/security), [pricing](https://www.browserbase.com/pricing). REA Evidence: `ev_edb854a7219b49e1e8efae44884cdd510ff8bed1f50b5676291d5cb34c2a7071`.

## Kernel

**Observed and source facts.** Kernel's Apache-licensed repository contains headful/headless Chromium images and a Go API server for recording, process execution, files, and CDP proxying. It supports noVNC/WebRTC live view, read-only view configuration, and replay capture. The Unikraft path can snapshot a suspended browser and restore it; the README claims cold restarts below 20 ms after initial startup.

The same README warns that a generated Unikraft live-view URL is public to anyone who has it and should only be used for non-sensitive interactions. Hosted isolation and benchmark results were not independently tested. Kernel's benchmark page advertises faster cold starts/end-to-end execution and lower cost; these remain vendor/competitor-comparison claims. Hosted pricing uses credits plus GB-second usage.

**Design lesson.** Warm state and restore are useful optimizations, but live control endpoints need authentication and careful exposure. Agent-fast does not expose a live-view server.

Sources: [site](https://www.kernel.sh/), [repository](https://github.com/kernel/kernel-images), [benchmark claims](https://www.kernel.sh/benchmarks), [pricing](https://www.kernel.sh/pricing), [license](https://raw.githubusercontent.com/kernel/kernel-images/main/LICENSE). Repository commit: `6d4d1a6611478e81dc82f3cd654ff9cf6aeed86e`. REA Evidence: `ev_9f514d861b5c1b65f1770648713e49db69053065165b332b285d5503ba898dd6`.

## Stagehand

**Observed and source facts.** Stagehand v4 places an extension next to the browser and exposes Playwright-style TypeScript, Python, and Go APIs. It combines deterministic page control with `act`, `observe`, and `extract` model primitives, self-healing actions, trimmed accessibility context, batching, nested iframe/closed-shadow support, WebMCP, and OTel. The local `browse` CLI needs no model key or Browserbase account; SDK model use and hosted Browserbase features can cost money.

Source code implements normalized exact/wildcard domain policies and compiles them into Chrome Declarative Net Request rules covering navigation and subresources. Block rules take precedence. The project is MIT-licensed and has a private security-reporting policy. Its site advertises 2x faster execution and 80% better token efficiency; the comparison scope was not independently reproduced and should not be generalized to every Playwright workload.

**Design lesson.** Put repeated browser operations near the browser, batch them, and keep model calls scoped to decisions that need them. Domain rules should cover subresources, not only top-level navigation.

Sources: [site](https://www.stagehand.dev/), [repository](https://github.com/browserbase/stagehand), [domain-policy implementation](https://github.com/browserbase/stagehand/blob/main/packages/extension/understudy/domainPolicy.ts). Repository commit: `d9cb8ccb8f9f4d07aaeb33cd634d76baabdc4295`. REA Evidence: `ev_dc8a534686b6b1da70150d481c60fda70d69dd38e7000a7909df67444796433f`.

## Browserless

**Observed and source facts.** Browserless is a TypeScript browser service distributed in Docker variants. It supports standard Puppeteer/Playwright connections, Chromium/Firefox/WebKit images, concurrency/queue limits, session debugging, and core APIs. Cloud/enterprise features include BrowserQL, stealth/CAPTCHA options, persistent sessions, replay, proxies, and additional APIs.

The repository is dual-licensed SSPL-1.0 or a Browserless commercial license. It is not under Apache/MIT terms, and closed-source commercial/CI use has additional conditions. Source shows `TOKEN` is optional by default and private-network navigation blocking is disabled unless ranges are configured. Operators must explicitly configure authentication, network restrictions, and safe exposure.

The hosted free tier currently lists 1,000 monthly units and two concurrent browsers. Production/uptime/customer performance numbers are vendor claims.

**Design lesson.** A remote browser endpoint is a privileged network proxy, not merely a convenience API. Agent-fast avoids exposing one and strips arbitrary CDP attachment from its public interface.

Sources: [site](https://www.browserless.io/), [repository](https://github.com/browserless/browserless), [pricing](https://www.browserless.io/pricing), [self-host licensing](https://www.browserless.io/platform/self-hosted), [network-security source](https://github.com/browserless/browserless/blob/main/src/network-security.ts). Repository commit: `1667678e2f1626f2847d29fb71da615659a5ce85`. REA Evidence: `ev_d9f7f996b5b0b229fa6574f2c6153d1e2f9f9f8c44cacce1dd5b89091deb787b`.

## Steel

**Observed and source facts.** Steel Browser is an Apache-2.0 Node.js API/UI using Puppeteer and CDP. It manages sessions, pages, browser state, proxies, extensions, screenshots/PDF/scraping, and cleanup. Its experimental commands API accepts batched ref-based commands and implements operation tokens/idempotency and bounded records. Steel Cloud adds managed scale, stealth, proxies, and CAPTCHA features.

Steel's security policy is unusually direct: the self-hosted API and CDP intentionally have no authentication, anyone who can reach them can make browser requests/read responses, and ports should be published only on loopback behind authentication and network restrictions. Cloud authentication is a separate deployment concern. The hosted pricing page lists one-time launch credits and usage charges; the self-hosted core is free.

**Design lesson.** Explicit security boundaries are better than assuming a local service is safe. Batch commands and idempotency are useful, but no request should be retried blindly after an uncertain external side effect.

Sources: [site](https://steel.dev/), [repository](https://github.com/steel-dev/steel-browser), [security policy](https://raw.githubusercontent.com/steel-dev/steel-browser/main/SECURITY.md), [pricing](https://steel.dev/pricing). Repository commit: `3aa8ae14600a4e6c34e66f811cdd9d358e050789`. REA Evidence: `ev_f526240dafe0f3cfcace0d5b35575e6fa5a2ee014cbebe38cd72f8eedbd2fb6b`.

## Resulting architecture

Agent-fast combines the strongest compatible ideas without depending on a hosted service:

- a native persistent engine and compact refs from agent-browser;
- Playwright-inspired deterministic interaction and debugging concepts;
- Browser Use-style bounded autonomous action history and local Ollama support;
- Stagehand-inspired narrow model tools and reduced page context;
- Claude-style explicit read/act separation and warnings about sensitive pages;
- Browserbase/Kernel-inspired fresh sessions and attention to isolation;
- Browserless/Steel-inspired refusal to expose an unauthenticated browser control service.

The project deliberately does not promise CAPTCHA bypass, residential proxies, stealth, hosted scale, or absolute security. Those are neither required for a useful free local agent nor honest to claim without additional infrastructure and verification.
