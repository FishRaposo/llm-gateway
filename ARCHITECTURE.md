# LLM Gateway Architecture

## Overview

TypeScript/Express proxy for routing LLM requests with provider fallback, caching, and budget enforcement.

## Components

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   Express    │────▶│  Provider 1  │
│   Request    │     │   Gateway    │     │  (OpenAI)    │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Provider 2  │
                     │  (Anthropic) │
                     └──────────────┘
```

## Middleware Chain

1. **Auth** — API key validation
2. **Rate Limiting** — Per-client request throttling
3. **Budget Enforcement** — Cost cap per tenant
4. **Cache** — Redis response cache with TTL
5. **Fallback** — Provider failover on error

## Streaming

Dedicated `GET /v1/chat/completions/stream` endpoint returns SSE for real-time token streaming.

## Admin Dashboard

Static HTML with Chart.js for request volume and provider health visualization.
