#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_URL,
  modelEndpoint,
  parsePositiveInteger,
  validateDomains,
  validateHttpUrl,
  validateSession,
} from "./config.js";
import { runEngine, runMcp } from "./engine.js";
import type { ModelConfig, RuntimeConfig } from "./types.js";

const HELP = `Agent-fast: local-first browser agent with bounded actions

Usage: agent-fast [options] <command> [arguments]

Setup:
  install [--with-deps]      Install Chrome for Testing and optional Linux system dependencies
  doctor                     Check the native browser engine

Read (always allowed):
  open <url>                 Navigate in the persistent session
  snapshot [selector]        Print a compact interactive accessibility tree, frames included
  get <title|url|text|html> [selector]
  read [url]                 Print readable page content
  scroll <up|down|left|right> [pixels]
  wait <ms>                  Wait, bounded by the command timeout
  wait-for <selector>        Wait until an element is visible
  assert-text <selector> <text>
                             Verify text, waiting up to 10 seconds
  frame <selector|ref|main>  Scope to an iframe or return to the main document
  screenshot [--full]        Save a PNG in the artifacts directory and print its path
  console                    Print console messages and uncaught page errors
  network [filter]           List network requests
  dialog <status|accept|dismiss> [text]
  blocked                    List hosts the egress proxy refused for this session
  back | forward | reload
  tab-list | tab-new [url] | tab-switch <t1|label> | tab-close [t1|label]

Interact (explicit user actions):
  click <ref>                fill <ref> <text>          type [ref] <text>
  hover <ref>                check <ref>                uncheck <ref>
  drag <from-ref> <to-ref>   press <key>                select <selector> <value>
  click-at <x> <y>           Click viewport coordinates (canvas content, deeply nested frames)
  upload <ref> <file...>     Needs --upload-dir         download <ref>  Needs --download-dir
  auth login <profile>       Use an engine auth-vault profile without exposing credentials
  Put -- before a value that starts with a hyphen: agent-fast fill @e2 -- -5

Agents:
  run <task>                 Run the bounded local-model agent loop
  flow <file>                Replay a saved workflow without model calls
  mcp                        Start the MCP stdio server
  close                      Close the session browser and its egress proxy

Options:
  --act                      Allow clicks, fills, and ordinary interaction for run/flow/MCP
  --session <name>           Isolated session name (default: agent-fast; a private one per MCP server)
  --allowed-domains <list>   Comma-separated exact or *.example.com domains, enforced on every request
  --allow-preset <name>      Add a built-in allowlist: microsoft (Power Platform, Microsoft 365, sign-in)
  --open-web                 Let run navigate beyond the sites named in the task
  --profile <directory>      Dedicated browser profile that keeps sign-in between sessions
  --executable-path <path>   Chromium executable
  --headed                   Show the browser window
  --artifacts <directory>    Screenshots, failure captures, recordings (default: ~/.agent-fast/artifacts)
  --record                   Record a video of run/flow into the artifacts directory (needs ffmpeg)
  --upload-dir <directory>   Enable upload, limited to files in this directory
  --download-dir <directory> Enable download, saving into this directory
  --max-output <chars>       Page output cap, 1..100000 (default: 20000)
  --timeout <ms>             Engine timeout (default: 60000; install: 300000)
  --model <name>             Model name (default: qwen3:4b or AGENT_FAST_MODEL)
  --model-url <url>          OpenAI-compatible chat completions URL
  --max-steps <count>        Agent iterations, 1..50 (default: 20)
  --model-timeout <ms>       Time allowed for one model reply (default: 300000)
  --schema <file>            Require a JSON-Schema-valid result from run
  --save-flow <file>         Save successful run actions with secret placeholders
  --param <key=value>        Supply a replay parameter; repeat as needed
  --param-env <NAME>         Read replay parameter NAME from the environment; repeat as needed
  --keep-open                Keep the browser open after run/flow/mcp
  --help                     Show this help

Model environment:
  AGENT_FAST_MODEL           Model name
  AGENT_FAST_MODEL_URL       Defaults to http://127.0.0.1:11434/v1/chat/completions
  AGENT_FAST_API_KEY         Optional; never inherited by the browser engine

run, flow, and mcp are read-only unless --act is supplied. No telemetry is collected.`;

// Direct commands that reuse the agent tools' validation and execution.
const TOOL_COMMANDS: Record<string, { tool?: string; min: number; max: number; args: (p: string[]) => Record<string, unknown> }> = {
  frame: { min: 1, max: 1, args: (p) => ({ target: p[0] }) },
  "wait-for": { min: 1, max: 1, args: (p) => ({ selector: p[0] }) },
  "assert-text": { min: 2, max: 2, args: (p) => ({ selector: p[0], text: p[1] }) },
  press: { min: 1, max: 1, args: (p) => ({ key: p[0] }) },
  select: { min: 2, max: 2, args: (p) => ({ selector: p[0], value: p[1] }) },
  read: { min: 0, max: 1, args: (p) => (p[0] === undefined ? {} : { url: p[0] }) },
  hover: { min: 1, max: 1, args: (p) => ({ target: p[0] }) },
  check: { min: 1, max: 1, args: (p) => ({ target: p[0] }) },
  uncheck: { tool: "check", min: 1, max: 1, args: (p) => ({ target: p[0], checked: false }) },
  drag: { min: 2, max: 2, args: (p) => ({ source: p[0], target: p[1] }) },
  "click-at": { min: 2, max: 2, args: (p) => ({ x: Number(p[0]), y: Number(p[1]) }) },
  "tab-list": { min: 0, max: 0, args: () => ({}) },
  "tab-new": { min: 0, max: 1, args: (p) => (p[0] === undefined ? {} : { url: p[0] }) },
  "tab-switch": { min: 1, max: 1, args: (p) => ({ target: p[0] }) },
  "tab-close": { min: 0, max: 1, args: (p) => (p[0] === undefined ? {} : { target: p[0] }) },
  type: { min: 1, max: 2, args: (p) => (p.length === 1 ? { text: p[0] } : { target: p[0], text: p[1] }) },
  dialog: { min: 1, max: 2, args: (p) => ({ action: p[0], ...(p[1] === undefined ? {} : { text: p[1] }) }) },
  console: { min: 0, max: 0, args: () => ({}) },
  network: { min: 0, max: 1, args: (p) => (p[0] === undefined ? {} : { filter: p[0] }) },
  upload: { min: 2, max: 11, args: (p) => ({ target: p[0], files: p.slice(1) }) },
  download: { min: 1, max: 1, args: (p) => ({ target: p[0] }) },
};

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function positional(args: string[], index: number, name: string): string {
  return required(args[index], name);
}

async function readSchema(path: string): Promise<Record<string, unknown>> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 100_000) {
    throw new Error("schema must be a regular file of at most 100000 bytes");
  }
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("schema must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function parseParameters(values: string[] | undefined, environment: string[] | undefined): Record<string, string> {
  const params: Record<string, string> = Object.create(null);
  for (const entry of values ?? []) {
    const separator = entry.indexOf("=");
    const key = entry.slice(0, separator);
    if (separator < 1 || !/^[A-Za-z0-9_]{1,64}$/.test(key)) {
      throw new Error("parameters must use key=value with an alphanumeric/underscore key");
    }
    if (Object.hasOwn(params, key)) throw new Error(`duplicate parameter: ${key}`);
    params[key] = entry.slice(separator + 1);
  }
  for (const name of environment ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error("param-env must name an environment variable");
    if (Object.hasOwn(params, name)) throw new Error(`duplicate parameter: ${name}`);
    const value = process.env[name];
    if (value === undefined) throw new Error(`missing environment parameter: ${name}`);
    params[name] = value;
  }
  return params;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      act: { type: "boolean", default: false },
      session: { type: "string" },
      "allowed-domains": { type: "string" },
      "allow-preset": { type: "string", multiple: true },
      "open-web": { type: "boolean", default: false },
      profile: { type: "string" },
      artifacts: { type: "string" },
      record: { type: "boolean", default: false },
      full: { type: "boolean", default: false },
      "upload-dir": { type: "string" },
      "download-dir": { type: "string" },
      "executable-path": { type: "string" },
      headed: { type: "boolean", default: false },
      "max-output": { type: "string", default: "20000" },
      timeout: { type: "string" },
      model: { type: "string" },
      "model-url": { type: "string" },
      "max-steps": { type: "string", default: "20" },
      "model-timeout": { type: "string", default: "300000" },
      schema: { type: "string" },
      "save-flow": { type: "string" },
      param: { type: "string", multiple: true },
      "param-env": { type: "string", multiple: true },
      "keep-open": { type: "boolean", default: false },
      "with-deps": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  if (command === "__proxy") {
    // Internal: the detached per-session egress proxy started by ensureProxy.
    const { runProxy } = await import("./proxy.js");
    await runProxy(validateSession(positional(positionals, 1, "session")), validateDomains((JSON.parse(positional(positionals, 2, "domains")) as string[]).join(",")));
    return;
  }

  const act = ["run", "flow", "mcp"].includes(command) ? values.act : true;
  const directory = (value: string | undefined): string | undefined => value === undefined ? undefined : resolve(value);
  const config: RuntimeConfig = {
    // Each MCP server gets its own browser unless a session is named, so one client closing cannot end another's.
    session: validateSession(values.session ?? (command === "mcp" ? `agent-fast-mcp-${process.pid}` : "agent-fast")),
    policy: act ? "act" : "read-only",
    allowedDomains: validateDomains(values["allowed-domains"], values["allow-preset"]),
    profile: directory(values.profile),
    artifactsDir: directory(values.artifacts),
    uploadDir: directory(values["upload-dir"]),
    downloadDir: directory(values["download-dir"]),
    executablePath: values["executable-path"],
    headed: values.headed,
    maxOutput: parsePositiveInteger(values["max-output"], "max-output", 100_000),
    timeoutMs: parsePositiveInteger(values.timeout ?? (command === "install" ? "300000" : "60000"), "timeout", 300_000),
  };

  if (command === "mcp") {
    // A stalled stdout pipe can keep Node alive after server cleanup has finished.
    process.exit(await runMcp(config, values["keep-open"]));
  }

  if (command === "flow") {
    const { loadWorkflow, replayWorkflow } = await import("./workflow.js");
    const { executeTool, commandForTool } = await import("./agent.js");
    if (positionals.length !== 2) throw new Error("flow expects one workflow file");
    let recording: string | undefined;
    try {
      const workflow = await loadWorkflow(positional(positionals, 1, "workflow file"));
      if (values.record) {
        // Recording needs a running browser; opening a blank page first starts one.
        const { artifactPath, runEngineBatch } = await import("./engine.js");
        recording = artifactPath(config, "recording", "webm");
        const started = (await runEngineBatch(config, [["open"], ["record", "start", recording]])).at(-1);
        if (!started?.success) throw new Error(`recording could not start: ${String(started?.error)}`);
      }
      const trace = await replayWorkflow(
        workflow,
        config,
        parseParameters(values.param, values["param-env"]),
        executeTool,
        commandForTool,
      );
      console.log(JSON.stringify({ success: true, steps: trace.length, trace, ...(recording ? { artifacts: { recording } } : {}) }, null, 2));
    } finally {
      if (recording) await runEngine(config, ["record", "stop"]);
      if (!values["keep-open"]) await runEngine(config, ["close"]);
    }
    return;
  }

  if (command === "run") {
    const { runAgent } = await import("./agent.js");
    const task = positionals.slice(1).join(" ");
    const modelConfig: ModelConfig = {
      model: values.model ?? process.env.AGENT_FAST_MODEL ?? DEFAULT_MODEL,
      endpoint: modelEndpoint(
        values["model-url"] ?? process.env.AGENT_FAST_MODEL_URL ?? DEFAULT_MODEL_URL,
      ),
      apiKey: process.env.AGENT_FAST_API_KEY,
      // Reasoning models on local hardware can think for minutes per reply.
      timeoutMs: parsePositiveInteger(values["model-timeout"], "model-timeout", 1_800_000),
    };
    const result = await runAgent({
      task,
      act: values.act,
      maxSteps: parsePositiveInteger(values["max-steps"], "max-steps", 50),
      keepOpen: values["keep-open"],
      schema: values.schema ? await readSchema(values.schema) : undefined,
      saveFlow: values["save-flow"],
      openWeb: values["open-web"],
      record: values.record,
    }, config, modelConfig);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "completed") process.exitCode = 1;
    return;
  }

  const expectCount = (count: number): void => {
    if (positionals.length !== count) throw new Error(`${command} expects ${count - 1} argument(s)`);
  };

  if (command === "blocked") {
    expectCount(1);
    const { blockedLogPath } = await import("./proxy.js");
    const hosts = (await readFile(blockedLogPath(config.session), "utf8").catch(() => "")).split("\n").filter(Boolean)
      .map((line) => { const [host, reason] = line.split("\t"); return { host, reason }; });
    console.log(JSON.stringify({ success: true, data: { blocked: hosts } }, null, 2));
    return;
  }

  const toolCommand = command === "screenshot"
    ? { tool: "screenshot", min: 0, max: 0, args: () => ({ full_page: values.full }) } : TOOL_COMMANDS[command];
  if (toolCommand) {
    const rest = positionals.slice(1);
    if (rest.length < toolCommand.min || rest.length > toolCommand.max) {
      throw new Error(`${command} expects ${toolCommand.min === toolCommand.max ? toolCommand.min : `${toolCommand.min} to ${toolCommand.max}`} argument(s)`);
    }
    const { executeTool } = await import("./agent.js");
    const result = await executeTool({ id: "cli", name: toolCommand.tool ?? command.replaceAll("-", "_"), args: toolCommand.args(rest) }, config, act);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exitCode = 1;
    return;
  }

  let engineCommand: string[];
  switch (command) {
    case "install":
      expectCount(1);
      engineCommand = ["install", ...(values["with-deps"] ? ["--with-deps"] : [])];
      break;
    case "doctor":
    case "close":
      expectCount(1);
      engineCommand = [command];
      break;
    case "open":
      expectCount(2);
      engineCommand = ["open", validateHttpUrl(positional(positionals, 1, "url"), config.allowedDomains)];
      break;
    case "snapshot": {
      if (positionals.length > 2) throw new Error("snapshot accepts at most one selector");
      const selector = positionals[1] === undefined ? [] : [positionals[1]];
      engineCommand = ["snapshot", "-i", ...selector];
      break;
    }
    case "get": {
      if (positionals.length > 3) throw new Error("get accepts at most one selector");
      const kind = positional(positionals, 1, "get kind");
      if (!["title", "url", "text", "html"].includes(kind)) {
        throw new Error("get kind must be title, url, text, or html");
      }
      const selector = positionals[2] === undefined ? [] : [positionals[2]];
      engineCommand = ["get", kind, ...selector];
      break;
    }
    case "click":
      expectCount(2);
      engineCommand = ["click", positional(positionals, 1, "element ref")];
      break;
    case "fill": {
      expectCount(3);
      // An empty string clears the field.
      engineCommand = ["fill", positional(positionals, 1, "element ref"), positionals[2] ?? ""];
      break;
    }
    case "scroll": {
      if (positionals.length > 3) throw new Error("scroll accepts at most direction and pixels");
      const direction = positional(positionals, 1, "direction");
      if (!["up", "down", "left", "right"].includes(direction)) throw new Error("direction must be up, down, left, or right");
      const amount = positionals[2] ?? "800";
      parsePositiveInteger(amount, "scroll pixels", 5000);
      engineCommand = ["scroll", direction, amount];
      break;
    }
    case "wait": {
      expectCount(2);
      const ms = positional(positionals, 1, "milliseconds");
      parsePositiveInteger(ms, "wait milliseconds", 10_000);
      engineCommand = ["wait", ms];
      break;
    }
    case "back":
    case "forward":
    case "reload":
      expectCount(1);
      engineCommand = [command];
      break;
    case "auth":
      expectCount(3);
      if (positionals[1] !== "login") throw new Error("only auth login is supported");
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(positional(positionals, 2, "profile"))) throw new Error("profile must be an auth-vault profile name");
      engineCommand = ["auth", "login", positional(positionals, 2, "profile")];
      break;
    default:
      throw new Error(`unknown command: ${command}\n\n${HELP}`);
  }

  const result = await runEngine(config, engineCommand);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((error) => {
  const artifacts = (error as { artifacts?: unknown } | null)?.artifacts;
  console.error(JSON.stringify({
    success: false, error: error instanceof Error ? error.message : String(error), ...(artifacts ? { artifacts } : {}),
  }, null, 2));
  process.exitCode = 1;
});
