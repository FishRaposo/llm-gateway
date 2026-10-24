# Portfolio verification — llm-gateway

How to independently verify this project, and what each gate actually proves.

## Gates (all runnable without credentials)

Backend (repo root):

```bash
npm ci                  # clean install — pinned toolchain (see Toolchain below)
npx tsc --noEmit        # typecheck
npm run lint            # real ESLint (not just tsc)
npx vitest run          # 177 tests / 25 files — unit, integration-shaped,
                        # concurrency, durability, Redis-resilience, stream semantics
npx tsx scripts/benchmark_portfolio_gateway.ts
                        # atomic budget benchmark: concurrent reserve, sequential
                        # settle, idempotent replay (in-memory backend, no Redis)
```

Dashboard (`dashboard/`):

```bash
npm ci
npm run lint            # flat eslint.config.mjs (core-web-vitals)
npx vitest run          # 41 tests / 4 files — helpers, reducer invariants, console states
npm run build           # Next 16 production build -> static export in dist/
npx playwright install chromium
npx playwright test     # 10 tests on chromium + mobile-chromium incl. axe wcag2a/aa
```

CI runs all of the above as separate jobs (`.github/workflows/ci.yml`).

## What the evidence does and does not prove

- **177 backend tests** cover routing, fallback/circuit-breaker, cache TTL and
  account-scoped keys, the atomic budget reserve/settle/release lifecycle under
  concurrency, idempotent settle/release replay, SQLite persistence across restart,
  Redis outage/reconnect via a fake `ioredis` client (no Docker required),
  stream-semantics invariants (pre-content-only fallback, single `[DONE]`,
  partial-stream error, abort propagation), and account-identity isolation.
  Redis-mode atomicity uses the same Lua scripts through a mocked client; a live
  Redis end-to-end run is available via `docker compose` but is **not** part of
  the credential-free gate.
- **Benchmark numbers** are single-process in-memory timings (concurrent reserve
  ~6.4 ms mean at 200-way contention, sequential settle ~0.2 ms, idempotent
  replay ~0.08 ms at the time of capture). They demonstrate the atomic path and
  the shared-connect design, **not** production throughput.
- **Dashboard e2e** runs against the static export with no backend — it exercises
  the real connected-failure journey (SWR error → "Gateway unreachable" fixture
  banner) and the guided scenario reducer, not a live gateway. Demo/fixture data
  is labeled in the UI.
- **Mock provider** responses are deterministic; no claim is made about real
  provider behavior beyond adapter-level request/response translation tests.

## Honest limitations

- Live-provider and live-Redis paths require services not assumed present in a
  portfolio environment; they are exercised in Docker/CI-compatible form only.
- `src/index.ts` still performs startup wiring at module load; the server binds
  in `main()` but importing the module initializes storage. Tests work around
  this; a future refactor should fully separate app construction from binding.
- `bcryptjs` remains the API-key hasher (no native dependency — deliberate for
  clean-install portability; documented trade-off vs `bcrypt`).
- `npm audit` shows 3 moderate advisories inside Vitest's dev-only mock chain
  with no published fix at capture time; they do not affect runtime dependencies.

## Toolchain pins (why)

- `typescript ~6.0.3` — `@typescript-eslint/* ^8.67` peers `>=4.8.4 <6.1.0`;
  `^7` broke `npm ci` (ERESOLVE) and `^` could drift past the bound.
- Dashboard `eslint ^9` — Next's transitive lint plugins do not yet support
  ESLint 10; the root gateway package uses ESLint 10 where peers allow.
- Node 20+ for the backend and dashboard CI jobs.
