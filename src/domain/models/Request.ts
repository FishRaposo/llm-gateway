/** Domain model for LLM gateway requests.
 * Pure business entity with no external dependencies.
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
}

export interface ChatRequest {
  requestId: string;
  apiKey: string;
  apiKeyName: string;
  permissions: string[];
  originalModel: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export function validateChatRequest(request: unknown): ChatRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Request must be an object");
  }

  const r = request as Record<string, unknown>;

  if (!Array.isArray(r.messages) || r.messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }

  if (r.messages.length > 100) {
    throw new Error("messages array exceeds maximum of 100 items");
  }

  for (const msg of r.messages) {
    if (!msg || typeof msg !== "object") {
      throw new Error("Each message must be an object");
    }
    const m = msg as Record<string, unknown>;
    if (!m.role || typeof m.content !== "string") {
      throw new Error("Each message must have a 'role' and 'content' string");
    }
    if (m.content.length > 100_000) {
      throw new Error("Each message 'content' must not exceed 100KB");
    }
  }

  const systemMsg = r.messages.find((m: unknown) => {
    const msg = m as Record<string, unknown>;
    return msg.role === "system";
  }) as { content: string } | undefined;

  if (systemMsg && systemMsg.content.length > 10_000) {
    throw new Error("System message content must not exceed 10KB");
  }

  return {
    requestId: String(r.requestId || ""),
    apiKey: String(r.apiKey || ""),
    apiKeyName: String(r.apiKeyName || ""),
    permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : [],
    originalModel: String(r.originalModel || "gpt-4o-mini"),
    messages: r.messages as Message[],
    temperature: typeof r.temperature === "number" ? r.temperature : undefined,
    maxTokens: typeof r.maxTokens === "number" ? r.maxTokens : undefined,
    stream: Boolean(r.stream),
    metadata: (r.metadata as Record<string, unknown>) || {},
    timestamp: String(r.timestamp || new Date().toISOString()),
  };
}
