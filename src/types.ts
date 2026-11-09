export type PolicyMode = "read-only" | "act";

export interface RuntimeConfig {
  session: string;
  policy: PolicyMode;
  allowedDomains: string[];
  executablePath?: string;
  headed: boolean;
  maxOutput: number;
  timeoutMs: number;
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
  evidence?: {
    url: string | null;
    title: string | null;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
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
}
