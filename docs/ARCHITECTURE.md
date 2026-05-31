# Architecture

## Request Flow

```mermaid
sequenceDiagram
    participant App as Application
    participant GW as Gateway
    participant Auth as Auth Middleware
    participant Policy as Policy Middleware
    participant Budget as Budget Middleware
    participant Cache as Cache Middleware
    participant RL as Rate Limit
    participant Router as Router
    participant Provider as LLM Provider
    participant Audit as Audit Log

    App->>GW: POST /v1/chat/completions
    GW->>Auth: Validate API key
    Auth->>Policy: Key valid, attach permissions
    Policy->>Budget: Request passes policy rules
    Budget->>Cache: Budget sufficient, track estimated cost
    Cache->>RL: Cache miss (or return cached response)
    RL->>Router: Within rate limits
    Router->>Provider: Route to best provider/model
    Provider-->>GW: Provider response
    GW->>Audit: Log request + response + cost
    GW-->>App: OpenAI-compatible response
```

## Provider Adapter Pattern

```mermaid
classDiagram
    class BaseProvider {
        <<abstract>>
        +complete(request: ProviderRequest) ProviderResponse
        +streamComplete(request: ProviderRequest) AsyncIterator
        +healthCheck() ProviderHealth
        +getModelInfo(model: string) ModelInfo
    }

    class OpenAIProvider {
        -apiKey: string
        -baseUrl: string
        +complete(request) ProviderResponse
        +streamComplete(request) AsyncIterator
        +healthCheck() ProviderHealth
        +getModelInfo(model) ModelInfo
    }

    class AnthropicProvider {
        -apiKey: string
        -baseUrl: string
        +complete(request) ProviderResponse
        +streamComplete(request) AsyncIterator
        +healthCheck() ProviderHealth
        +getModelInfo(model) ModelInfo
    }

    class MockProvider {
        -config: MockConfig
        +complete(request) ProviderResponse
        +streamComplete(request) AsyncIterator
        +healthCheck() ProviderHealth
        +getModelInfo(model) ModelInfo
    }

    BaseProvider <|-- OpenAIProvider
    BaseProvider <|-- AnthropicProvider
    BaseProvider <|-- MockProvider
```

## Storage Layer

```mermaid
graph LR
    subgraph "Hot Path (Redis)"
        C[Cache Store]
        R[Rate Limit Counter]
        B[Budget Tracker]
    end

    subgraph "Cold Path (SQLite)"
        A[Audit Log]
    end

    GW[Gateway] --> C
    GW --> R
    GW --> B
    GW --> A
```

- **Redis**: Used for data that requires sub-millisecond access — cached responses, rate limit counters, and budget balances. All keys are namespaced by API key and configurable TTLs.
- **SQLite**: Used for append-heavy audit logs. Queried occasionally through the admin API. No operational overhead — it's just a file.
