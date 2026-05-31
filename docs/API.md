# API Reference

## Proxy Endpoint

### POST /v1/chat/completions

OpenAI-compatible chat completions endpoint. Accepts the same request format as the OpenAI API.

**Headers:**
```
Authorization: Bearer <gateway-api-key>
Content-Type: application/json
```

**Request Body:**
```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | `unauthorized` | Invalid or missing API key |
| 403 | `policy_denied` | Request blocked by policy engine |
| 429 | `rate_limit_exceeded` | Rate limit exceeded for this API key |
| 402 | `budget_exceeded` | API key budget has been exhausted |
| 502 | `provider_error` | All providers in fallback chain failed |
| 504 | `timeout` | Request timed out |

## Admin Endpoints

### GET /admin/usage

Returns usage statistics.

**Response:**
```json
{
  "total_requests": 1500,
  "total_tokens": 500000,
  "total_cost_usd": 12.50,
  "by_model": {
    "gpt-4o-mini": { "requests": 1200, "tokens": 400000, "cost": 8.00 },
    "gpt-4o": { "requests": 300, "tokens": 100000, "cost": 4.50 }
  },
  "by_provider": {
    "openai": { "requests": 1400, "errors": 5 },
    "anthropic": { "requests": 100, "errors": 0 }
  }
}
```

### GET /admin/budgets

Returns budget status for all API keys.

**Response:**
```json
{
  "budgets": [
    {
      "key": "key-abc",
      "limit_usd": 100.00,
      "used_usd": 45.50,
      "remaining_usd": 54.50,
      "period": "monthly",
      "reset_date": "2024-02-01"
    }
  ]
}
```

### GET /admin/logs

Query audit logs with filters.

**Query Parameters:**
- `api_key` — Filter by API key
- `model` — Filter by model
- `provider` — Filter by provider
- `from` — Start date (ISO 8601)
- `to` — End date (ISO 8601)
- `limit` — Max results (default: 100)
- `offset` — Pagination offset

### POST /admin/keys

Manage API keys.

**Request Body:**
```json
{
  "action": "create",
  "name": "production-app",
  "budget_usd": 100.00,
  "rate_limit_rpm": 60,
  "allowed_models": ["gpt-4o-mini"]
}
```

### GET /admin/health

System health check including provider status.

**Response:**
```json
{
  "status": "healthy",
  "providers": {
    "openai": { "status": "healthy", "latency_ms": 150 },
    "anthropic": { "status": "healthy", "latency_ms": 200 }
  },
  "redis": "connected",
  "database": "connected",
  "uptime_seconds": 86400
}
```

## Health Endpoint

### GET /health

Simple health check for load balancers.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```
