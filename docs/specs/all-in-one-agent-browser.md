# All-in-one browser automation for AI agents

## Goal

Agent-fast covers the six features an AI agent needs from a browser, free and open source: token efficiency, zero setup, vision fallback, model integrations, stealth, and human-check handling. Power Platform is one use case among many.

## Scope

**In:** installed-browser detection, stealth launch flags, screenshot on failed lookups, a `handoff` tool for human checks, native Anthropic/OpenAI/Gemini routing with image input, and MCP snapshot diffs.

**Out:** automated CAPTCHA solving, fingerprint spoofing or proxy rotation, and the Power Platform head-to-head benchmark rerun.

## Acceptance criteria

- **AC1:** Given an installed Chrome, Brave, Edge, or Chromium, when `doctor` runs, then it names and starts that browser and `install` is not needed.
- **AC2:** Given a headless session on an installed browser, when a page reads `navigator.webdriver` and the user agent, then it sees `false` and no `HeadlessChrome`.
- **AC3:** Given an element lookup that fails, when the result returns, then it carries a screenshot and a hint to click by coordinates, in the run loop and over MCP.
- **AC4:** Given a page showing a human check, when `handoff` runs with a profile or headed session, then a person can solve it and the session resumes with the check gone.
- **AC5:** Given a `claude-*`, `gpt-*`/`o*`, or `gemini-*` model name, when `run` starts, then it uses that vendor's API with that vendor's key, and a custom URL receives only `AGENT_FAST_API_KEY`.
- **AC6:** Given a previous snapshot of the same scope, when MCP `snapshot` runs with `diff`, then only added and removed lines return, counted exactly.

## Task graph

| ID | Task | Depends on | Covers | Status |
|---|---|---|---|---|
| T1 | Browser detection and doctor check | - | AC1 | done |
| T2 | Stealth launch flags | T1 | AC2 | done |
| T3 | Vision fallback on failed lookups | - | AC3 | done |
| T4 | Human-check detection and handoff | T1 | AC4 | done |
| T5 | Vendor model routing with images | T3 | AC5 | done |
| T6 | MCP snapshot diff | - | AC6 | done |
| T7 | Security and code review fixes | T1-T6 | AC1-AC6 | done |
