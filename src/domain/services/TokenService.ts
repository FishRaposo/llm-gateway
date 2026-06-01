/** Domain service for token counting.
 * Pure business logic with no external dependencies.
 */

import type { Message } from "../models/Request";

// Simple character-based heuristic
// In production, this would use tiktoken or gpt-tokenizer
export function estimateTokens(text: string): number {
  // Rough approximation: 4 characters ≈ 1 token
  return Math.ceil(text.length / 4);
}

export function countMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
}

export function countTotalTokens(
  messages: Message[],
  responseContent: string
): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const promptTokens = countMessageTokens(messages);
  const completionTokens = estimateTokens(responseContent);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}
