/** Policy type definitions. */

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  modifiedRequest?: Record<string, unknown>;
  matchedRule?: string;
}

export interface ContentFilter {
  patterns: string[];
  caseSensitive: boolean;
  action: "allow" | "deny" | "flag";
}

export interface ModelRestriction {
  allowedModels: string[];
  blockedModels: string[];
  action: "allow" | "deny";
}

export interface PiiDetectionConfig {
  detectTypes: PiiType[];
  action: "deny" | "flag";
}

export type PiiType = "email" | "phone" | "ssn" | "credit_card" | "ip_address";

export interface RequestModificationRule {
  field: string;
  maxValue?: number;
  minValue?: number;
  exactValue?: unknown;
  onViolation: "clamp" | "deny" | "use_default";
  defaultValue?: unknown;
}

export interface PolicyEvaluationResult {
  passed: boolean;
  violatedRules: PolicyViolation[];
  modifications: Map<string, unknown>;
}

export interface PolicyViolation {
  ruleType: string;
  field?: string;
  reason: string;
  severity: "error" | "warning";
}
