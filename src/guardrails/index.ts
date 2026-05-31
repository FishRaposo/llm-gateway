/** Content guardrails engine for LLM Gateway.
 *
 * Evaluates requests against PII, prompt injection, topic blocking,
 * and toxicity rules. Designed to be extensible: swap regex heuristics
 * for ML model calls in production.
 */

import type { PolicyDecision } from "../types/policy";

export interface GuardrailCheck {
  name: string;
  passed: boolean;
  severity: "critical" | "warning" | "info";
  reason?: string;
  matched?: string;
}

export interface GuardrailResult {
  allowed: boolean;
  checks: GuardrailCheck[];
  sanitized?: string;
}

export interface GuardrailConfig {
  blockedTopics?: string[];
  blockedPatterns?: RegExp[];
  piiAction?: "deny" | "flag" | "sanitize";
  promptInjectionCheck?: boolean;
  toxicityThreshold?: number;
  maxPromptLength?: number;
}

/** Default production guardrail configuration. */
export const defaultGuardrailConfig: GuardrailConfig = {
  blockedTopics: ["malware", "exploit", "bomb", "poison"],
  blockedPatterns: [],
  piiAction: "flag",
  promptInjectionCheck: true,
  toxicityThreshold: 0.85,
  maxPromptLength: 16000,
};

// ─── PII Detection ───────────────────────────────────────────────

const PII_PATTERNS: Record<string, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

function detectPii(text: string): { type: string; match: string }[] {
  const findings: { type: string; match: string }[] = [];
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        findings.push({ type, match: m });
      }
    }
  }
  return findings;
}

// ─── Prompt Injection Detection ──────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /(?:forget|disregard)\s+(?:all\s+)?(?:your\s+)?(?:training|instructions|rules)/i,
  /(?:system|developer)\s*:\s*\n/i,
  /\n\n<\|[a-z_]+\|>/i,
  /DAN\s*\(|do\s+anything\s+now/i,
  /jailbreak|prompt\s*leak/i,
  /you\s+are\s+now\s+(?:an?\s+)?(?:unrestricted?|uncensored?)/i,
];

function detectPromptInjection(text: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// ─── Topic Blocking ────────────────────────────────────────────

function detectBlockedTopics(
  text: string,
  topics: string[]
): { topic: string; match: string } | null {
  const lower = text.toLowerCase();
  for (const topic of topics) {
    // Simple boundary-aware matching; production would use embeddings
    const pattern = new RegExp(`\\b${topic.replace(/[-\s]/g, "[-\\s]?")}\\b`, "i");
    const match = lower.match(pattern);
    if (match) return { topic, match: match[0] };
  }
  return null;
}

// ─── Toxicity Heuristic ──────────────────────────────────────────

const TOXIC_WORDS = [
  "kill", "die", "murder", "rape", "torture", "genocide", "terrorist",
];

function toxicityScore(text: string): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const word of TOXIC_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lower.match(re);
    if (matches) hits += matches.length;
  }
  // Simple heuristic: each hit contributes ~0.25 to score, capped at 1.0
  return Math.min(hits * 0.25, 1.0);
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Evaluate a prompt against all configured guardrails.
 *
 * @param prompt - The user prompt to evaluate.
 * @param config - Guardrail configuration.
 * @returns GuardrailResult with allow/deny decision and detailed checks.
 */
export function evaluateGuardrails(
  prompt: string,
  config: GuardrailConfig = defaultGuardrailConfig
): GuardrailResult {
  const checks: GuardrailCheck[] = [];
  let allowed = true;
  let sanitized = prompt;

  // Length check
  if (config.maxPromptLength && prompt.length > config.maxPromptLength) {
    checks.push({
      name: "max_length",
      passed: false,
      severity: "critical",
      reason: `Prompt length ${prompt.length} exceeds max ${config.maxPromptLength}`,
    });
    allowed = false;
  }

  // PII check
  const piiFindings = detectPii(prompt);
  if (piiFindings.length > 0) {
    const first = piiFindings[0];
    if (config.piiAction === "deny") {
      allowed = false;
      checks.push({
        name: "pii_detection",
        passed: false,
        severity: "critical",
        reason: `Detected ${first.type}: ${first.match.slice(0, 10)}...`,
        matched: first.match,
      });
    } else if (config.piiAction === "sanitize") {
      for (const finding of piiFindings) {
        sanitized = sanitized.replace(finding.match, `[${finding.type.toUpperCase()}]`);
      }
      checks.push({
        name: "pii_sanitization",
        passed: true,
        severity: "info",
        reason: `Sanitized ${piiFindings.length} PII instance(s)`,
      });
    } else {
      // flag
      checks.push({
        name: "pii_detection",
        passed: true,
        severity: "warning",
        reason: `Flagged ${piiFindings.length} PII instance(s)`,
      });
    }
  } else {
    checks.push({ name: "pii_detection", passed: true, severity: "info" });
  }

  // Prompt injection check
  if (config.promptInjectionCheck) {
    const injection = detectPromptInjection(prompt);
    if (injection) {
      allowed = false;
      checks.push({
        name: "prompt_injection",
        passed: false,
        severity: "critical",
        reason: "Possible prompt injection pattern detected",
        matched: injection.slice(0, 100),
      });
    } else {
      checks.push({ name: "prompt_injection", passed: true, severity: "info" });
    }
  }

  // Topic blocking
  const blockedTopics = config.blockedTopics ?? [];
  if (blockedTopics.length > 0) {
    const topicMatch = detectBlockedTopics(prompt, blockedTopics);
    if (topicMatch) {
      allowed = false;
      checks.push({
        name: "topic_blocking",
        passed: false,
        severity: "critical",
        reason: `Blocked topic: ${topicMatch.topic}`,
        matched: topicMatch.match,
      });
    } else {
      checks.push({ name: "topic_blocking", passed: true, severity: "info" });
    }
  }

  // Custom pattern blocking
  const blockedPatterns = config.blockedPatterns ?? [];
  for (const pattern of blockedPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      allowed = false;
      checks.push({
        name: "custom_pattern",
        passed: false,
        severity: "critical",
        reason: `Matched custom blocked pattern`,
        matched: match[0].slice(0, 100),
      });
      break;
    }
  }
  if (!checks.some((c) => c.name === "custom_pattern" && !c.passed)) {
    checks.push({ name: "custom_pattern", passed: true, severity: "info" });
  }

  // Toxicity
  if (config.toxicityThreshold !== undefined) {
    const score = toxicityScore(prompt);
    if (score >= config.toxicityThreshold) {
      allowed = false;
      checks.push({
        name: "toxicity",
        passed: false,
        severity: "critical",
        reason: `Toxicity score ${score.toFixed(2)} exceeds threshold ${config.toxicityThreshold}`,
      });
    } else {
      checks.push({
        name: "toxicity",
        passed: true,
        severity: "info",
        reason: `Toxicity score ${score.toFixed(2)} < ${config.toxicityThreshold}`,
      });
    }
  }

  const result: GuardrailResult = { allowed, checks };
  if (sanitized !== prompt) {
    result.sanitized = sanitized;
  }
  return result;
}

/**
 * Convert guardrail result to the gateway's PolicyDecision type.
 */
export function toPolicyDecision(result: GuardrailResult): PolicyDecision {
  if (result.allowed) {
    if (result.sanitized) {
      return {
        allowed: true,
        reason: "Request passed guardrails after sanitization",
        modifiedRequest: { prompt: result.sanitized },
      };
    }
    return { allowed: true, reason: "Request passed all guardrails" };
  }
  const failed = result.checks.filter((c) => !c.passed);
  return {
    allowed: false,
    reason: failed.map((c) => `${c.name}: ${c.reason}`).join("; "),
    matchedRule: failed[0]?.name,
  };
}
