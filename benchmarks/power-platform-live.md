# Power Platform live benchmark (2026-11-11)

agent-fast as the browser of a private Power Platform harness (a Claude Code plugin, over MCP), against a real Power Platform sandbox environment (Dataverse) and a SharePoint site. Complements `warm.mjs` (loopback page) with real Microsoft pages.

- **Versions:** `@aakashkavuru101/agent-fast@0.3.0` (npm), `agent-browser` 0.41.2, Chrome for Testing 157, macOS arm64, Node 26.12.1, Claude Code 2.1.322, Opus 5.5.
- **Launch (the harness plugin):** `agent-fast --act --allow-preset microsoft --allowed-domains *.powerappsportals.com,*.botframework.com --profile <plugin data>/browser-profile --headed mcp`.
- **How timed:** from each `agent_fast_*` tool call to its result in the Claude Code session log (the harness's own session-log script). Includes the harness guard's check (a few ms) and the MCP round trip; dominated by Microsoft page work. Calls the guard refused are counted, not timed.

## Through the harness (MCP)

| Case | What | Calls | Errors | Median ms | p95 ms | Slowest actions (median ms) |
|---|---|---|---|---|---|---|
| H | Maker portal, apps list, refusals, Copilot Studio, Power BI | 15 | 0 | 1793 | 6931 | wait_for 2919, open 2179, snapshot 588 |
| BM2 | 3 × (home, apps list, open Studio, select a button, read OnSelect, close) | 57 | 11 | 1453 | 30240 | wait_for 30137, batch 6323, wait 5138 |
| L1 | Create a SharePoint list and its columns in the site UI (23 batches) | 25 | 5 | 3302 | 31221 | batch 3328, read 2034, screenshot 402 |
| L2 | Add a choice column and a filtered view, create a second list with lookup, person and date columns; read back through the site's REST pages (44 batches) | 53 | 15 | 3238 | 11240 | batch 3735, click 3238, read 1272 |
| L3 | Calculated column, 3 indexes, column formatting JSON in the list settings UI; verified through REST pages (30 batches) | 50 | 4 | 3615 | 15359 | batch 8557, screenshot 1330, read 1038 |
| D1 | Dataverse solution and table with 3 columns in the Power Apps maker portal; a column fixed after read-back (45 batches) | 48 | 7 | 2293 | 30953 | batch 2397, snapshot 919 |
| D2 | A second Dataverse table (a choice column synced to a global choice, a default value) in the maker portal; read back (48 batches) | 76 | 9 | 2183 | 31219 | wait_for 5707, open 2333, batch 2325 |
| D3 | Read-only checks by opening Dataverse Web API GET pages (JSON); the first failed before sign-in | 9 | 2 | 1522 | 4627 | read 1648, get_url 1373, open 1256 |
| A3 | Read-only reference check by opening Dataverse Web API GET pages (JSON) | 7 | 0 | 1904 | 3652 | read 1904 |

Studio (Power Apps canvas editor) becomes usable about 57–60 s after the edit URL opens; that is Studio's own load. The egress proxy blocked only Chrome background hosts (Google, MSN); no Microsoft host was blocked.

## Direct (CLI and in-process), same morning

| Operation | Time |
|---|---|
| `open` maker portal (redirect to sign-in) | 2.4 s |
| `open` apps list (signed in) | 0.45 s |
| `get url`, `snapshot` (CLI, warm session) | under 0.1 s wall |
| Click inside Studio through `executeTool` (fallback to the on-screen position) | 52–112 ms |
| Warm `get title` over MCP (warm.mjs, 2026-11-10) | 0.44 ms median |

## Findings

| ID | Finding | Effect | Suggested fix |
|---|---|---|---|
| AF-1 | The engine refuses clicks inside Studio's iframe as "covered" (the hit test uses the wrong frame offset); `clickInFrame` falls back to the on-screen position and works every time over MCP | None over MCP | Keep; report upstream to agent-browser |
| AF-2 | The CLI `click` goes straight to the engine and skips `clickInFrame` (`src/cli.ts`) | CLI users get the raw refusal in Studio | Route the CLI click through `executeTool` |
| AF-3 | `wait_for` with text does not look inside iframes: in Studio it times out after 30 s | Sets the p95 in BM2 and L1 | Make text waits frame-aware |
| AF-4 | `frame <ref>` then any CSS selector fails in Studio ("Element not found in the selected frame", even `body`) | Selector reads inside Studio fail; refs work | Investigate the frame selection |
| AF-5 | Studio's formula bar (Monaco) exposes only the first line; `get text` is empty | Formulas are read by paging the formula bar | Read Monaco's view lines, or document the canvas-authoring route |
| AF-6 | Two MCP servers with the same `--profile` cannot both run: the second fails on Chrome's profile lock | One harness browser per machine at a time | Name the lock and its process in the error |
| AF-7 | Each CLI call must repeat the launch flags, or it fails with "different domain allowlist" | CLI only | Remember the session's flags |
| AF-8 | Chrome for Testing runs with an English UI. On a multilingual SharePoint site whose default language is Japanese, every display name set through the UI is stored as the English translation only, so Japanese users still see the old names | **High at Japanese clients**: names the agent sets look wrong to users | A `--lang <locale>` option (Chrome `--lang` and `Accept-Language`); the harness passes `ja` |

Raw logs are kept by the tester and not published. The harness's session-log script has since had fixes that change these counts slightly.
