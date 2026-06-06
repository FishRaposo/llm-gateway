# LLM Gateway Setup Guide

## Prerequisites

- Node.js 18+
- Redis 7+ (required for rate limiting, budgeting, and caching)
- SQLite3 (installed automatically via `better-sqlite3`)

## Setup

1. Install dependencies in the gateway root:
   ```bash
   npm install
   ```
2. Copy environment template and configure keys:
   ```bash
   cp .env.example .env
   # Edit .env with your OpenAI/Anthropic/Gemini API keys
   ```
3. Start Redis (using Docker Compose):
   ```bash
   docker compose up redis -d
   ```
4. Start the gateway server:
   ```bash
   npm run dev
   ```

## Setup Admin Dashboard

1. Install dashboard dependencies:
   ```bash
   cd dashboard
   npm install
   ```
2. Start the dashboard development server (runs on port 3001):
   ```bash
   npm run dev
   ```

## Verify

- **Proxy endpoint (JSON)**: `POST http://localhost:3000/v1/chat/completions` (Send standard request body)
- **Proxy endpoint (Streaming)**: `POST http://localhost:3000/v1/chat/completions` (Include `"stream": true` in the request body)
- **Gateway Health**: `GET http://localhost:3000/health`
- **Prometheus Metrics**: `GET http://localhost:3000/metrics`
- **Dashboard Web UI**: Visit `http://localhost:3001` in your browser (admin dashboard)

## Provider Fallback Test

1. Configure an invalid OpenAI key in `.env`.
2. Request a model with a configured fallback chain.
3. The request should fallback to Anthropic.
4. Check the admin console or SQLite audit logs (`data/gateway.db`) to verify.
