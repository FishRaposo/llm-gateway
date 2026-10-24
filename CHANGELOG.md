# Changelog

## [1.1.0] — 2026-10-24

Flagship audit-and-repair pass on `feat/gateway-portfolio`. See
`docs/portfolio-handoff.md` for the full record and
`docs/portfolio-verification.md` for reproducible gates.

### Fixed

- **Clean install**: `typescript ^7.0.2` vs `@typescript-eslint` peer `<6.1.0`
  broke `npm ci` (ERESOLVE). Pinned `typescript ~6.0.3`, aligned parser/plugin
  to `^8.67`, regenerated the lockfile; removed unused `bcrypt`/`@types/bcrypt`
  and stub `@types/uuid`/`@types/bcryptjs`.
- **Lint coverage**: CI now runs the real ESLint job (previously `tsc` only).
- **Account identity**: billing, audit, cache, and rate-limit keys now use a
  canonical `accountId`; streamed spend no longer bypasses per-key budgets;
  rate-limit keys no longer embed plaintext API-key material.
- **API-key validation**: O(N) synchronous bcrypt scan replaced by a SHA-256
  fingerprint index (self-healing for legacy rows); `ApiKeyStore.close()` added.
- **Budget accounting**: non-atomic GET→SET replaced by Redis Lua
  reserve/settle/release with per-request-id idempotency; in-memory backend
  mirrors the same semantics; `Infinity` limits no longer serialize to `null`.
- **Honest failures**: accounting/audit/cache failures surface instead of being
  silently swallowed; `STRICT_STORAGE=true` makes Redis/SQLite availability a
  readiness requirement while portable mode degrades explicitly.
- **Streaming**: client aborts propagate to all provider streams; fallback is
  restricted to pre-content; post-content failures emit an explicit partial-
  stream terminal error; exactly one `[DONE]` marker.
- **Dashboard a11y**: scrollable audit-table region is keyboard-focusable.

### Added

- Tests: `accountIdentity`, `budgetLifecycle`, `streamSemantics`,
  `storageDurability`, `redisResilience` (177 backend tests total, 25 files).
- `scripts/benchmark_portfolio_gateway.ts` — atomic budget lifecycle benchmark.
- Dashboard: Next 16.4.3 + React 19.3.1 + flat ESLint; `scenarioReducer`
  single-source simulation; `provider_outage` scenario with recover/reset;
  41 unit tests; 10 Playwright tests (desktop + mobile) incl. axe wcag2a/aa
  against the static export; dashboard CI job.
- Docs: `docs/portfolio-verification.md`, `docs/portfolio-handoff.md`.

### Changed

- Dashboard production output is a static export (`output:'export'` → `dist/`),
  served for e2e by `scripts/serve-dist.mjs`.
- MIT `LICENSE` added (matches portfolio siblings).
