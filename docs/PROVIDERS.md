# Providers

## Adding a New Provider

Implement the `BaseProvider` abstract class:

```typescript
import { BaseProvider } from "../providers/base";

class MyProvider extends BaseProvider {
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    // Transform request, call API, normalize response
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Return current health status
  }

  getModelInfo(model: string): ModelInfo {
    // Return model capabilities and pricing
  }
}
```

Register in the provider map in `src/config.ts`.

## OpenAI Adapter

- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Authentication**: Bearer token via `OPENAI_API_KEY`
- **Supported models**: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
- **Error handling**: Maps OpenAI error codes to gateway error types
  - `429` → Rate limit exceeded → Trigger fallback
  - `401` → Authentication error → Return error to client
  - `500/502/503` → Provider error → Trigger fallback with retry

## Anthropic Adapter

- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Authentication**: `x-api-key` header via `ANTHROPIC_API_KEY`
- **Request translation**: Converts OpenAI format to Anthropic messages format
  - `messages` → `messages` (system message extracted to `system` parameter)
  - `model` → mapped via config (e.g., gpt-4o → claude-sonnet-4-20250514)
  - `max_tokens` → required for Anthropic, defaults to 4096
- **Response normalization**: Converts Anthropic response to OpenAI format

## Mock Provider

Used for testing without real API calls:

```yaml
mock_provider:
  enabled: true
  default_response: "This is a mock response"
  latency_ms: 100
  error_rate: 0.0
```

- Returns configurable responses
- Simulates network latency
- Can inject errors at a configurable rate
- Health check always returns healthy

## Provider Health Checking

Each provider implements `healthCheck()` which returns:

```typescript
{
  status: "healthy" | "degraded" | "unhealthy",
  latency_ms: 150,
  error_rate: 0.02,
  last_check: "2024-01-15T10:30:00Z"
}
```

Health checks are run periodically (configurable interval). Unhealthy providers are temporarily removed from routing until they recover.
