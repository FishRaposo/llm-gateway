/** Multi-tenancy support for the LLM Gateway.
 *
 * Resolves tenants from API keys and enforces per-tenant
 * limits: allowed models, rate limits, budgets, and plan gating.
 */

export type TenantPlan = "free" | "pro" | "enterprise";

export interface TenantConfig {
  tenantId: string;
  name: string;
  plan: TenantPlan;
  allowedModels: string[];
  rateLimitRpm: number;
  budgetUsd: number;
}

const tenantMap = new Map<string, TenantConfig>();
const keyToTenant = new Map<string, string>();

const DEFAULT_TENANT: TenantConfig = {
  tenantId: "default",
  name: "Default Tenant",
  plan: "free",
  allowedModels: ["*"],
  rateLimitRpm: 60,
  budgetUsd: 100,
};

/**
 * Registers a tenant and associates it with an API key prefix or full key.
 * @param apiKey - API key (or prefix) to map to the tenant.
 * @param config - Tenant configuration.
 */
export function registerTenant(apiKey: string, config: TenantConfig): void {
  tenantMap.set(config.tenantId, config);
  keyToTenant.set(apiKey, config.tenantId);
}

/**
 * Resolves the tenant for a given API key.
 * Falls back to the default tenant if no match is found.
 * @param apiKey - The API key from the request.
 * @returns Tenant configuration.
 */
export function resolveTenant(apiKey: string): TenantConfig {
  const tenantId = keyToTenant.get(apiKey);
  if (tenantId) {
    return tenantMap.get(tenantId) ?? DEFAULT_TENANT;
  }
  return DEFAULT_TENANT;
}

/**
 * Checks whether a tenant is allowed to use a specific model.
 * @param tenant - Tenant configuration.
 * @param model - Model identifier to check.
 * @returns True if the model is allowed.
 */
export function isModelAllowed(tenant: TenantConfig, model: string): boolean {
  if (tenant.allowedModels.includes("*")) return true;
  return tenant.allowedModels.includes(model);
}

/**
 * Returns the rate limit (requests per minute) for a tenant.
 * @param tenant - Tenant configuration.
 * @returns RPM limit.
 */
export function getTenantRateLimit(tenant: TenantConfig): number {
  return tenant.rateLimitRpm;
}

/**
 * Returns the budget limit for a tenant.
 * @param tenant - Tenant configuration.
 * @returns Budget in USD.
 */
export function getTenantBudget(tenant: TenantConfig): number {
  return tenant.budgetUsd;
}

/**
 * Returns plan-based feature flags for a tenant.
 * @param tenant - Tenant configuration.
 * @returns Record of feature availability.
 */
export function getTenantFeatures(tenant: TenantConfig): Record<string, boolean> {
  return {
    streaming: tenant.plan !== "free",
    multiModel: tenant.plan === "enterprise",
    priorityRouting: tenant.plan === "enterprise" || tenant.plan === "pro",
    customModels: tenant.plan === "enterprise",
  };
}

/** Clears all tenant registrations. Useful for testing. */
export function clearTenants(): void {
  tenantMap.clear();
  keyToTenant.clear();
}
