export type PolicyMode = "read-only" | "act";

export interface RuntimeConfig {
  session: string;
  policy: PolicyMode;
  allowedDomains: string[];
  executablePath?: string;
  headed: boolean;
  maxOutput: number;
  timeoutMs: number;
  /** Chrome profile directory that keeps sign-in state between sessions. */
  profile?: string;
  /** Screenshots and recordings are written here; never to a caller-chosen path. */
  artifactsDir?: string;
  /** Uploads are limited to files inside this directory. Unset disables upload. */
  uploadDir?: string;
  /** Downloads are saved inside this directory. Unset disables download. */
  downloadDir?: string;
  /** Cancels the engine command currently in flight. */
  signal?: AbortSignal;
}

export interface EngineResult {
  success: boolean;
  data?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface ModelConfig {
  model: string;
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface AgentOptions {
  task: string;
  act: boolean;
  maxSteps: number;
  keepOpen: boolean;
  schema?: Record<string, unknown>;
  saveFlow?: string;
  /** Let the model navigate to any public site instead of only the sites named in the task. */
  openWeb?: boolean;
  /** Record a video of the run into the artifacts directory. */
  record?: boolean;
}

export interface TraceEntry {
  step: number;
  action: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentRunResult {
  status: "completed" | "failed" | "limit_reached";
  answer: string;
  steps: number;
  trace: TraceEntry[];
  result?: unknown;
  evidence?: {
    url: string | null;
    title: string | null;
  };
  /** Files captured for debugging: a failure screenshot and, when requested, a video. */
  artifacts?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Set when the model's arguments could not be parsed. */
  invalid?: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  /** Base64 PNGs that accompany a tool result: a screenshot, or the page after a failed lookup. */
  images?: string[];
  /** The provider's own reply blocks, sent back unchanged on the next turn. */
  blocks?: unknown;
}

export interface ModelReply {
  content: string | null;
  calls: ToolCall[];
  blocks?: unknown;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
