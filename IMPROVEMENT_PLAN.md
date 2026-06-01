# LLM Gateway — Improvement Plan

> Comprehensive audit of bugs, inconsistencies, missing features, and growth opportunities.
> Priority levels: **P0** (broken/blocking), **P1** (high value), **P2** (polish), **P3** (long-term growth).

---

## 1. P0 — Broken Code & Critical Fixes

### 1.1 Compilation error in `handler.test.ts`

`tests/handler.test.ts` line 10 references `ProviderResponse` type without importing it. This would cause `tsc --noEmit` to fail.

**Action:** Add the missing import or use the correct type from the local types.

### 1.2 Stale `server.ts` is dead code

`src/server.ts` (83 lines) is a legacy early prototype with:
- Hardcoded providers
- In-memory Map cache using `redis` package (not `ioredis` used everywhere else)
- A fake streaming endpoint with hardcoded "Hello from LLM Gateway" chunks
- Not imported by anything

**Action:** Delete `src/server.ts`.

### 1.3 Three Python files in TypeScript project

| File | Purpose |
|------|---------|
| `src/multi_tenancy/tenant.py` | TenantManager, TenantAwareBudgetTracker — imports `from app.config import get_settings` (nonexistent) |
| `src/reliability/circuit_breaker.py` | Full CLOSED/OPEN/HALF_OPEN state machine — imports `import httpx` (not a dependency) |
| `src/routing/semantic.py` | Semantic query classification + CostOptimizer — imports `from app.config import get_settings` (nonexistent) |

These appear to be design sketches or reference implementations that were never integrated. The TypeScript project has its own implementations of circuit breakers and routing.

**Action:** Either:
- **(A)** Delete them (recommended — they're dead code that adds confusion)
- **(B)** Port them to TypeScript and integrate them into the actual Express app

---

## 2. P1 — High-Value Fixes

### 2.1 Duplicate pricing data in three places

| File | What's Defined |
|------|---------------|
| `src/providers/openai.ts` | `MODEL_PRICING` with full `ModelInfo` |
| `src/providers/anthropic.ts` | `MODEL_PRICING` with full `ModelInfo` |
| `src/shared/pricing.ts` | `pricingMap` with just `inputPerToken`/`outputPerToken` |

Values are consistent but duplication is a maintenance risk. Updating prices requires editing 3 files.

**Action:** Use `src/shared/pricing.ts` as the single source of truth. Have providers import from it.

### 2.2 Weak cache key hashing

`src/middleware/cache.ts` uses a simple hash function (multiply-add-shift with bitmask) producing only 8 hex characters (32 bits). Prone to collisions at scale — two different requests could get the same cache key.

**Action:** Use `crypto.createHash("sha256")` for proper collision resistance. Only need first 16 hex chars (64 bits) for practical uniqueness.

### 2.3 API keys stored in plaintext in memory

- `src/middleware/auth.ts` stores keys in a module-level `Map<string, string>` with no hashing.
- No persistence — all keys lost on restart.
- `docs/SECURITY.md` claims bcrypt hashing (not implemented).

**Action:**
- Hash keys with bcrypt before storing (keep plaintext only during registration response).
- Persist keys to SQLite (audit log DB already exists).
- Add key expiration and rotation.

### 2.4 Budget estimation is crude

`src/middleware/budget.ts` estimates cost using `chars / 4 * $0.00001` — a rough heuristic. The actual cost calculation after the response uses real token counts and model-specific pricing. Pre-check and post-deduction can differ significantly.

**Action:** Use the actual model pricing table from `shared/pricing.ts` for estimation. Count characters / 4 as token estimate, then multiply by the selected model's input token price.

### 2.5 No ESLint configured

The project uses `tsc --noEmit` for type checking and Prettier for formatting, but has no ESLint. No enforcement of code quality rules (no-unused-vars, no-console, prefer-const, etc.).

**Action:** Add ESLint with `@typescript-eslint/recommended` config. Add to CI pipeline and pre-commit hooks.

### 2.6 Stale documentation

| File | Issue |
|------|-------|
| `FAQ.md` | Says "current implementation is a scaffold" and references `src/server.ts` |
| `ROADMAP.md` | Phase 2 items unchecked despite being implemented (rate limiting, budget, caching) |
| `SETUP.md` | References `GET /v1/chat/completions/stream` endpoint — doesn't exist (streaming via `stream: true` in POST body) |
| `docs/SECURITY.md` | Claims bcrypt-hashed API keys — not implemented |
| `CONTRIBUTING.md` | Says "Register provider in `src/providers/base.ts`" — actual location is `src/providers/registry.ts` |

**Action:** Update each doc to match current implementation.

### 2.7 Logging middleware doesn't write to SQLite

`src/middleware/logging.ts` only logs to console. Actual SQLite audit writes happen in `src/proxy/handler.ts` and `src/proxy/streaming.ts`. The logging middleware is somewhat redundant.

**Action:** Either:
- **(A)** Remove the logging middleware and keep audit logging in the handler (single responsibility)
- **(B)** Have the logging middleware write to SQLite and remove audit writes from the handler

### 2.8 Duplicate circuit breaker implementations

| Implementation | Location | Quality |
|---------------|----------|---------|
| TypeScript (simple) | `src/routing/fallback.ts` | Just failure count + open flag |
| Python (proper) | `src/reliability/circuit_breaker.py` | CLOSED/OPEN/HALF_OPEN state machine with success threshold |

The TypeScript version doesn't have a HALF_OPEN state, so once open it never recovers until the timeout expires.

**Action:** Enhance the TypeScript circuit breaker with a HALF_OPEN state. Allow a limited number of probe requests through in HALF_OPEN to test recovery.

---

## 3. P2 — Polish & Depth

### 3.1 No graceful shutdown

Server starts with `app.listen()` but has no SIGTERM/SIGINT handler. Redis connections, SQLite connections, and in-flight requests are not cleaned up.

**Action:** Add process signal handlers:
- Close Redis connections gracefully
- Close SQLite database
- Stop accepting new requests
- Drain in-flight requests (with timeout)
- Log shutdown progress

### 3.2 Dashboards use mock/hardcoded data

| Dashboard | Data Source |
|-----------|------------|
| Static HTML (`src/admin/dashboard.html`) | Hardcoded arrays with Chart.js |
| Next.js (`dashboard/src/app/page.tsx`) | Mock data, comment says "In production, fetch from /api/admin/..." |

Neither connects to the gateway's admin API.

**Action:**
- Static HTML: Fetch from `/admin/usage`, `/admin/budgets`, `/admin/health` endpoints
- Next.js: Use SWR or React Query to fetch from admin API. Add API base URL config.

### 3.3 No guardrails tests

`src/guardrails/index.ts` implements PII detection, prompt injection detection, topic blocking, toxicity scoring, and PII sanitization — with zero test coverage.

**Action:** Add `tests/guardrails.test.ts` covering:
- PII detection for each type (email, phone, SSN, credit card, IP)
- Prompt injection patterns
- Topic blocking (allowed/denied)
- Toxicity scoring thresholds
- Sanitization output
- Edge cases (empty input, very long input, non-ASCII)

### 3.4 No streaming tests

`src/proxy/streaming.ts` handles SSE streaming with fallback — no tests.

**Action:** Add `tests/streaming.test.ts` with mock provider that yields chunks. Test: normal streaming, fallback on stream error, audit log written after stream completes.

### 3.5 Fallback tests are minimal

`tests/fallback.test.ts` has only 3 basic tests. Doesn't test: actual fallback chain execution, circuit breaker state transitions, multiple provider failures.

**Action:** Add tests for:
- Sequential fallback through 3+ providers
- Circuit breaker opening after N failures
- Circuit breaker recovery after timeout
- All providers failing → 503 response

### 3.6 `require()` for optional dependencies

Storage modules use `require("ioredis")` and `require("better-sqlite3")` for optional loading. Works in CommonJS but prevents tree-shaking and is non-idiomatic in TypeScript.

**Action:** Use dynamic `import()` with try/catch, or conditional top-level imports with try/catch around initialization.

### 3.7 No request body field size validation

10mb JSON limit is set, but no validation of individual field sizes. A single message could be 9.9MB.

**Action:** Add max length validation per field: `messages` array max 100 items, each `content` max 100KB, `system` max 10KB.

### 3.8 Budget period resets not automated

No cron/scheduler resets monthly budgets. After month boundary, budgets are stale.

**Action:** Check current month on each budget request. If month changed since last check, reset counters. Or use Redis TTL with month-aligned expiration.

### 3.9 Configuration hot-reload

Currently requires restart to pick up YAML config changes.

**Action:** Add file watcher for YAML configs. Reload routing/policy/budget rules without restart.

---

## 4. P3 — Growth & Long-Term

### 4.1 Phase 2 roadmap items (from ROADMAP.md — partially done)

| Item | Status | Next Step |
|------|--------|-----------|
| API key auth | Implemented | Add persistence and bcrypt hashing |
| Rate limiting | Implemented | Add per-endpoint granularity |
| Budget enforcement | Implemented | Add monthly auto-reset |
| Logging | Implemented | Add structured JSON logging option |

### 4.2 Phase 3 / README roadmap items

| Item | Description |
|------|-------------|
| Multi-region deployment | Deploy gateway instances in multiple regions with shared Redis |
| Webhook notifications | POST to configurable URLs when budget thresholds are breached |
| Request/replay debugging | Store full request/response pairs for replay and debugging |
| Token counting before forwarding | Count tokens using tiktoken before proxying for accurate pre-estimation |
| Admin dashboard with live data | Connect both dashboards to the admin API |

### 4.3 Additional provider adapters

Currently: OpenAI, Anthropic, Mock.

**Action:** Add:
- **Google Gemini** — Gemini Pro API adapter
- **Cohere** — Cohere Generate/Chat API
- **Azure OpenAI** — Azure-hosted OpenAI with authentication differences
- **Local/Ollama** — Local model inference adapter

### 4.4 Semantic routing enhancement

`src/routing/semantic.py` (Python) sketches semantic query classification using embeddings to route requests to the best model. Not implemented in TypeScript.

**Action:** Port the semantic router to TypeScript:
- Classify queries by complexity/topic using embeddings
- Route simple queries to fast/cheap models (GPT-4o-mini)
- Route complex queries to powerful models (GPT-4o, Claude 3.5)
- Cache classification results

### 4.5 Multi-tenancy

`src/multi_tenancy/tenant.py` (Python) sketches tenant management with plan-based features. Not implemented in TypeScript.

**Action:** Port to TypeScript:
- Per-tenant configuration (allowed models, rate limits, budgets)
- Tenant isolation in audit logs and budget tracking
- Plan-based feature gating (free/pro/enterprise)

### 4.6 OpenTelemetry integration

No OpenTelemetry tracing for the gateway itself.

**Action:** Add OpenTelemetry SDK. Trace each request through the full middleware chain. Export to Jaeger/Zipkin via OTLP.

### 4.7 Response streaming metrics

Streaming responses don't track time-to-first-token or tokens-per-second.

**Action:** Add streaming-specific Prometheus metrics:
- `gateway_stream_time_to_first_token_seconds`
- `gateway_stream_tokens_per_second`
- `gateway_stream_total_duration_seconds`

### 4.8 A/B testing for routing

No mechanism to compare routing strategies.

**Action:** Add experiment framework: route X% of traffic through strategy A, rest through strategy B. Compare latency, cost, quality metrics. Expose results in admin API.

---

## 5. Implementation Priority Order

```
 1. Delete src/server.ts                                             (dead code)
 2. Delete or port Python files (tenant.py, circuit_breaker.py, semantic.py)  (language mismatch)
 3. Fix handler.test.ts compilation error                            (CI broken)
 4. Consolidate pricing data into shared/pricing.ts                  (maintenance risk)
 5. Improve cache key hashing (SHA-256)                              (collision risk)
 6. Add API key persistence and hashing                              (security)
 7. Update all stale documentation                                   (misleading docs)
 8. Enhance TypeScript circuit breaker with HALF_OPEN                (reliability)
 9. Add ESLint configuration                                         (code quality)
10. Connect dashboards to real admin API                             (mock data removal)
11. Add guardrails tests                                             (0% coverage)
12. Add streaming tests                                              (0% coverage)
13. Add fallback chain tests                                         (minimal coverage)
14. Add graceful shutdown                                            (operational maturity)
15. Improve budget estimation accuracy                               (cost accuracy)
16. Add request field size validation                                (security)
17. Implement Phase 3 roadmap items                                  (feature growth)
```
