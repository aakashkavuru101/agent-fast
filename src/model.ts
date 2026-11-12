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

const str = { type: "string" };
const locator = {
  target: { ...str, description: "Element ref from the latest snapshot, such as @e1" },
  role: { ...str, description: "Accessible role, such as button or textbox; use with name instead of target" },
  name: { ...str, description: "Exact accessible name shown in the snapshot" },
  nth: { type: "integer", minimum: 0, maximum: 1000, description: "0-based index when several elements share the role and name" },
};

export function toolDefinitions(act: boolean, resultSchema?: Record<string, unknown>) {
  const tools: ToolSpec[] = [
    { name: "open", description: "Navigate to an HTTP(S) URL; over MCP the result includes the new page's tree with refs", properties: { url: str }, required: ["url"] },
    { name: "snapshot", description: "Read the page as a compact accessibility tree with element refs. Iframe content, including cross-origin frames, is included. Set full to also include non-interactive text. Long trees are cut at the output limit; pass a CSS selector such as main, form, table, or [role=dialog] to read one region, with its refs, in fewer tokens.", properties: { full: { type: "boolean" }, selector: str }, required: [] },
    { name: "get_text", description: "Read visible text from the page or a CSS selector", properties: { selector: str }, required: [] },
    { name: "get_state", description: "Read the actual document title and URL in one batch", properties: {}, required: [] },
    { name: "read", description: "Read token-efficient readable page content, optionally after navigating to an HTTP(S) URL", properties: { url: str }, required: [] },
    { name: "back", description: "Navigate back in browser history", properties: {}, required: [] },
    { name: "forward", description: "Navigate forward in browser history", properties: {}, required: [] },
    { name: "reload", description: "Reload the current page", properties: {}, required: [] },
    { name: "tab_new", description: "Open a new browser tab, optionally at an HTTP(S) URL", properties: { url: str }, required: [] },
    { name: "tab_list", description: "List open browser tabs", properties: {}, required: [] },
    { name: "tab_switch", description: "Switch to a tab ref such as t1 or a tab label from tab_list", properties: { target: str }, required: ["target"] },
    { name: "scroll", description: "Scroll the current page", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "number" } }, required: ["direction"] },
    { name: "wait", description: "Wait for a bounded number of milliseconds", properties: { ms: { type: "number", minimum: 1, maximum: 10000 } }, required: ["ms"] },
    { name: "wait_for", description: "Wait for exactly one condition: a selector state, visible text (also inside iframes and shadow DOM), a URL glob such as **/done, or a load state. Pages that keep connections open, such as editors, dashboards, and chat, may never reach networkidle; wait for text or a selector instead.", properties: { selector: str, state: { type: "string", enum: ["visible", "hidden", "attached", "detached"] }, text: str, url: str, load: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] }, timeout: { type: "integer", minimum: 1, maximum: 30000 } }, required: [] },
    { name: "frame", description: "Scope later snapshots and selectors to an iframe by CSS selector or iframe ref (use the ref for cross-origin frames). Use main to return to the main document. Refs from a main-document snapshot already work inside frames without switching.", properties: { target: str }, required: ["target"] },
    { name: "assert_text", description: "Wait until a selector's text exactly matches the expected text; fail explicitly otherwise", properties: { selector: str, text: str, timeout: { type: "integer", minimum: 1, maximum: 30000 } }, required: ["selector", "text"] },
    { name: "screenshot", description: "Save a PNG screenshot of the viewport or the full page and return its file path", properties: { full_page: { type: "boolean" } }, required: [] },
    { name: "console", description: "Read the page's console messages and uncaught errors", properties: {}, required: [] },
    { name: "network", description: "List the page's network requests, optionally filtered by a URL substring", properties: { filter: str }, required: [] },
    { name: "dialog", description: act ? "Inspect, accept, or dismiss a JavaScript confirm/prompt dialog that is blocking the page" : "Inspect or dismiss a JavaScript confirm/prompt dialog that is blocking the page", properties: { action: { type: "string", enum: act ? ["status", "accept", "dismiss"] : ["status", "dismiss"] }, text: { ...str, description: "Prompt text when accepting" } }, required: ["action"] },
  ];
  if (act) {
    tools.push(
      { name: "click", description: "Click an element by ref, or by role and name (works inside frames)", properties: { ...locator, double: { type: "boolean" } }, required: [] },
      { name: "fill", description: "Replace a field's value; locate it by ref, or by role and name", properties: { ...locator, text: str }, required: ["text"] },
      { name: "type", description: "Type text with real keystrokes into the focused element, or into an element located by ref or role and name, without clearing it first. Use for rich editors and comboboxes that ignore fill.", properties: { ...locator, text: str }, required: ["text"] },
      { name: "hover", description: "Move the pointer over an element to reveal menus or tooltips", properties: locator, required: [] },
      { name: "check", description: "Set a checkbox, switch, or radio to checked (default) or unchecked", properties: { ...locator, checked: { type: "boolean" } }, required: [] },
      { name: "drag", description: "Drag one element ref onto another", properties: { source: str, target: str }, required: ["source", "target"] },
      { name: "click_at", description: "Click at viewport coordinates in CSS pixels (equal to screenshot pixels in headless mode). Use only for canvas content or deeply nested frames that have no refs.", properties: { x: { type: "integer", minimum: 0, maximum: 10000 }, y: { type: "integer", minimum: 0, maximum: 10000 } }, required: ["x", "y"] },
      { name: "drag_at", description: "Drag between two viewport coordinates in CSS pixels, for canvas content that has no refs", properties: { from_x: { type: "integer", minimum: 0, maximum: 10000 }, from_y: { type: "integer", minimum: 0, maximum: 10000 }, to_x: { type: "integer", minimum: 0, maximum: 10000 }, to_y: { type: "integer", minimum: 0, maximum: 10000 } }, required: ["from_x", "from_y", "to_x", "to_y"] },
      { name: "click_text", description: "Click an element by exact visible text (also inside iframes) when refs are stale", properties: { text: str }, required: ["text"] },
      { name: "fill_label", description: "Fill a field by its accessible label", properties: { label: str, text: str }, required: ["label", "text"] },
      { name: "tab_close", description: "Close the current tab or a tab ref/label from tab_list", properties: { target: str }, required: [] },
      { name: "auth_login", description: "Log in using a named engine auth-vault profile without exposing credentials", properties: { profile: str }, required: ["profile"] },
      { name: "press", description: "Press a keyboard key or chord, such as Enter or Control+a", properties: { key: str }, required: ["key"] },
      { name: "select", description: "Select an option in a native dropdown by value or visible label", properties: { selector: str, value: str }, required: ["selector", "value"] },
      { name: "upload", description: "Attach files from the configured upload directory to a file input ref", properties: { target: str, files: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", minLength: 1, maxLength: 255 } } }, required: ["target", "files"] },
      { name: "download", description: "Click an element ref and save the resulting download in the configured download directory", properties: { target: str }, required: ["target"] },
    );
  }
  const definitions = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", properties: Object.fromEntries(Object.entries(tool.properties).map(([key, schema]) => [
        key, (schema as { type?: string }).type === "string"
          // Filling an empty string clears a field.
          ? { ...(schema as object), minLength: key === "text" ? 0 : 1, maxLength: key === "selector" || key === "label" ? 1000 : 10000 }
          : schema,
      ])), required: tool.required, additionalProperties: false },
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
    const request = JSON.stringify({
      model: this.config.model,
      messages,
      tools: toolDefinitions(act, resultSchema),
      tool_choice: "auto",
      parallel_tool_calls: true,
      temperature: 0,
      // Room for a reasoning model's thinking plus its tool calls.
      max_tokens: 4096,
      stream: false,
    });
    let body = "";
    for (let attempt = 1; ; attempt++) {
      // Local model servers drop requests while loading; retry transient failures only.
      try {
        const response = await fetch(this.config.endpoint, {
          method: "POST", headers, body: request, signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        body = await response.text();
        if (response.ok) break;
        if (attempt >= 3 || (response.status < 500 && response.status !== 429)) {
          throw Object.assign(new Error(`model returned ${response.status}: ${body.slice(0, 2000)}`), { final: true });
        }
      } catch (error) {
        // A timeout is not transient: the model needs longer than it is allowed, and retrying triples the wait.
        if ((error as { name?: string }).name === "TimeoutError") {
          throw new Error(`model did not reply within ${this.config.timeoutMs} ms; raise --model-timeout or use a faster model`);
        }
        if (attempt >= 3 || (error as { final?: boolean }).final) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
    let payload: {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{
        id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> }
      }> } }>;
    };
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      throw new Error(`model returned a non-JSON response: ${body.slice(0, 500)}`);
    }
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("model returned no message");
    const calls: ToolCall[] = [];
    for (const [index, call] of (message.tool_calls ?? []).entries()) {
      if (!call.function?.name) continue;
      // Small models emit malformed arguments; report that to the model instead of ending the run.
      let args: unknown;
      let invalid: string | undefined;
      try {
        const raw = call.function.arguments;
        args = typeof raw === "string" ? JSON.parse(raw.trim() || "{}") : raw ?? {};
        if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("not an object");
      } catch {
        args = {};
        invalid = "tool arguments were not a valid JSON object; send the call again with valid JSON arguments";
      }
      calls.push({
        id: call.id ?? `call_${index}`,
        name: call.function.name,
        args: args as Record<string, unknown>,
        ...(invalid ? { invalid } : {}),
      });
    }
    if (calls.length === 0 && message.content) {
      // Small models often write the tool call as JSON text instead of using the tool-call field.
      try {
        const start = message.content.indexOf("{");
        const written = JSON.parse(message.content.slice(start, message.content.lastIndexOf("}") + 1)) as {
          name?: unknown; arguments?: unknown; parameters?: unknown;
        };
        const args = written.arguments ?? written.parameters;
        if (start !== -1 && typeof written.name === "string" && typeof args === "object" && args !== null && !Array.isArray(args) &&
            toolDefinitions(act, resultSchema).some((tool) => tool.function.name === written.name)) {
          calls.push({ id: "call_text", name: written.name, args: args as Record<string, unknown> });
        }
      } catch { /* ordinary prose */ }
    }
    return { content: message.content ?? null, calls };
  }
}
