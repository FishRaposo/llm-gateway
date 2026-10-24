# Portfolio handoff — llm-gateway

## What changed in this pass (branch `feat/gateway-portfolio`)

The repository went through a flagship audit-and-repair pass after migration.
Pre-pass state: `npm ci` **failed** (TypeScript/ESLint peer conflict), lint was a
`echo`-style stub in practice (CI ran `tsc` only), and several accounting defects
were latent: streamed spend bypassed per-key budgets (deduction keyed to the raw
API-key string instead of a provisioned account), the budget tracker used
non-atomic GET→SET, `JSON.stringify(Infinity)` corrupted unlimited budgets into
`null`, cache keys were not account-scoped (cross-tenant leak risk), rate limits
were keyed by plaintext key material, API-key validation was an O(N) synchronous
bcrypt scan, accounting/audit failures were silently swallowed, and post-content
stream failures could append a full fallback completion after partial chunks.

Commits (reviewable units):

- `5f434b7` clean-install repair: TS `~6.0.3`, `@typescript-eslint ^8.67`, lockfile
  regen, real lint script, CI lint job, MIT LICENSE, dead dep removal (`bcrypt`,
  stub `@types/*`). Gates: `npm ci` + `tsc` + `eslint` + 149/149 tests.
- `afba897` canonical account identity: `context.accountId` flows through auth →
  budget → stream → audit → cache → rate-limit; SHA-256 fingerprint lookup for
  API keys (O(1) instead of O(N) bcrypt scan, self-healing for legacy rows);
  `ApiKeyStore.close()` added; 8 new identity tests (157/157).
- `1f2aad7` atomic budget lifecycle + stream semantics: Redis Lua
  reserve/settle/release with per-request idempotency; honest failure surfaces
  (settle/audit errors no longer `.catch(() => {})`); abort propagates into all
  five provider streams; fallback only before content; explicit partial-stream
  terminal error; single `[DONE]`; `costBasis` audit field (169/169).
- `61f7f87` storage/evidence: `STRICT_STORAGE` readiness mode vs explicit portable
  in-memory fallback; shared in-flight Redis connect + bounded retry backoff
  (concurrent benchmark 19 ms → 6.4 ms mean); SQLite restart-durability test;
  fake-ioredis outage/recovery suite; `scripts/benchmark_portfolio_gateway.ts`
  (177/177).
- `e616315` lint cleanup (unused directive).
- `975bdb3` dashboard: Next 16.4.3 + React 19.3.1 + flat ESLint (`next lint`
  removed upstream); three `useState` simulation values consolidated into
  `scenarioReducer`; `provider_outage` scenario + recover/reset; production-build
  Playwright (static `dist/` via `output:'export'` + `serve-dist.mjs`) on
  chromium + mobile-chromium incl. axe; real a11y fix (scrollable audit region
  keyboard access); dashboard CI job (41 unit + 10 browser tests).

## Verified gates (this pass)

`npm ci` → `tsc --noEmit` → `eslint` → `vitest run` (177) → benchmark;
dashboard `npm ci` → `eslint` → `vitest` (41) → `next build` → `playwright test` (10).
See `docs/portfolio-verification.md` for what each gate proves and its boundaries.

## Deferred / known limitations

- Live-Redis and live-provider execution need services/credentials not assumed in
  a portfolio environment — portable profile + Docker paths documented honestly.
- `src/index.ts` still initializes storage at import time (works, but should be
  refactored to a pure app factory).
- `bcryptjs` kept for clean-install portability (documented trade-off).
- 3 moderate dev-only npm advisories in the Vitest chain, no published fix.
- Vitest prints a CJS/ESM config warning (`vitest.config.ts` loaded as CJS);
  cosmetic — all tests pass.

## Next actions

- Optional: app-factory refactor for `src/index.ts`; live-Redis CI job via
  service container; webhook budget alerts (roadmap).
