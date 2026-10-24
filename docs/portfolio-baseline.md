# Portfolio baseline — llm-gateway

Recorded 2026-10-24 against `552a6b5` (main), before any audit changes.

## Reproduced environment failures

- `npm ci` fails with `ERESOLVE`: declared `typescript@^7.0.2` violates
  `@typescript-eslint/eslint-plugin@8.67.0` peer `typescript >=4.8.4 <6.1.0`.
  `@typescript-eslint/parser@8.60.0` also violates the plugin's own
  `@typescript-eslint/parser@^8.67.0` peer. No ordinary clean install exists;
  the hosted CI run for this commit
  (https://github.com/FishRaposo/llm-gateway/actions/runs/36207726881)
  failed at install. AGENTS.md's "149 backend tests pass" is therefore an
  unverified historical claim at this HEAD, not observed behavior.
- `dashboard/` `npm run lint` invokes `next lint`, which Next.js 16 removed.

## Source-inspected defects (verified before repair)

1. `src/proxy/streaming.ts` deducts spend under `context.apiKey` (plaintext)
   while `src/proxy/handler.ts` deducts under `apiKeyId` — streamed spend
   escapes the per-key budget identity; a key's streaming usage is never
   charged to its configured budget.
2. `src/proxy/streaming.ts` may write provider chunks, then fall back on a
   later error and write a complete second response plus `[DONE]` — a mixed
   completion in one stream. The fallback is also a different JSON shape than
   SSE chunks.
3. `src/storage/budgetTracker.ts` mutates spend via GET→modify→SET on Redis
   (lost updates under concurrency), scans `KEYS budget:*` for global spend,
   and silently degrades to a process-local `Map` when Redis is unavailable —
   per-process budgets diverge with no indication.
4. `storage.auditLog.write(...)` and `budgetTracker.deductBudget(...)` are
   invoked with `.catch(() => {})` in both handlers — audit and accounting
   failures are swallowed without any visible reconciliation state.
5. `src/middleware/cache.ts` cache keys contain model/messages/options only —
   no account identity. Distinct API keys share cached completions
   (cross-tenant response disclosure).
6. `src/index.ts` listens on import (module side effect), and
   `initializeStorage` runs twice (once in `createApp`, once at module scope);
   only the second instance set is closed on shutdown.
7. `src/storage/apiKeyStore.ts` `validate()` performs O(N) synchronous bcrypt
   comparisons over all rows; a handful of keys makes every request spend
   hundreds of ms on the event loop.
8. `/health` hardcodes `"version": "1.0.0"`; version is not single-sourced.
9. `bcrypt` (native) is declared but the code only imports `bcryptjs`.
10. No explicit runtime mode distinguishes durable (SQLite/Redis) operation
    from in-memory development behavior; persistence claims cannot be
    distinguished from best-effort defaults.

## Baseline evidence to preserve

- Original `package-lock.json`, `package.json`, `eslint.config.mjs`.
- Pricing table frozen at shared-core v1.3.0 lineage
  (`src/shared/pricing.ts`, pinned by `tests/pricing.test.ts`); the
  `claude-3-5-haiku` divergence is documented in AGENTS.md, not to be "fixed"
  here.
- `dashboard/src/lib/dashboard-data.ts` simulated controls — retained as
  fixture-driven preview, never evidence of real failure injection.
