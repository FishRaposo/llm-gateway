import { describe, it, expect, beforeEach } from "vitest";
import {
  isAvailable,
  recordSuccess,
  recordFailure,
  resetAll,
  getCircuitState,
  type CircuitBreakerConfig,
} from "../src/routing/circuitBreaker";

const config: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  resetTimeoutMs: 100,
};

describe("Circuit Breaker", () => {
  beforeEach(() => {
    resetAll();
  });

  it("should be available in CLOSED state", () => {
    expect(isAvailable("openai", config)).toBe(true);
    expect(getCircuitState("openai")?.state).toBe("CLOSED");
  });

  it("should remain CLOSED after fewer failures than threshold", () => {
    recordFailure("openai", config);
    recordFailure("openai", config);
    expect(getCircuitState("openai")?.state).toBe("CLOSED");
    expect(isAvailable("openai", config)).toBe(true);
  });

  it("should OPEN after reaching failure threshold", () => {
    recordFailure("openai", config);
    recordFailure("openai", config);
    recordFailure("openai", config);
    expect(getCircuitState("openai")?.state).toBe("OPEN");
    expect(isAvailable("openai", config)).toBe(false);
  });

  it("should reset failures on success in CLOSED state", () => {
    recordFailure("openai", config);
    recordFailure("openai", config);
    recordSuccess("openai", config);
    expect(getCircuitState("openai")?.failures).toBe(0);
    expect(getCircuitState("openai")?.state).toBe("CLOSED");
  });

  it("should transition OPEN → HALF_OPEN after reset timeout", async () => {
    recordFailure("openai", config);
    recordFailure("openai", config);
    recordFailure("openai", config);
    expect(isAvailable("openai", config)).toBe(false);

    await new Promise((r) => setTimeout(r, config.resetTimeoutMs + 10));
    expect(isAvailable("openai", config)).toBe(true);
    expect(getCircuitState("openai")?.state).toBe("HALF_OPEN");
  });

  it("should transition HALF_OPEN → CLOSED after enough successes", async () => {
    recordFailure("openai", config);
    recordFailure("openai", config);
    recordFailure("openai", config);
    await new Promise((r) => setTimeout(r, config.resetTimeoutMs + 10));
    isAvailable("openai", config); // trigger OPEN → HALF_OPEN

    expect(getCircuitState("openai")?.state).toBe("HALF_OPEN");
    recordSuccess("openai", config);
    expect(getCircuitState("openai")?.state).toBe("HALF_OPEN");
    recordSuccess("openai", config);
    expect(getCircuitState("openai")?.state).toBe("CLOSED");
    expect(isAvailable("openai", config)).toBe(true);
  });

  it("should transition HALF_OPEN → OPEN on failure", async () => {
    recordFailure("openai", config);
    recordFailure("openai", config);
    recordFailure("openai", config);
    await new Promise((r) => setTimeout(r, config.resetTimeoutMs + 10));
    isAvailable("openai", config); // trigger OPEN → HALF_OPEN

    expect(getCircuitState("openai")?.state).toBe("HALF_OPEN");
    recordFailure("openai", config);
    expect(getCircuitState("openai")?.state).toBe("OPEN");
    expect(isAvailable("openai", config)).toBe(false);
  });

  it("should track providers independently", () => {
    recordFailure("openai", config);
    recordFailure("openai", config);
    recordFailure("openai", config);
    expect(getCircuitState("openai")?.state).toBe("OPEN");
    // Initialize anthropic state by checking availability
    expect(isAvailable("anthropic", config)).toBe(true);
    expect(getCircuitState("anthropic")?.state).toBe("CLOSED");
  });

  it("should use default successThreshold of 2 when omitted", async () => {
    const minimalConfig: CircuitBreakerConfig = {
      failureThreshold: 2,
      resetTimeoutMs: 50,
    };
    recordFailure("gemini", minimalConfig);
    recordFailure("gemini", minimalConfig);
    await new Promise((r) => setTimeout(r, 60));
    isAvailable("gemini", minimalConfig); // trigger OPEN → HALF_OPEN
    recordSuccess("gemini", minimalConfig);
    expect(getCircuitState("gemini")?.state).toBe("HALF_OPEN");
    recordSuccess("gemini", minimalConfig);
    expect(getCircuitState("gemini")?.state).toBe("CLOSED");
  });
});
