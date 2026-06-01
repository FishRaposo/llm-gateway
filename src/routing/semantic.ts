/** Deterministic local semantic router.
 *
 * Classifies prompt complexity/topic without external embeddings.
 * Routes simple queries to cheap models and complex queries to powerful ones.
 * Caches classifications in memory.
 */

export type Complexity = "simple" | "medium" | "complex";

interface ClassificationResult {
  complexity: Complexity;
  topic: string;
  confidence: number;
}

const COMPLEX_KEYWORDS = [
  "debug", "analyze", "compare", "evaluate", "architecture", "refactor",
  "optimize", "synthesize", "critique", "explain in detail", "deep dive",
  "reasoning", "chain of thought", "step by step",
];

const SIMPLE_KEYWORDS = [
  "hello", "hi", "yes", "no", "thanks", "bye", "ok", "sure",
  "what is", "who is", "when", "where", "how are you",
];

const classificationCache = new Map<string, ClassificationResult>();
const CACHE_MAX_SIZE = 1000;

function computeComplexity(prompt: string): Complexity {
  const lower = prompt.toLowerCase();
  let complexScore = 0;
  let simpleScore = 0;

  for (const kw of COMPLEX_KEYWORDS) {
    if (lower.includes(kw)) complexScore++;
  }
  for (const kw of SIMPLE_KEYWORDS) {
    if (lower.includes(kw)) simpleScore++;
  }

  const lengthScore = prompt.length > 500 ? 1 : 0;
  const wordCount = prompt.split(/\s+/).length;
  const wordScore = wordCount > 100 ? 1 : 0;

  const totalComplex = complexScore + lengthScore + wordScore;
  const totalSimple = simpleScore;

  if (totalComplex >= 2) return "complex";
  if (totalSimple >= 1 && totalComplex === 0) return "simple";
  return "medium";
}

function extractTopic(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("code") || lower.includes("programming") || lower.includes("function") || lower.includes("debug")) return "code";
  if (lower.includes("math") || lower.includes("calculate")) return "math";
  if (lower.includes("write") || lower.includes("essay")) return "writing";
  if (lower.includes("translate")) return "translation";
  return "general";
}

/**
 * Classifies a prompt into complexity and topic.
 * Results are cached for performance.
 * @param prompt - The user prompt to classify.
 * @returns Classification result.
 */
export function classifyPrompt(prompt: string): ClassificationResult {
  const cacheKey = prompt.slice(0, 200);
  const cached = classificationCache.get(cacheKey);
  if (cached) return cached;

  const complexity = computeComplexity(prompt);
  const topic = extractTopic(prompt);

  let confidence = 0.5;
  if (complexity === "simple") confidence = 0.7;
  if (complexity === "complex") confidence = 0.75;

  const result: ClassificationResult = { complexity, topic, confidence };

  if (classificationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = classificationCache.keys().next().value;
    if (firstKey !== undefined) {
      classificationCache.delete(firstKey);
    }
  }
  classificationCache.set(cacheKey, result);
  return result;
}

/**
 * Selects a model based on semantic classification.
 * @param classification - Result from classifyPrompt.
 * @param availableModels - List of available model identifiers.
 * @returns Recommended model identifier.
 */
export function selectModelForClassification(
  classification: ClassificationResult,
  availableModels: string[]
): string {
  if (availableModels.length === 0) return "gpt-4o-mini";

  const cheapModels = availableModels.filter((m) =>
    m.includes("mini") || m.includes("3.5") || m.includes("haiku")
  );
  const powerfulModels = availableModels.filter((m) =>
    (m.includes("4o") || m.includes("claude-opus") || m.includes("gpt-4")) && !m.includes("mini")
  );

  if (classification.complexity === "simple" && cheapModels.length > 0) {
    return cheapModels[0];
  }
  if (classification.complexity === "complex" && powerfulModels.length > 0) {
    return powerfulModels[0];
  }
  return availableModels[0];
}

/** Clears the classification cache. Useful for testing. */
export function clearClassificationCache(): void {
  classificationCache.clear();
}
