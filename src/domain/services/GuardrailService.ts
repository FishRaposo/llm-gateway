/** Domain service for guardrail evaluation.
 * Pure business logic with no external dependencies.
 */

export interface GuardrailCheck {
  name: string;
  passed: boolean;
  severity: "critical" | "warning" | "info";
  reason?: string;
}

export interface GuardrailResult {
  allowed: boolean;
  checks: GuardrailCheck[];
  sanitized?: string;
}

// PII patterns
const PII_PATTERNS: Record<string, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
};

// Prompt injection patterns
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /(?:forget|disregard)\s+(?:all\s+)?(?:your\s+)?(?:training|instructions|rules)/i,
  /(?:system|developer)\s*:\s*\n/i,
  /DAN\s*\(|do\s+anything\s+now/i,
];

// Toxic words
const TOXIC_WORDS = ["kill", "die", "murder", "rape", "torture", "genocide", "terrorist"];

// Blocked topics
const BLOCKED_TOPICS = ["malware", "exploit", "bomb", "poison"];

export interface GuardrailConfig {
  maxLength?: number;
  blockedTopics?: string[];
  blockedPatterns?: RegExp[];
  piiAction?: "deny" | "flag" | "sanitize";
  toxicityThreshold?: number;
  promptInjectionCheck?: boolean;
}

export function evaluateGuardrails(
  prompt: string,
  config: GuardrailConfig = {}
): GuardrailResult {
  const checks: GuardrailCheck[] = [];
  let allowed = true;
  let sanitized = prompt;

  // Length check
  if (config.maxLength && prompt.length > config.maxLength) {
    checks.push({
      name: "max_length",
      passed: false,
      severity: "critical",
      reason: `Prompt length ${prompt.length} exceeds max ${config.maxLength}`,
    });
    allowed = false;
  }

  // PII check
  const piiFindings: Array<{ type: string; match: string }> = [];
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = prompt.match(pattern);
    if (matches) {
      for (const match of matches) {
        piiFindings.push({ type, match });
      }
    }
  }

  if (piiFindings.length > 0) {
    const piiAction = config.piiAction ?? "flag";
    if (piiAction === "deny") {
      allowed = false;
      checks.push({
        name: "pii_detection",
        passed: false,
        severity: "critical",
        reason: `Detected ${piiFindings.length} PII instance(s)`,
      });
    } else if (piiAction === "sanitize") {
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
      checks.push({
        name: "pii_detection",
        passed: true,
        severity: "warning",
        reason: `Flagged ${piiFindings.length} PII instance(s)`,
      });
    }
  }

  // Prompt injection check
  if (config.promptInjectionCheck !== false) {
    for (const pattern of INJECTION_PATTERNS) {
      const match = prompt.match(pattern);
      if (match) {
        allowed = false;
        checks.push({
          name: "prompt_injection",
          passed: false,
          severity: "critical",
          reason: "Possible prompt injection pattern detected",
        });
        break;
      }
    }
  }

  // Blocked topics check
  const blockedTopics = config.blockedTopics ?? BLOCKED_TOPICS;
  const lowerPrompt = prompt.toLowerCase();
  for (const topic of blockedTopics) {
    const pattern = new RegExp(`\\b${topic.replace(/[-\s]/g, "[-\\s]?")}\\b`, "i");
    if (pattern.test(lowerPrompt)) {
      allowed = false;
      checks.push({
        name: "topic_blocking",
        passed: false,
        severity: "critical",
        reason: `Blocked topic: ${topic}`,
      });
      break;
    }
  }

  // Custom patterns check
  const blockedPatterns = config.blockedPatterns ?? [];
  for (const pattern of blockedPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      allowed = false;
      checks.push({
        name: "custom_pattern",
        passed: false,
        severity: "critical",
        reason: "Matched custom blocked pattern",
      });
      break;
    }
  }

  // Toxicity check
  const toxicityThreshold = config.toxicityThreshold ?? 0.85;
  let hits = 0;
  for (const word of TOXIC_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lowerPrompt.match(re);
    if (matches) hits += matches.length;
  }
  const score = Math.min(hits * 0.25, 1.0);

  if (score >= toxicityThreshold) {
    allowed = false;
    checks.push({
      name: "toxicity",
      passed: false,
      severity: "critical",
      reason: `Toxicity score ${score.toFixed(2)} exceeds threshold ${toxicityThreshold}`,
    });
  }

  const result: GuardrailResult = { allowed, checks };
  if (sanitized !== prompt) {
    result.sanitized = sanitized;
  }
  return result;
}
