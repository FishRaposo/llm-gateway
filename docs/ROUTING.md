# Routing Configuration

## Overview

The router determines which provider and model to use for each request. It evaluates routing rules in priority order, falling back to a default model if no rules match.

## Rule Types

### Model Preference

Route specific model names to specific providers:

```yaml
rules:
  - type: model_preference
    model: "gpt-4o-mini"
    provider: openai
    priority: 10
```

### Cost Optimization

Route to the cheapest provider that supports the requested capabilities:

```yaml
rules:
  - type: cost_optimize
    capability: "chat"
    prefer_cheapest: true
    priority: 5
```

### Latency Optimization

Route to the provider with the lowest recent latency:

```yaml
rules:
  - type: latency_optimize
    capability: "chat"
    max_latency_ms: 2000
    priority: 8
```

### Fallback Chain

Define ordered fallback providers for a given model group:

```yaml
rules:
  - type: fallback_chain
    models: ["gpt-4o", "gpt-4o-mini"]
    chain:
      - provider: openai
        model: "gpt-4o"
      - provider: anthropic
        model: "claude-sonnet-4-20250514"
      - provider: openai
        model: "gpt-4o-mini"
    priority: 1
```

## Configuration Example

```yaml
default:
  provider: openai
  model: gpt-4o-mini

rules:
  - type: model_preference
    model: "gpt-4o"
    provider: openai
    priority: 10

  - type: cost_optimize
    capability: "chat"
    prefer_cheapest: true
    priority: 5

  - type: fallback_chain
    models: ["gpt-4o"]
    chain:
      - provider: openai
        model: "gpt-4o"
      - provider: anthropic
        model: "claude-sonnet-4-20250514"
    priority: 1

fallback:
  enabled: true
  max_retries: 3
  circuit_breaker:
    failure_threshold: 5
    reset_timeout_ms: 60000
```

## Rule Evaluation Order

1. Rules are sorted by priority (higher number = higher priority)
2. For each rule, conditions are checked against the request
3. The first matching rule determines the routing decision
4. If no rules match, the default provider/model is used
5. If the selected provider fails, the fallback chain is consulted
