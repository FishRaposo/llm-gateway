import { describe, it, expect, beforeEach } from "vitest";
import { classifyPrompt, selectModelForClassification, clearClassificationCache } from "../src/routing/semantic";

describe("Semantic Routing", () => {
  beforeEach(() => {
    clearClassificationCache();
  });

  it("should classify short greetings as simple", () => {
    const result = classifyPrompt("Hello, how are you?");
    expect(result.complexity).toBe("simple");
    expect(result.topic).toBe("general");
  });

  it("should classify code/debug requests as complex", () => {
    const result = classifyPrompt("Debug this complex recursive function and analyze its time complexity step by step");
    expect(result.complexity).toBe("complex");
    expect(result.topic).toBe("code");
  });

  it("should classify medium-length general questions as medium", () => {
    const result = classifyPrompt("What are the benefits of exercise?");
    expect(result.complexity).toBe("medium");
  });

  it("should cache repeated classifications", () => {
    const prompt = "What is the capital of France?";
    const r1 = classifyPrompt(prompt);
    const r2 = classifyPrompt(prompt);
    expect(r1.complexity).toBe(r2.complexity);
    expect(r1.topic).toBe(r2.topic);
  });

  it("should select cheap model for simple queries", () => {
    const classification = classifyPrompt("Hi there");
    const model = selectModelForClassification(classification, ["gpt-4o-mini", "gpt-4o", "claude-opus"]);
    expect(model).toBe("gpt-4o-mini");
  });

  it("should select powerful model for complex queries", () => {
    const classification = classifyPrompt("Analyze the architecture of this distributed system in detail");
    const model = selectModelForClassification(classification, ["gpt-4o-mini", "gpt-4o", "claude-opus"]);
    expect(model).toBe("gpt-4o");
  });

  it("should fall back to first available model when no match", () => {
    const classification = classifyPrompt("Simple question");
    const model = selectModelForClassification(classification, ["custom-model"]);
    expect(model).toBe("custom-model");
  });

  it("should return default when no models available", () => {
    const classification = classifyPrompt("Test");
    const model = selectModelForClassification(classification, []);
    expect(model).toBe("gpt-4o-mini");
  });
});
