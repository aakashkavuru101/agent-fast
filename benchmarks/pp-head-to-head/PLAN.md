# Head-to-head on real Power Platform work: agent-fast vs Claude in Chrome vs Playwright MCP

Brief for the session that runs this benchmark. You start with no other context: everything you need is here and in `local.json` next to this file (git-ignored; it holds the tenant-specific values).

## Goal

Measure how agent-fast compares on **real** Power Platform work, not a loopback page (`benchmarks/warm.mjs` already covers engine overhead: agent-fast over MCP 0.44 ms per warm action). The same task, the same model, the same machine and the same sandbox environment, driven by:

1. **agent-fast** (`@aakashkavuru101/agent-fast@0.3.0`, the globally installed npm build, the one clients get)
2. **Claude in Chrome** (the Claude Code Chrome integration, the user's own Chrome with the extension)
3. **Playwright MCP** (`@playwright/mcp`, pinned to a version published at least two weeks ago)

Report wall time, browser calls, errors, retries, tokens and whether the task succeeded, and say plainly where agent-fast wins and where it loses.

## What already exists

- `benchmarks/power-platform-live.md`: agent-fast inside a private Power Platform harness, live test (2026-11-11). Its BM2 row (57 browser calls, 11 errors, median 1453 ms, p95 30240 ms, about 7.7 min of work) was measured **with the harness guard and rules on top**, so it is not directly comparable: rerun agent-fast here in the same plain setup as the others.
- Known agent-fast issues in Power Apps Studio (same file, AF-1 to AF-8): clicks inside the Studio iframe are refused by the engine and handled by the on-screen fallback over MCP (AF-1); waiting for text does not look inside iframes and times out at 30 s (AF-3); the formula bar shows only the first line (AF-5).

## The task (BM2)

The prompt is in `local.json` (`prompt`). In short, three rounds of: open the maker portal home of the sandbox environment, open and read the apps list, open the test app in Studio and wait for it to load, select one button and read its `OnSelect` formula, close Studio without changing anything. Success means all three rounds finished, the formula was read (it starts with `local.json.expectFormulaStart`), and the app is unchanged (Studio's Save stayed disabled; the app's "Modified" time in the apps list did not move).

## Method

1. **Runner** `benchmarks/pp-head-to-head/run.mjs` (Node standard library only): for one tool, spawn
   `claude -p "<prompt>" --output-format stream-json --verbose --model claude-opus-5-5 --mcp-config <tool>.mcp.json --strict-mcp-config --allowedTools "<that tool's MCP tools>"`
   and deny every other tool (`--disallowedTools` Bash, Write, Edit, WebFetch, WebSearch, Agent, …). Timestamp each stream line when it arrives and save it raw to `runs/<tool>-<n>.jsonl`.
   - Check `claude --help` first: confirm the flag names in this Claude Code version, and how the Chrome integration is enabled for a print-mode run (`--chrome` or similar). If Claude in Chrome cannot run in print mode, run it as an interactive session with the same prompt and time it from that session's own log instead; say so in the results.
2. **Summary** `benchmarks/pp-head-to-head/summarize.mjs`: per run, from the raw lines: wall time (first to last line), browser tool calls, errors (`is_error` results), per-call latency (tool use to its result, median and p95), retries (the same action repeated after an error), model turns, input and output tokens (the final `result` line's usage), and success (the formula's first line appears in the final answer). Write a Markdown table. Give the summary's maths one small test (`test/pp-head-to-head.test.mjs`, a tiny fixture).
3. **Configs** next to the runner, one per tool:
   - `agent-fast.mcp.json`: `agent-fast --act --allow-preset microsoft --allowed-domains *.powerappsportals.com,*.botframework.com --profile <home>/.agent-fast-bench/profile --headed mcp`
   - `playwright.mcp.json`: `npx -y @playwright/mcp@<pinned> --user-data-dir <home>/.playwright-mcp-bench/profile` (headed)
   - Claude in Chrome needs no config file; it uses the user's Chrome.
4. **Runs:** one run of the task per tool first (each run already holds three rounds). Alternate the order if you do a second run. Run one tool at a time: Studio puts an edit lock on the app, so close each tool's browser (and Studio) before the next.

## The person's steps (ask, then wait)

- Sign in once to Microsoft with their work account in each tool's browser: the agent-fast bench profile, the Playwright profile, and their own Chrome (where Claude in Chrome needs site access granted for the maker portal and the Microsoft sign-in host).
- Confirm before each run; tell them which browser window will open.

## Safety (these sessions have no harness guard)

- Only the browser MCP tools are allowed in each run; no shell, no file writes from inside the run.
- The prompt changes nothing. After each run, check the app's "Modified" time in the apps list is unchanged; if anything changed, stop and tell the person.
- Claude in Chrome drives the person's real Chrome with all their sign-ins: keep to the task's pages; do not open other sites.
- Work only in the sandbox environment named in `local.json`.

## Git and privacy

- Work on branch `bench/pp-head-to-head` (already created from `main`). Commit, push and open a PR only after the person says so; never push to `main`.
- This repo is public. **Commit no tenant-specific data**: no environment URLs or IDs, SharePoint hosts, company or app names, people's names or emails. `local.json` and `runs/` are git-ignored here; keep them that way. Before committing, scrub `benchmarks/power-platform-live.md` the same way (it names the company, the harness and the environment).
- Commit: `PLAN.md`, `run.mjs`, `summarize.mjs`, the tool configs (with paths from `os.homedir()` or placeholders, no personal paths), the test, and `results-<date>.md` (the tables, the method, the versions, and a plain verdict).

## Report back

A short table per tool (wall time, calls, errors, median and p95 per call, tokens, success), what made each tool faster or slower on this task, and the caveats (one run each, model variance, Studio's own load time). Then the open agent-fast fixes that would move its numbers most (AF-3 first).
