import Anthropic from "@anthropic-ai/sdk";
import type { ModelConfig, ModelMessage, ModelReply, ToolDefinition } from "./types.js";

const image = (data: string): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });

/** The run loop keeps its history in chat-completions shape; this maps one turn onto the Messages API. */
export async function completeAnthropic(config: ModelConfig, messages: ModelMessage[], definitions: ToolDefinition[]): Promise<ModelReply> {
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.endpoint, timeout: config.timeoutMs });
  const params: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      params.push({ role: "user", content: message.content ?? "" });
    } else if (message.role === "assistant") {
      // The model's own blocks (thinking included) go back unchanged; a reply from another provider is rebuilt.
      const content = (message.blocks as Anthropic.ContentBlockParam[] | undefined) ?? [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...(message.tool_calls ?? []).map((call): Anthropic.ToolUseBlockParam => ({
          type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || "{}") as Record<string, unknown>,
        })),
      ];
      if (content.length > 0) params.push({ role: "assistant", content });
    } else {
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result", tool_use_id: message.tool_call_id ?? "", content: [{ type: "text", text: message.content ?? "" }, ...(message.images ?? []).map(image)],
      };
      // Every result of one assistant turn travels in a single user message.
      const last = params.at(-1);
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") (last.content as Anthropic.ContentBlockParam[]).push(block);
      else params.push({ role: "user", content: [block] });
    }
  }
  // History is never edited, so everything up to the newest block is a cache hit next turn.
  const last = params.at(-1);
  if (last && Array.isArray(last.content) && last.content.length > 0) Object.assign(last.content.at(-1)!, { cache_control: { type: "ephemeral" } });
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 16000,
    system: messages.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n\n"),
    messages: params,
    tools: definitions.map((tool): Anthropic.Tool => ({
      name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
    })),
  });
  if (response.stop_reason === "refusal") throw new Error(`model declined the request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}`);
  const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("\n");
  return {
    content: text || null,
    calls: response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, args: block.input as Record<string, unknown> })),
    blocks: response.content,
  };
}
