/** Domain model for LLM gateway responses.
 * Pure business entity with no external dependencies.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finishReason: string;
  }>;
  usage: TokenUsage;
  provider: string;
  cacheHit: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface StreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
    };
    finishReason: string | null;
  }>;
}
