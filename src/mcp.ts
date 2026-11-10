import { Ajv } from "ajv";
import { fork, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { commandForTool, executeTool } from "./agent.js";
import { runEngine } from "./engine.js";
import { toolDefinitions } from "./model.js";
import { replayWorkflow } from "./workflow.js";
import type { EngineResult, RuntimeConfig } from "./types.js";

const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const PREFIX = "agent_fast_";
const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

interface Job { id: string | number; name: string; args: Record<string, unknown>; controller: AbortController; cancelled: boolean }

export async function runMcp(config: RuntimeConfig, keepOpen = false): Promise<number> {
  const act = config.policy === "act";
  const emptySchema = { type: "object", properties: {}, additionalProperties: false };
  const readOnly = new Set(toolDefinitions(false).map((tool) => tool.function.name));
  const tools = toolDefinitions(act).filter((tool) => tool.function.name !== "done").map((tool) => ({
    name: `${PREFIX}${tool.function.name}`,
    description: tool.function.description,
    inputSchema: tool.function.parameters as Record<string, unknown>,
    annotations: { readOnlyHint: readOnly.has(tool.function.name) },
  }));
  for (const name of ["get_title", "get_url", "close"]) {
    tools.push({ name: `${PREFIX}${name}`, description: name.replaceAll("_", " "), inputSchema: { ...emptySchema, required: [] }, annotations: { readOnlyHint: name !== "close" } });
  }
  const batchSchema = {
    type: "object", additionalProperties: false, required: ["steps"],
    properties: { steps: { type: "array", minItems: 1, maxItems: 50, items: {
      type: "object", additionalProperties: false, required: ["action", "args"],
      properties: {
        action: { type: "string", enum: tools.filter((tool) => tool.name !== `${PREFIX}close`).map((tool) => tool.name.slice(PREFIX.length)) },
        args: { type: "object" },
      },
    } } },
  };
  const catalog = [...tools, {
    name: `${PREFIX}batch`, description: "Execute up to 50 ordered actions in one request. Stops at the first failure and returns a failure screenshot; completed actions are not rolled back. Use assert_text to verify outcomes.",
    inputSchema: batchSchema, annotations: { readOnlyHint: !act },
  }];
  const ajv = new Ajv({ strict: false });
  const validators = new Map(catalog.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
  let initialized = false;
  let stopping = false;
  let usedBrowser = false;
  let outputFailed = false;
  let writer: ChildProcess | undefined;
  const stop = (): void => { stopping = true; process.stdin.destroy(); };
  const outputFailure = (): void => { outputFailed = true; stop(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // Responses are written one at a time: the writer acknowledges each before the next is sent.
  let sending: Promise<void> = Promise.resolve();
  const send = (message: unknown): Promise<void> => {
    const next = sending.then(() => write(message));
    sending = next.catch(() => {});
    return next;
  };
  const write = async (message: unknown): Promise<void> => {
    let encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) {
      const id = (message as { id?: unknown }).id ?? null;
      encoded = JSON.stringify({ jsonrpc: "2.0", id, result: {
        isError: true, content: [{ type: "text", text: "Response exceeded limit after execution; inspect state before repeating actions. Use a smaller batch or selector." }],
      } });
    }
    if (!writer) {
      writer = fork(new URL("./mcp-output.js", import.meta.url), {
        stdio: ["ignore", "inherit", "inherit", "ipc"], execArgv: [],
        env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
      });
      writer.on("error", outputFailure);
      writer.on("exit", outputFailure);
    }
    const output = writer;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        output.removeListener("message", acknowledged);
        output.removeListener("error", failed);
        output.removeListener("exit", failed);
        if (error) {
          outputFailed = true;
          output.kill("SIGKILL");
          reject(error);
        }
        else resolve();
      };
      const acknowledged = (success: unknown): void => finish(success === true ? undefined : new Error("MCP output failed"));
      const failed = (): void => finish(new Error("MCP output process stopped"));
      const timer = setTimeout(() => finish(new Error("MCP output timed out")), config.timeoutMs);
      output.once("message", acknowledged);
      output.once("error", failed);
      output.once("exit", failed);
      output.send(encoded, (error) => { if (error) finish(error); });
    });
  };
  const protocolError = (id: unknown, code: number, message: string): Promise<void> =>
    send({ jsonrpc: "2.0", id, error: { code, message } });

  const execute = async (name: string, args: Record<string, unknown>, current: RuntimeConfig): Promise<EngineResult> => {
    if (name === "get_title" || name === "get_url") return runEngine(current, ["get", name.slice(4)]);
    if (name === "close") return runEngine(current, ["close"]);
    return executeTool({ id: "mcp", name, args }, current, act);
  };

  // Browser actions run strictly in order on one page; protocol requests such as ping never wait behind them.
  const queue: Job[] = [];
  const state: { running: Job | null } = { running: null };
  let draining: Promise<void> = Promise.resolve();

  const runJob = async (job: Job): Promise<void> => {
    const current = { ...config, signal: job.controller.signal };
    let result: EngineResult;
    try {
      usedBrowser = true;
      if (job.name === `${PREFIX}batch`) {
        const { steps } = job.args as { steps: Array<{ action: string; args: Record<string, unknown> }> };
        const mapper: typeof commandForTool = (call, mode, domains, timeout) => {
          if (["get_title", "get_url"].includes(call.name)) return [["get", call.name.slice(4)]];
          return commandForTool(call, mode, domains, timeout);
        };
        const trace = await replayWorkflow({ version: 1, steps }, current, null,
          (call, replayConfig) => execute(call.name, call.args, replayConfig), mapper);
        result = { success: true, data: { steps: trace.length, results: trace.map((entry) => entry.result) } };
      } else {
        result = await execute(job.name.slice(PREFIX.length), job.args, current);
      }
    } catch (error) {
      const details = error as { artifacts?: unknown; completed?: unknown };
      result = {
        success: false, error: error instanceof Error ? error.message : "Tool failed",
        ...(details.artifacts ? { artifacts: details.artifacts } : {}),
        ...(typeof details.completed === "number" ? { completed: details.completed } : {}),
      };
    }
    // A cancelled request gets no response; its action may or may not have completed.
    if (job.cancelled) return;
    const data = result.data as { title?: unknown; url?: unknown; path?: unknown } | undefined;
    const plain = job.name === `${PREFIX}get_title` ? data?.title
      : job.name === `${PREFIX}get_url` ? data?.url : undefined;
    const content: Array<Record<string, unknown>> = [{ type: "text", text: typeof plain === "string" ? plain : JSON.stringify(result) }];
    const image = job.name === `${PREFIX}screenshot` ? data?.path
      : (result.artifacts as { screenshot?: unknown } | undefined)?.screenshot;
    if (typeof image === "string") {
      const bytes = await readFile(image).catch(() => null);
      if (bytes && bytes.length < 1_000_000) content.push({ type: "image", data: bytes.toString("base64"), mimeType: "image/png" });
    }
    await send({ jsonrpc: "2.0", id: job.id, result: { isError: !result.success, structuredContent: result, content } });
  };

  const drain = async (): Promise<void> => {
    while (!outputFailed && (state.running = queue.shift() ?? null)) {
      await runJob(state.running).catch(outputFailure);
    }
    state.running = null;
  };

  const handle = async (line: string): Promise<void> => {
    let request: unknown;
    try { request = JSON.parse(line); }
    catch { await protocolError(null, -32700, "Invalid JSON"); return; }
    if (typeof request !== "object" || request === null || Array.isArray(request)) {
      await protocolError(null, -32600, "Invalid request"); return;
    }
    const message = request as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const { id, method } = message;
    if (message.jsonrpc !== "2.0" || typeof method !== "string" ||
        (id !== undefined && typeof id !== "string" && typeof id !== "number")) {
      await protocolError(null, -32600, "Invalid request"); return;
    }
    if (id === undefined) {
      if (method === "notifications/cancelled") {
        const requestId = (message.params as { requestId?: unknown } | undefined)?.requestId;
        const active = state.running;
        const queued = queue.findIndex((job) => job.id === requestId);
        if (queued !== -1) queue.splice(queued, 1);
        else if (active && active.id === requestId) { active.cancelled = true; active.controller.abort(); }
      }
      return;
    }
    if (method === "initialize") {
      initialized = true;
      const requested = (message.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      await send({ jsonrpc: "2.0", id, result: {
        protocolVersion: typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} }, serverInfo: { name: "agent-fast", version: VERSION },
      } });
      return;
    }
    if (!initialized) { await protocolError(id, -32000, "Initialize the server first"); return; }
    if (method === "ping") { await send({ jsonrpc: "2.0", id, result: {} }); return; }
    if (method === "tools/list") { await send({ jsonrpc: "2.0", id, result: { tools: catalog } }); return; }
    if (method !== "tools/call") { await protocolError(id, -32601, "Unknown method"); return; }
    const params = message.params as { name?: unknown; arguments?: unknown } | undefined;
    if (typeof params?.name !== "string") { await protocolError(id, -32602, "Missing tool name"); return; }
    const validate = validators.get(params.name);
    if (!validate) { await protocolError(id, -32602, "Unknown or disallowed tool"); return; }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!validate(args)) { await protocolError(id, -32602, "Invalid tool arguments"); return; }
    if (params.name === `${PREFIX}batch`) {
      const { steps } = args as { steps: Array<{ action: string; args: Record<string, unknown> }> };
      if (steps.some((step) => !validators.get(`${PREFIX}${step.action}`)?.(step.args))) {
        await protocolError(id, -32602, "Invalid batch action arguments"); return;
      }
    }
    queue.push({ id, name: params.name, args: args as Record<string, unknown>, controller: new AbortController(), cancelled: false });
    if (!state.running) draining = drain();
  };

  try {
    process.stdin.setEncoding("utf8");
    let buffer = "";
    for await (const chunk of process.stdin) {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
          await protocolError(null, -32600, "Request exceeds 1000000 bytes"); return 1;
        }
        if (line.trim()) await handle(line);
        if (stopping) return outputFailed ? 1 : 0;
      }
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        await protocolError(null, -32600, "Request exceeds 1000000 bytes"); return 1;
      }
    }
    await draining;
    return outputFailed ? 1 : 0;
  } catch {
    return stopping && !outputFailed ? 0 : 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    queue.length = 0;
    state.running?.controller.abort();
    await draining;
    if (usedBrowser && !keepOpen) await runEngine(config, ["close"]);
    if (writer) {
      writer.removeListener("error", outputFailure);
      writer.removeListener("exit", outputFailure);
      writer.kill("SIGKILL");
    }
  }
}
