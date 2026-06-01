import { describe, it, expect } from "vitest";
import { countTokens, countMessageTokens } from "../src/shared/tokenCounter";

describe("Token Counter", () => {
  it("should count tokens for a simple string", () => {
    const count = countTokens("Hello world");
    expect(count).toBeGreaterThan(0);
    expect(typeof count).toBe("number");
  });

  it("should return higher count for longer text", () => {
    const short = countTokens("Hello");
    const long = countTokens("Hello world, this is a longer piece of text with more words.");
    expect(long).toBeGreaterThan(short);
  });

  it("should count message tokens across multiple messages", () => {
    const messages = [
      { content: "Hello" },
      { content: "World" },
    ];
    const total = countMessageTokens(messages);
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it("should return 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });
});
