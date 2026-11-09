import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { runEngineBatch } from "./engine.js";
import type { EngineResult, RuntimeConfig, ToolCall, TraceEntry } from "./types.js";

const ACTIONS = new Set([
  "open", "snapshot", "get_text", "get_state", "read", "back", "forward", "reload",
  "tab_new", "tab_list", "tab_switch", "tab_close", "scroll", "wait", "click", "fill",
  "click_text", "fill_label", "auth_login",
  "frame", "wait_for", "assert_text", "press", "select",
]);
const ACT_ACTIONS = new Set(["click", "fill", "click_text", "fill_label", "tab_close", "auth_login", "press", "select"]);
const PLACEHOLDER = /^\{\{([A-Za-z0-9_]{1,64})\}\}$/;

export interface WorkflowStep {
  action: string;
  args: Record<string, unknown>;
}

export interface Workflow {
  version: 1;
  steps: WorkflowStep[];
}

export type ToolExecutor = (call: ToolCall, config: RuntimeConfig, act: boolean) => Promise<EngineResult>;
export type CommandMapper = (call: ToolCall, act: boolean, allowedDomains: string[], timeoutMs: number) => string[][] | null;

function validateStep(value: unknown): WorkflowStep {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("workflow steps must be objects");
  }
  const candidate = value as { action?: unknown; args?: unknown };
  if (typeof candidate.action !== "string" || !ACTIONS.has(candidate.action)) {
    throw new Error("workflow contains an unsupported action");
  }
  if (typeof candidate.args !== "object" || candidate.args === null || Array.isArray(candidate.args)) {
    throw new Error("workflow action arguments must be objects");
  }
  if (Object.keys(candidate).some((key) => key !== "action" && key !== "args")) {
    throw new Error("workflow steps contain unknown fields");
  }
  return { action: candidate.action, args: candidate.args as Record<string, unknown> };
}

export async function saveWorkflow(path: string, trace: TraceEntry[]): Promise<void> {
  const steps: WorkflowStep[] = [];
  let placeholderIndex = 0;
  for (const entry of trace) {
    if (!ACTIONS.has(entry.action)) continue;
    const args = { ...entry.args };
    if ((entry.action === "fill" || entry.action === "fill_label") && typeof args.text === "string") {
      placeholderIndex++;
      args.text = `{{value${placeholderIndex}}}`;
    }
    steps.push(validateStep({ action: entry.action, args }));
  }
  if (steps.length === 0 || steps.length > 100) {
    throw new Error("workflow must contain between 1 and 100 replayable actions");
  }
  const workflow: Workflow = { version: 1, steps };
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(workflow, null, 2) + "\n", "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

export async function loadWorkflow(path: string): Promise<Workflow> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 1_000_000) {
    throw new Error("workflow must be a regular file of at most 1000000 bytes");
  }
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("workflow must be an object");
  }
  const candidate = parsed as { version?: unknown; steps?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.steps)) {
    throw new Error("unsupported workflow format");
  }
  if (candidate.steps.length === 0 || candidate.steps.length > 100) {
    throw new Error("workflow must contain between 1 and 100 steps");
  }
  return { version: 1, steps: candidate.steps.map(validateStep) };
}

function substitute(value: unknown, params: Record<string, string>, used: Set<string>): unknown {
  if (typeof value === "string") {
    const match = value.match(PLACEHOLDER);
    if (!match) return value;
    const name = match[1]!;
    const replacement = params[name];
    if (replacement === undefined) throw new Error(`missing workflow parameter: ${name}`);
    used.add(name);
    return replacement;
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, params, used));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, params, used)]));
  }
  return value;
}

export async function replayWorkflow(
  workflow: Workflow,
  config: RuntimeConfig,
  params: Record<string, string>,
  execute: ToolExecutor,
  mapCommands: CommandMapper,
): Promise<TraceEntry[]> {
  const act = config.policy === "act";
  const used = new Set<string>();
  const steps = workflow.steps.map((step) => ({
    action: step.action,
    args: substitute(step.args, params, used) as Record<string, unknown>,
  }));
  for (const name of Object.keys(params)) {
    if (!used.has(name)) throw new Error(`unused workflow parameter: ${name}`);
  }
  if (steps.some((step) => ACT_ACTIONS.has(step.action)) && !act) {
    throw new Error("workflow contains interactions; use --act to replay it");
  }
  for (const step of steps) {
    mapCommands({ id: "validate", name: step.action, args: step.args }, act, config.allowedDomains, config.timeoutMs);
  }

  const trace: TraceEntry[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index]!;
    const call: ToolCall = { id: `replay_${index}`, name: step.action, args: step.args };
    const commands = mapCommands(call, act, config.allowedDomains, config.timeoutMs);
    if (!commands || commands.length !== 1) {
      const result = await execute(call, config, act);
      if (!result.success) throw new Error(`replay action ${step.action} failed: ${String(result.error)}`);
      trace.push({ step: index + 1, action: step.action, args: step.args, result });
      index++;
      continue;
    }
    const batch: Array<{ step: WorkflowStep; command: string[] }> = [];
    while (index < steps.length && batch.length < 50) {
      const current = steps[index]!;
      const currentCall: ToolCall = { id: `replay_${index}`, name: current.action, args: current.args };
      const currentCommands = mapCommands(currentCall, act, config.allowedDomains, config.timeoutMs);
      if (!currentCommands || currentCommands.length !== 1) break;
      batch.push({ step: current, command: currentCommands[0]! });
      index++;
    }
    const results = await runEngineBatch(config, batch.map((item) => item.command));
    for (const [resultIndex, item] of batch.entries()) {
      const result = results[resultIndex];
      if (!result) throw new Error("engine returned fewer batch results than requested");
      if (!result.success) throw new Error(`replay action ${item.step.action} failed: ${String(result.error)}`);
      trace.push({ step: trace.length + 1, action: item.step.action, args: item.step.args, result });
    }
  }
  return trace;
}
