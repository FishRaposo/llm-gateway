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
