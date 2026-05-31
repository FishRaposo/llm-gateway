import { BaseProvider } from "./base";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { GatewayConfig } from "../types";

const providerRegistry = new Map<string, BaseProvider>();

export function getProvider(name: string, config: GatewayConfig): BaseProvider {
  if (providerRegistry.has(name)) {
    return providerRegistry.get(name)!;
  }

  const providerConfig = config.providers[name];
  if (!providerConfig) {
    throw new Error(`Provider "${name}" is not configured`);
  }

  let provider: BaseProvider;
  switch (providerConfig.type) {
    case "openai":
      provider = new OpenAIProvider(
        providerConfig.apiKey,
        providerConfig.baseUrl || "https://api.openai.com/v1",
        providerConfig.timeout || 30000
      );
      break;
    case "anthropic":
      provider = new AnthropicProvider(
        providerConfig.apiKey,
        providerConfig.baseUrl || "https://api.anthropic.com/v1",
        providerConfig.timeout || 30000
      );
      break;
    case "mock":
      provider = new MockProvider();
      break;
    default:
      throw new Error(`Unknown provider type: ${(providerConfig as { type: string }).type}`);
  }

  providerRegistry.set(name, provider);
  return provider;
}

export function clearProviderRegistry(): void {
  providerRegistry.clear();
}
