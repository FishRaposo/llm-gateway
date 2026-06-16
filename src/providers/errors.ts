export class GatewayProviderError extends Error {
  public type: string;
  public code: number;
  public retryable: boolean;
  public provider: string;

  constructor(type: string, code: number, message: string, retryable: boolean, provider: string) {
    super(message);
    this.name = "GatewayProviderError";
    this.type = type;
    this.code = code;
    this.retryable = retryable;
    this.provider = provider;
  }
}

/**
 * Builds a typed provider error from an HTTP status code, mirroring the
 * retryability rules used across providers: 429 (rate limit), 5xx
 * (server error) and 504 (timeout) are retryable so fallback can trigger.
 * @param status - HTTP status code from the provider response.
 * @param message - Error message / response body.
 * @param provider - Provider name.
 * @returns A GatewayProviderError with a correct retryable flag.
 */
export function providerErrorFromStatus(
  status: number,
  message: string,
  provider: string
): GatewayProviderError {
  const typeMap: Record<number, string> = {
    401: "authentication",
    429: "rate_limit",
    504: "timeout",
  };
  const type = typeMap[status] || (status >= 500 ? "server_error" : "invalid_request");
  const retryable = status === 429 || status >= 500;
  return new GatewayProviderError(type, status, message, retryable, provider);
}
