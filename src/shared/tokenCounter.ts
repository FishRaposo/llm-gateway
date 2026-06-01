/** Token counting utility using gpt-tokenizer for accurate budget pre-checks.
 *
 * Falls back to a character-based heuristic when the tokenizer is unavailable.
 */

import { encode } from "gpt-tokenizer";

function getEncoder(): ((text: string) => number[]) | null {
  return encode;
}

/**
 * Counts tokens in a text string.
 * @param text - The text to tokenize.
 * @returns Token count.
 */
export function countTokens(text: string): number {
  const encode = getEncoder();
  if (encode) {
    try {
      return encode(text).length;
    } catch {
      // fall through to heuristic
    }
  }
  // Fallback heuristic: ~4 chars per token
  return Math.ceil(text.length / 4);
}

/**
 * Counts total tokens in an array of messages.
 * @param messages - Array of messages with content.
 * @returns Total token count.
 */
export function countMessageTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, m) => sum + countTokens(m.content), 0);
}
