# Policy Engine

## Overview

The policy engine evaluates requests against configurable rules before they reach LLM providers. Policies can allow, deny, or modify requests.

## Rule Types

### Content Filtering

Block or flag requests containing specific content patterns:

```yaml
policies:
  - type: content_filter
    action: deny
    patterns:
      - "password"
      - "secret_key"
      - "api_key"
    case_sensitive: false
```

### PII Detection

Flag or block requests that may contain personally identifiable information:

```yaml
policies:
  - type: pii_detection
    action: flag
    detect:
      - email
      - phone
      - ssn
      - credit_card
    on_detection: deny
```

### Model Restriction

Restrict which models can be used by specific API keys:

```yaml
policies:
  - type: model_restriction
    action: deny
    allowed_models:
      - "gpt-4o-mini"
      - "gpt-3.5-turbo"
    blocked_models:
      - "gpt-4o"
```

### Request Modification

Automatically modify requests before forwarding:

```yaml
policies:
  - type: request_modify
    action: modify
    modifications:
      - field: "max_tokens"
        max: 2048
      - field: "temperature"
        max: 1.0
    on_violation: clamp
```

## Policy Evaluation

Policies are evaluated in the order they are defined. The evaluation produces a `PolicyDecision`:

```typescript
{
  allowed: true | false,
  reason?: string,
  modified_request?: ProviderRequest
}
```

1. If any policy returns `deny`, the request is rejected immediately
2. If a policy returns `modify`, the request is updated before continuing evaluation
3. If all policies pass, the request proceeds to the next middleware

## Configuration

```yaml
policies:
  enabled: true
  eval_order: ["model_restriction", "content_filter", "pii_detection", "request_modify"]

  rules:
    - type: model_restriction
      action: deny
      allowed_models: ["gpt-4o-mini"]

    - type: content_filter
      action: deny
      patterns: ["password", "secret"]

    - type: pii_detection
      action: flag
      detect: ["email", "phone"]
      on_detection: deny

    - type: request_modify
      action: modify
      modifications:
        - field: "max_tokens"
          max: 4096
```
