import type { ProviderUsage } from "../types/provider";

/** Token counts are bounded, nonnegative integers; finite alone is insufficient. */
export function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isValidUsage(value: unknown): value is ProviderUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as ProviderUsage;
  return isTokenCount(usage.promptTokens) && isTokenCount(usage.completionTokens)
    && isTokenCount(usage.totalTokens)
    && usage.totalTokens >= usage.promptTokens + usage.completionTokens;
}

/** Placeholders remain explicitly unknown and never become a measured zero bill. */
export function normalizeUsage(promptTokens: unknown, completionTokens: unknown, totalTokens: unknown): {
  usage: ProviderUsage; usageKnown: boolean;
} {
  const candidate = { promptTokens, completionTokens, totalTokens };
  return isValidUsage(candidate)
    ? { usage: candidate, usageKnown: true }
    : { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, usageKnown: false };
}
