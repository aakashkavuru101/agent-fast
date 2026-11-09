#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
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

Commands:
  install [--with-deps]      Install Chrome for Testing and optional Linux system dependencies
  doctor                     Check the native browser engine
  open <url>                 Navigate in the persistent session
  snapshot [selector]        Print a compact interactive accessibility tree
  get <title|url|text|html> [selector]
                             Read page state
  click <ref>                Click an element ref (explicit user action)
  fill <ref> <text>          Fill an element ref (explicit user action)
  scroll <up|down> [pixels]  Scroll the page
  wait <ms>                  Wait, bounded by the command timeout
  wait-for <selector>        Wait until an element is visible
  frame <selector|main>      Select an iframe or return to the main document
  press <key>                Press a key or chord (explicit user action)
  select <selector> <value>  Select a dropdown option (explicit user action)
  assert-text <selector> <text>
                             Verify text, waiting up to 10 seconds
  back | forward | reload    Navigate browser history
  auth login <profile>       Use an engine auth-vault profile without exposing credentials
  run <task>                 Run the bounded local-model agent loop
  flow <file>                Replay a saved workflow without model calls
  mcp                        Start the secured MCP stdio server
  close                      Close the session browser

Options:
  --act                      Allow clicks, fills, and ordinary interaction for run/flow/MCP
  --session <name>           Isolated session name (default: agent-fast)
  --allowed-domains <list>   Comma-separated exact or *.example.com domains
  --executable-path <path>   Chromium executable
  --headed                   Show the browser window
  --max-output <chars>       Page output cap, 1..100000 (default: 20000)
  --timeout <ms>             Engine timeout (default: 60000; install: 300000)
  --model <name>             Model name (default: qwen3:4b or AGENT_FAST_MODEL)
  --model-url <url>          OpenAI-compatible chat completions URL
  --max-steps <count>        Agent iterations, 1..50 (default: 20)
  --schema <file>            Require a JSON-Schema-valid result from run
  --save-flow <file>         Save successful run actions with secret placeholders
  --param <key=value>        Supply a replay parameter; repeat as needed
  --param-env <NAME>         Read replay parameter NAME from the environment; repeat as needed
  --keep-open                Keep the browser open after run/flow
  --help                     Show this help

Model environment:
  AGENT_FAST_MODEL           Model name
  AGENT_FAST_MODEL_URL       Defaults to http://127.0.0.1:11434/v1/chat/completions
  AGENT_FAST_API_KEY         Optional; never inherited by the browser engine

The run and flow commands are read-only unless --act is supplied. No telemetry is collected.`;

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
      session: { type: "string", default: "agent-fast" },
      "allowed-domains": { type: "string" },
      "executable-path": { type: "string" },
      headed: { type: "boolean", default: false },
      "max-output": { type: "string", default: "20000" },
      timeout: { type: "string" },
      model: { type: "string" },
      "model-url": { type: "string" },
      "max-steps": { type: "string", default: "20" },
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

  const act = ["run", "flow", "mcp"].includes(command) ? values.act : true;
  const config: RuntimeConfig = {
    session: validateSession(values.session),
    policy: act ? "act" : "read-only",
    allowedDomains: validateDomains(values["allowed-domains"]),
    executablePath: values["executable-path"],
    headed: values.headed,
    maxOutput: parsePositiveInteger(values["max-output"], "max-output", 100_000),
    timeoutMs: parsePositiveInteger(values.timeout ?? (command === "install" ? "300000" : "60000"), "timeout", 300_000),
  };

  if (command === "mcp") {
    // A stalled stdout pipe can keep Node alive after server cleanup has finished.
    process.exit(await runMcp(config));
  }

  if (command === "flow") {
    const { loadWorkflow, replayWorkflow } = await import("./workflow.js");
    const { executeTool, commandForTool } = await import("./agent.js");
    if (positionals.length !== 2) throw new Error("flow expects one workflow file");
    try {
      const workflow = await loadWorkflow(positional(positionals, 1, "workflow file"));
      const trace = await replayWorkflow(
        workflow,
        config,
        parseParameters(values.param, values["param-env"]),
        executeTool,
        commandForTool,
      );
      console.log(JSON.stringify({ success: true, steps: trace.length, trace }, null, 2));
    } finally {
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
      timeoutMs: config.timeoutMs,
    };
    const result = await runAgent({
      task,
      act: values.act,
      maxSteps: parsePositiveInteger(values["max-steps"], "max-steps", 50),
      keepOpen: values["keep-open"],
      schema: values.schema ? await readSchema(values.schema) : undefined,
      saveFlow: values["save-flow"],
    }, config, modelConfig);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "completed") process.exitCode = 1;
    return;
  }

  const expectCount = (count: number): void => {
    if (positionals.length !== count) throw new Error(`${command} expects ${count - 1} argument(s)`);
  };
  const safeArgument = (value: string): string => {
    if (value.startsWith("-")) throw new Error("command arguments must not start with a hyphen");
    return value;
  };

  if (["frame", "wait-for", "assert-text", "press", "select"].includes(command)) {
    expectCount(command === "select" || command === "assert-text" ? 3 : 2);
    const { executeTool } = await import("./agent.js");
    const name = command.replaceAll("-", "_");
    const first = positional(positionals, 1, "target");
    const args = command === "frame" ? { target: first }
      : command === "press" ? { key: first }
      : command === "select" ? { selector: first, value: positionals[2] }
      : command === "assert-text" ? { selector: first, text: positionals[2] }
      : { selector: first };
    const result = await executeTool({ id: "cli", name, args }, config, act);
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
      const selector = positionals[1] === undefined ? [] : [safeArgument(positionals[1])];
      engineCommand = ["snapshot", "-i", ...selector];
      break;
    }
    case "get": {
      if (positionals.length > 3) throw new Error("get accepts at most one selector");
      const kind = positional(positionals, 1, "get kind");
      if (!["title", "url", "text", "html"].includes(kind)) {
        throw new Error("get kind must be title, url, text, or html");
      }
      const selector = positionals[2] === undefined ? [] : [safeArgument(positionals[2])];
      engineCommand = ["get", kind, ...selector];
      break;
    }
    case "click":
      expectCount(2);
      engineCommand = ["click", safeArgument(positional(positionals, 1, "element ref"))];
      break;
    case "fill": {
      expectCount(3);
      const text = positional(positionals, 2, "text");
      if (text.startsWith("-")) throw new Error("fill text must not start with a hyphen");
      engineCommand = ["fill", safeArgument(positional(positionals, 1, "element ref")), text];
      break;
    }
    case "scroll": {
      if (positionals.length > 3) throw new Error("scroll accepts at most direction and pixels");
      const direction = positional(positionals, 1, "direction");
      if (direction !== "up" && direction !== "down") throw new Error("direction must be up or down");
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
      engineCommand = ["auth", "login", safeArgument(positional(positionals, 2, "profile"))];
      break;
    default:
      throw new Error(`unknown command: ${command}\n\n${HELP}`);
  }

  const result = await runEngine(config, engineCommand);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
