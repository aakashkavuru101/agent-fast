import type { ModelConfig, ModelMessage, ToolCall } from "./types.js";

interface ModelReply {
  content: string | null;
  calls: ToolCall[];
}

interface ToolSpec {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required: string[];
}

export function toolDefinitions(act: boolean, resultSchema?: Record<string, unknown>): unknown[] {
  const tools: ToolSpec[] = [
    { name: "open", description: "Navigate to an HTTP(S) URL", properties: { url: { type: "string" } }, required: ["url"] },
    { name: "snapshot", description: "Read the current page as a compact accessibility tree with element refs", properties: {}, required: [] },
    { name: "get_text", description: "Read visible text from the page or a CSS selector", properties: { selector: { type: "string" } }, required: [] },
    { name: "get_state", description: "Read the actual document title and URL in one batch", properties: {}, required: [] },
    { name: "read", description: "Read token-efficient readable page content, optionally from an HTTP(S) URL", properties: { url: { type: "string" } }, required: [] },
    { name: "back", description: "Navigate back in browser history", properties: {}, required: [] },
    { name: "forward", description: "Navigate forward in browser history", properties: {}, required: [] },
    { name: "reload", description: "Reload the current page", properties: {}, required: [] },
    { name: "tab_new", description: "Open a new browser tab, optionally at an HTTP(S) URL", properties: { url: { type: "string" } }, required: [] },
    { name: "tab_list", description: "List open browser tabs", properties: {}, required: [] },
    { name: "tab_switch", description: "Switch to a tab ref such as t1 or a tab label from tab_list", properties: { target: { type: "string" } }, required: ["target"] },
    { name: "scroll", description: "Scroll the current page", properties: { direction: { type: "string", enum: ["up", "down"] }, amount: { type: "number" } }, required: ["direction"] },
    { name: "wait", description: "Wait for a bounded number of milliseconds", properties: { ms: { type: "number", minimum: 1, maximum: 10000 } }, required: ["ms"] },
  ];
  if (act) {
    tools.push(
      { name: "click", description: "Click an element ref such as @e1 from the latest snapshot", properties: { target: { type: "string" } }, required: ["target"] },
      { name: "fill", description: "Replace a field's value using its element ref", properties: { target: { type: "string" }, text: { type: "string" } }, required: ["target", "text"] },
      { name: "click_text", description: "Click an element by exact visible text when refs are stale", properties: { text: { type: "string" } }, required: ["text"] },
      { name: "fill_label", description: "Fill a field by its accessible label", properties: { label: { type: "string" }, text: { type: "string" } }, required: ["label", "text"] },
      { name: "tab_close", description: "Close the current tab or a tab ref/label from tab_list", properties: { target: { type: "string" } }, required: [] },
      { name: "auth_login", description: "Log in using a named engine auth-vault profile without exposing credentials", properties: { profile: { type: "string" } }, required: ["profile"] },
    );
  }
  const definitions = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", properties: tool.properties, required: tool.required, additionalProperties: false },
    },
  }));
  definitions.push({
    type: "function",
    function: {
      name: "done",
      description: "Finish with a concise answer and observed evidence",
      parameters: {
        type: "object",
        properties: resultSchema ? { answer: { type: "string" }, result: resultSchema } : { answer: { type: "string" } },
        required: resultSchema ? ["answer", "result"] : ["answer"],
        additionalProperties: false,
      },
    },
  });
  return definitions;
}

export class ModelClient {
  constructor(private readonly config: ModelConfig) {}

  async complete(messages: ModelMessage[], act: boolean, resultSchema?: Record<string, unknown>): Promise<ModelReply> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        tools: toolDefinitions(act, resultSchema),
        tool_choice: "auto",
        parallel_tool_calls: true,
        temperature: 0,
        max_tokens: 1600,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`model returned ${response.status}: ${body.slice(0, 2000)}`);
    }
    const payload = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{
        id?: string; function?: { name?: string; arguments?: string }
      }> } }>;
    };
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("model returned no message");
    const calls: ToolCall[] = [];
    for (const [index, call] of (message.tool_calls ?? []).entries()) {
      if (!call.function?.name) continue;
      const args = JSON.parse(call.function.arguments || "{}") as unknown;
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new Error("model tool arguments must be an object");
      }
      calls.push({
        id: call.id ?? `call_${index}`,
        name: call.function.name,
        args: args as Record<string, unknown>,
      });
    }
    return { content: message.content ?? null, calls };
  }
}
