/** Application use case: Process a chat completion request.
 * Orchestrates domain logic without framework dependencies.
 */

import type { ChatRequest } from "../../domain/models/Request";
import type { ChatResponse } from "../../domain/models/Response";
import type { RoutingDecision } from "../../domain/models/Routing";
import type { AuditEntry, AuditStatus } from "../../domain/models/Audit";
import type { ProviderPort, ProviderRequest } from "../../domain/ports/ProviderPort";
import type { CachePort } from "../../domain/ports/CachePort";
import type { AuditPort } from "../../domain/ports/AuditPort";
import type { BudgetPort } from "../../domain/ports/BudgetPort";
import type { CircuitBreakerPort } from "../../domain/ports/CircuitBreakerPort";
import type { RoutingService } from "../../domain/services/RoutingService";
import { calculateCost } from "../../domain/services/CostService";
import { evaluateGuardrails } from "../../domain/services/GuardrailService";

export interface ProcessResult {
  success: boolean;
  response?: ChatResponse;
  error?: {
    message: string;
    code: string;
    statusCode: number;
  };
  auditEntry: AuditEntry;
}

export interface ProcessDependencies {
  routingService: RoutingService;
  providers: Map<string, ProviderPort>;
  cache: CachePort;
  auditLog: AuditPort;
  budgetTracker: BudgetPort;
  circuitBreaker: CircuitBreakerPort;
  circuitBreakerConfig: {
    failureThreshold: number;
    successThreshold?: number;
    resetTimeoutMs: number;
  };
  defaultProvider: string;
  defaultModel: string;
  cacheTtlMs: number;
}

export class ProcessChatCompletion {
  constructor(private deps: ProcessDependencies) {}

  async execute(request: ChatRequest): Promise<ProcessResult> {
    const startTime = Date.now();
    let status: AuditStatus = "success";
    let errorMessage: string | undefined;
    let response: ChatResponse | undefined;
    let fallbackUsed = false;
    let routingDecision: RoutingDecision | undefined;

    try {
      // Step 1: Guardrails check
      const allContent = request.messages.map((m) => m.content).join(" ");
      const guardrailResult = evaluateGuardrails(allContent);

      if (!guardrailResult.allowed) {
        status = "policy_denied";
        errorMessage = guardrailResult.checks
          .filter((c) => !c.passed)
          .map((c) => `${c.name}: ${c.reason}`)
          .join("; ");

        const auditEntry = this.buildAuditEntry(
          request,
          undefined,
          Date.now() - startTime,
          status,
          errorMessage,
          0,
          false,
          false,
          undefined
        );

        await this.deps.auditLog.write(auditEntry);

        return {
          success: false,
          error: {
            message: errorMessage,
            code: "guardrails_denied",
            statusCode: 403,
          },
          auditEntry,
        };
      }

      // Step 2: Check budget
      const remainingBudget = await this.deps.budgetTracker.getRemainingBudget(request.apiKey);
      if (remainingBudget <= 0) {
        status = "budget_exceeded";
        errorMessage = "Budget exceeded";

        const auditEntry = this.buildAuditEntry(
          request,
          undefined,
          Date.now() - startTime,
          status,
          errorMessage,
          0,
          false,
          false,
          undefined
        );

        await this.deps.auditLog.write(auditEntry);

        return {
          success: false,
          error: {
            message: errorMessage,
            code: "budget_exceeded",
            statusCode: 402,
          },
          auditEntry,
        };
      }

      // Step 3: Check cache for non-streaming requests
      if (!request.stream) {
        const cacheKey = this.generateCacheKey(request);
        const cached = await this.deps.cache.get<{ response: ChatResponse }>(cacheKey);

        if (cached?.response) {
          const duration = Date.now() - startTime;
          const cost = calculateCost(
            cached.response.model,
            cached.response.usage
          );

          const auditEntry = this.buildAuditEntry(
            request,
            cached.response,
            duration,
            "cached",
            undefined,
            cost,
            true,
            false,
            undefined
          );

          await this.deps.auditLog.write(auditEntry);

          return {
            success: true,
            response: { ...cached.response, cacheHit: true, latencyMs: duration },
            auditEntry,
          };
        }
      }

      // Step 4: Routing decision
      const providerInfos = await this.getProviderInfos();
      routingDecision = this.deps.routingService.route(
        request,
        providerInfos,
        this.deps.defaultProvider,
        this.deps.defaultModel
      );

      // Step 5: Try primary provider with circuit breaker
      response = await this.tryProvider(
        request,
        routingDecision.selectedProvider,
        routingDecision.selectedModel
      );

      if (!response) {
        // Try alternatives
        for (const alt of routingDecision.alternatives) {
          response = await this.tryProvider(request, alt.provider, alt.model);
          if (response) {
            fallbackUsed = true;
            break;
          }
        }
      }

      if (!response) {
        throw new Error("All providers failed");
      }

      // Step 6: Record success in circuit breaker
      this.deps.circuitBreaker.recordSuccess(
        fallbackUsed
          ? routingDecision.alternatives[0]?.provider || routingDecision.selectedProvider
          : routingDecision.selectedProvider,
        this.deps.circuitBreakerConfig
      );

      // Step 7: Deduct budget
      const cost = calculateCost(response.model, response.usage);
      await this.deps.budgetTracker.deductBudget(request.apiKey, cost);

      // Step 8: Cache the response (non-streaming only)
      if (!request.stream) {
        const cacheKey = this.generateCacheKey(request);
        await this.deps.cache.set(
          cacheKey,
          { response },
          this.deps.cacheTtlMs
        );
      }

      const duration = Date.now() - startTime;

      const auditEntry = this.buildAuditEntry(
        request,
        response,
        duration,
        "success",
        undefined,
        cost,
        false,
        fallbackUsed,
        routingDecision.ruleMatched
      );

      await this.deps.auditLog.write(auditEntry);

      return {
        success: true,
        response: { ...response, fallbackUsed, latencyMs: duration },
        auditEntry,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      status = "error";
      errorMessage = error instanceof Error ? error.message : "Unknown error";

      const auditEntry = this.buildAuditEntry(
        request,
        undefined,
        duration,
        status,
        errorMessage,
        0,
        false,
        fallbackUsed,
        routingDecision?.ruleMatched
      );

      await this.deps.auditLog.write(auditEntry);

      return {
        success: false,
        error: {
          message: errorMessage,
          code: "provider_error",
          statusCode: 502,
        },
        auditEntry,
      };
    }
  }

  private async tryProvider(
    request: ChatRequest,
    providerName: string,
    model: string
  ): Promise<ChatResponse | undefined> {
    if (!this.deps.circuitBreaker.isAvailable(providerName, this.deps.circuitBreakerConfig)) {
      return undefined;
    }

    const provider = this.deps.providers.get(providerName);
    if (!provider) {
      return undefined;
    }

    try {
      const providerRequest: ProviderRequest = {
        model,
        messages: request.messages as Array<{ role: string; content: string }>,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stream: request.stream,
        metadata: request.metadata,
      };

      const response = await provider.complete(providerRequest);

      return {
        ...response,
        provider: providerName,
      };
    } catch (error) {
      this.deps.circuitBreaker.recordFailure(providerName, this.deps.circuitBreakerConfig);
      return undefined;
    }
  }

  private async getProviderInfos(): Promise<
    Array<{
      name: string;
      availableModels: string[];
      health: "healthy" | "degraded" | "down";
      latencyMs: number;
      errorRate: number;
    }>
  > {
    const infos = [];
    for (const [name, provider] of this.deps.providers.entries()) {
      try {
        const health = await provider.healthCheck();
        const modelInfo = provider.getModelInfo("default");
        infos.push({
          name,
          availableModels: [modelInfo.id],
          health: (health.healthy ? "healthy" : "down") as "healthy" | "degraded" | "down",
          latencyMs: health.latencyMs,
          errorRate: health.errorRate,
        });
      } catch {
        infos.push({
          name,
          availableModels: [],
          health: "down" as const,
          latencyMs: 0,
          errorRate: 1,
        });
      }
    }
    return infos;
  }

  private generateCacheKey(request: ChatRequest): string {
    const content = request.messages.map((m) => `${m.role}:${m.content}`).join("|");
    const model = request.originalModel;
    // Simple hash - in production use proper hashing
    return `cache:${model}:${Buffer.from(content).toString("base64").slice(0, 32)}`;
  }

  private buildAuditEntry(
    request: ChatRequest,
    response: ChatResponse | undefined,
    durationMs: number,
    status: AuditStatus,
    errorMessage: string | undefined,
    costUsd: number,
    cacheHit: boolean,
    fallbackUsed: boolean,
    routingDecision: string | undefined
  ): AuditEntry {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      apiKey: request.apiKey,
      apiKeyName: request.apiKeyName,
      model: response?.model ?? request.originalModel,
      provider: response?.provider ?? "unknown",
      inputTokens: response?.usage?.promptTokens ?? 0,
      outputTokens: response?.usage?.completionTokens ?? 0,
      costUsd,
      latencyMs: durationMs,
      status,
      errorMessage,
      routingDecision,
      cacheHit,
      fallbackUsed,
    };
  }
}
