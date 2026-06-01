/** Domain model for routing decisions.
 * Pure business entity with no external dependencies.
 */

export interface RoutingDecision {
  selectedProvider: string;
  selectedModel: string;
  fallbackUsed: boolean;
  ruleMatched: string;
  alternatives: Array<{
    provider: string;
    model: string;
  }>;
}

export interface ProviderInfo {
  name: string;
  availableModels: string[];
  health: "healthy" | "degraded" | "down";
  latencyMs: number;
  errorRate: number;
}
