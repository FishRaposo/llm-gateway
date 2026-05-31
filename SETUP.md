# LLM Gateway Setup Guide

## Prerequisites

- Node.js 18+
- Redis 7+ (optional, for caching)

## Setup

```bash
npm install
npm start
```

## Environment

```bash
cp .env.example .env
# Edit with your API keys
```

## Verify

- Proxy: POST http://localhost:3000/v1/chat/completions
- Stream: GET http://localhost:3000/v1/chat/completions/stream
- Dashboard: http://localhost:3000/admin

## Provider Fallback Test

1. Configure an invalid OpenAI key
2. Request should fallback to Anthropic
3. Check dashboard for provider health metrics
