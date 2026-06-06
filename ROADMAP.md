# LLM Gateway Roadmap

## Phase 1 — Core (Complete)
- [x] Express proxy server
- [x] Provider fallback (OpenAI → Anthropic)
- [x] SSE streaming endpoint
- [x] Redis caching
- [x] Admin dashboard (Next.js & telemetry charts)

## Phase 2 — Middleware (Complete)
- [x] API key auth (persistent in SQLite with bcrypt hashing)
- [x] Rate limiting per client (Redis sliding window)
- [x] Budget enforcement per tenant (Redis/monthly resets)
- [x] Request/response logging (SQLite audit logs)

## Phase 3 — Enterprise (In Progress)
- [x] Multiple model routing (cost/latency optimization rules)
- [x] Token usage tracking (gpt-tokenizer/tiktoken)
- [x] Cost attribution (USD calculations mapped per key)
- [ ] A/B testing framework
