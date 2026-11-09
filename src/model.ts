import type { ModelConfig, ModelMessage, ToolCall } from "./types.js";

interface ModelReply {
  content: string | null;
  calls: ToolCall[];
}

function toolDefinitions(act: boolean): unknown[] {
  const tools = [
    ["open", "Navigate to an HTTP(S) URL", { url: { type: "string" } }, ["url"]],
    ["snapshot", "Read the current page as a compact accessibility tree with element refs", {}, []],
    ["get_text", "Read visible text from the page or a CSS selector", { selector: { type: "string" } }, []],
    ["get_state", "Read the actual document title and URL, which may differ from visible headings", {}, []],
    ["scroll", "Scroll the current page", { direction: { type: "string", enum: ["up", "down"] }, amount: { type: "number" } }, ["direction"]],
    ["wait", "Wait for a bounded number of milliseconds", { ms: { type: "number", minimum: 1, maximum: 10000 } }, ["ms"]],
  ];
  if (act) {
    tools.push(
      ["click", "Click an element ref such as @e1 from the latest snapshot", { target: { type: "string" } }, ["target"]],
      ["fill", "Replace a field's value using its element ref", { target: { type: "string" }, text: { type: "string" } }, ["target", "text"]],
    );
  }
  const definitions = tools.map(([name, description, properties, required]) => ({
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  }));
  definitions.push({
    type: "function",
    function: {
      name: "done",
      description: "Finish with a concise answer and the observed evidence for it",
      parameters: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    },
  });
  return definitions;
}

export class ModelClient {
  constructor(private readonly config: ModelConfig) {}

  async complete(messages: ModelMessage[], act: boolean): Promise<ModelReply> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        tools: toolDefinitions(act),
        tool_choice: "auto",
        parallel_tool_calls: false,
        temperature: 0,
        max_tokens: 1200,
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
