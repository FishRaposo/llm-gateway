/** Abstract base provider that all LLM providers must implement. */

import type { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth } from "../types/provider";

export abstract class BaseProvider {
  protected apiKey: string;
  protected baseUrl: string;
  protected timeout: number;

  constructor(apiKey: string, baseUrl: string, timeout: number = 30000) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Sends a completion request to the provider.
   * @param request - Provider-formatted request.
   * @returns Provider response.
   */
  abstract complete(request: ProviderRequest): Promise<ProviderResponse>;

  /**
   * Streams a completion request, yielding chunks as they arrive.
   * @param request - Provider-formatted request.
   * @returns Async iterator of response chunks.
   */
  abstract streamComplete(request: ProviderRequest): AsyncIterable<ProviderResponse>;

  /**
   * Checks the health of the provider endpoint.
   * @returns Current health status.
   */
  abstract healthCheck(): Promise<ProviderHealth>;

  /**
   * Returns model information including pricing and capabilities.
   * @param model - Model name to look up.
   * @returns Model information.
   */
  abstract getModelInfo(model: string): ModelInfo;
}

