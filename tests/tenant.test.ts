import { describe, it, expect, beforeEach } from "vitest";
import { registerTenant, resolveTenant, isModelAllowed, getTenantRateLimit, getTenantBudget, getTenantFeatures, clearTenants } from "../src/multi_tenancy/tenant";

describe("Multi-tenancy", () => {
  beforeEach(() => {
    clearTenants();
  });

  it("should resolve default tenant for unknown keys", () => {
    const tenant = resolveTenant("unknown-key");
    expect(tenant.tenantId).toBe("default");
    expect(tenant.plan).toBe("free");
  });

  it("should register and resolve a tenant by API key", () => {
    registerTenant("key-pro-1", {
      tenantId: "tenant-1",
      name: "Pro Tenant",
      plan: "pro",
      allowedModels: ["gpt-4o-mini", "gpt-4o"],
      rateLimitRpm: 120,
      budgetUsd: 500,
    });

    const tenant = resolveTenant("key-pro-1");
    expect(tenant.tenantId).toBe("tenant-1");
    expect(tenant.plan).toBe("pro");
    expect(tenant.budgetUsd).toBe(500);
  });

  it("should allow all models when wildcard is set", () => {
    registerTenant("key-ent-1", {
      tenantId: "tenant-2",
      name: "Enterprise",
      plan: "enterprise",
      allowedModels: ["*"],
      rateLimitRpm: 1000,
      budgetUsd: 5000,
    });

    const tenant = resolveTenant("key-ent-1");
    expect(isModelAllowed(tenant, "any-model")).toBe(true);
  });

  it("should restrict models when wildcard is not set", () => {
    registerTenant("key-free-1", {
      tenantId: "tenant-3",
      name: "Free",
      plan: "free",
      allowedModels: ["gpt-4o-mini"],
      rateLimitRpm: 30,
      budgetUsd: 10,
    });

    const tenant = resolveTenant("key-free-1");
    expect(isModelAllowed(tenant, "gpt-4o-mini")).toBe(true);
    expect(isModelAllowed(tenant, "gpt-4o")).toBe(false);
  });

  it("should return correct rate limit and budget", () => {
    registerTenant("key-1", {
      tenantId: "tenant-4",
      name: "Test",
      plan: "pro",
      allowedModels: ["*"],
      rateLimitRpm: 200,
      budgetUsd: 250,
    });

    const tenant = resolveTenant("key-1");
    expect(getTenantRateLimit(tenant)).toBe(200);
    expect(getTenantBudget(tenant)).toBe(250);
  });

  it("should return plan-based features", () => {
    registerTenant("key-free", {
      tenantId: "t-free",
      name: "Free",
      plan: "free",
      allowedModels: ["*"],
      rateLimitRpm: 60,
      budgetUsd: 100,
    });
    registerTenant("key-pro", {
      tenantId: "t-pro",
      name: "Pro",
      plan: "pro",
      allowedModels: ["*"],
      rateLimitRpm: 60,
      budgetUsd: 100,
    });
    registerTenant("key-ent", {
      tenantId: "t-ent",
      name: "Enterprise",
      plan: "enterprise",
      allowedModels: ["*"],
      rateLimitRpm: 60,
      budgetUsd: 100,
    });

    const freeFeatures = getTenantFeatures(resolveTenant("key-free"));
    expect(freeFeatures.streaming).toBe(false);
    expect(freeFeatures.priorityRouting).toBe(false);

    const proFeatures = getTenantFeatures(resolveTenant("key-pro"));
    expect(proFeatures.streaming).toBe(true);
    expect(proFeatures.priorityRouting).toBe(true);
    expect(proFeatures.multiModel).toBe(false);

    const entFeatures = getTenantFeatures(resolveTenant("key-ent"));
    expect(entFeatures.streaming).toBe(true);
    expect(entFeatures.multiModel).toBe(true);
    expect(entFeatures.customModels).toBe(true);
  });
});
