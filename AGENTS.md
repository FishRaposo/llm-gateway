# AGENTS.md — llm-gateway

## What This Is

An enterprise **LLM proxy** (TypeScript / Express) that routes requests across providers
(OpenAI, Anthropic, Gemini, Ollama, mock) behind an OpenAI-compatible API, with automatic
fallback, response caching, rate limiting, per-API-key budget enforcement, policy/guardrails,
an append-only audit log, and Prometheus metrics. Migrated out of `General Projects/`.

## TypeScript peer — no `shared_core`

This is a **pure TypeScript** project. `shared_core` is a Python library, so llm-gateway
does **not** consume it — exactly like `game-systems-sandbox`. The migration conformed the
**meta-structure only** (Makefile vocabulary, docs, AGENTS, registration, container names);
the application code is unchanged. Cross-language alignment with the Python
`llm-cost-latency-monitor` is tracked as follow-ups (see roadmap.md), not code sharing.

## Layout

```
llm-gateway/
├── src/
│   ├── index.ts                 # Express app entry
│   ├── config.ts                # env + YAML config loading
│   ├── providers/               # openai, anthropic, gemini, ollama, mock, base, errors
│   ├── middleware/              # auth, policy, budget, cache, rateLimit, logging
│   ├── routing/                 # router + rule evaluation
│   ├── proxy/streaming.ts       # SSE streaming
│   ├── guardrails/  storage/    # auditLog (SQLite), cacheStore (Redis), budgetTracker, apiKeyStore
│   ├── metrics.ts  admin/       # Prometheus metrics, admin routes
├── dashboard/                   # optional Next.js admin dashboard
├── config/                      # routing/policy/budget example YAML
├── data/sample/  tests/  scripts/  docs/
├── docker-compose.yml           # llm_gateway + llm_gateway_redis
├── Makefile  package.json  tsconfig.json  eslint.config.mjs  .env.example
└── .github/workflows/ci.yml
```

## Commands

```bash
make install      # npm ci
make dev          # tsx watch src/index.ts
make build        # tsc -> dist/
make test         # vitest run  -> 149 passing (backend); dashboard has 27 more
make lint         # tsc --noEmit + eslint
make typecheck    # tsc --noEmit
make docker-up    # redis + gateway
make demo         # build + print a sample OpenAI-compatible request
```

## Current State

**Functional, migrated, green, hardened.** `tsc --noEmit` clean; **149 backend vitest tests
pass** (20 files), plus **27 dashboard tests** (3 files); `eslint .` clean; `next build` green.
Storage degrades gracefully: when the native `better-sqlite3` binding is unavailable (e.g. no
C++ build tools), the API-key/audit stores fall back to in-memory — the full test suite runs
without compilation.

The root vitest suite is scoped to `tests/` via `vitest.config.ts`; the dashboard has its own
jsdom vitest project under `dashboard/`. `src/shared/pricing.ts` carries the per-1M
rates (`MODEL_PRICING_PER_1M`) mirrored from `shared_core.pricing` — the lineage is
**frozen at the archived shared-core v1.3.0** (2026-08-13), the table is self-owned, and
the frozen parity snapshot is pinned by `tests/pricing.test.ts`. The optional Next.js dashboard gained a demo-mode fallback, an
`ErrorBoundary`, extracted testable helpers, component tests, and an optional Playwright smoke
spec.

## Follow-ups (cross-language alignment, ticket-only)

- ✅ Audit-log column schema and Prometheus label keys (`llm_gateway_*`) documented as a
  superset of the Python `llm-cost-latency-monitor` `LLMCall` cost-record and pinned by
  `tests/monitorAlignment.test.ts` so one dashboard reads both.
- ✅ Pricing table mirrors `shared_core.pricing` (data parity, `MODEL_PRICING_PER_1M`) —
  lineage frozen at the archived v1.3.0; the table is self-owned and parity-tested.
- ⏭️ `claude-3-5-haiku` rate diverges from the frozen shared-core snapshot (1.0/5.0 vs 0.8/4.0); deferred because
  changing it would move existing cost outputs (golden-gated). Pinned + tracked in roadmap.md.
- ✅ Canonical-gateway question settled 2026-08-12: `knowledgeops` (incl. `services/llm-gateway`) was consolidated into groundtruth and archived on GitHub — this standalone gateway is the canonical one.

## When to Update This AGENTS.md

- Provider adapters, middleware chain, or storage backends change
- Makefile targets, docker-compose services, or CI steps change
