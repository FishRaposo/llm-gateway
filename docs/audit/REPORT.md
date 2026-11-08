# L1 Production Audit — llm-gateway

**Date:** 2026-10-30 · **Scope:** engineering audit (not a security certification)
**Target:** `portfolio/llm-gateway` @ pre-fix HEAD · **Checklist:** FTH-030 L1
(auth/access, secrets/config, data validation, error handling/logging,
AI failure modes, API-bill exposure)

## Verdict

Substantially hardened baseline (bcrypt key store, masked audit log, atomic
budget reservations, retryable-aware fallback, account-scoped cache). Three
exploitable gaps found and fixed with regression tests; five documented for
follow-up. Backend suite: 29 files / 246 tests green; `tsc --noEmit` and
`eslint .` clean.

## Fixed findings (with tests)

### F1 — HIGH: Public default admin credential accepted in production

`config.ts` defaulted `gatewayApiKey` to `"gateway-admin-key"`; `auth.ts`
grants any request bearing it `["*"]` permissions (admin routes, key
creation, budget edits). Unlike the mock provider (`resolveMockEnabled`),
no production guard existed — a deploy that forgot `GATEWAY_API_KEY`
served open admin access with a credential printed in the source tree.

**Fix:** `resolveAdminApiKey()` throws at config load when `NODE_ENV=production`
and the key is unset/empty/still-default; non-production keeps the default for
fresh-clone demos. Three existing production-mode tests updated to set a
private key (proving the guard fires).

**Evidence:** `src/config.ts` `resolveAdminApiKey`; `tests/l1Audit.test.ts` F1
block (4 cases); `tests/mockMode.test.ts` prod suites.

### F2 — HIGH: Unvalidated request fields + silent `tool`-role drop

`parseRequest` never checked `model`, `temperature`, or `max_tokens` types —
non-numbers, negatives, and unbounded integers passed straight to providers
(and into the budget estimate). Worse, `buildProviderRequest` ran
`.filter((m) => m.role !== "tool")`: a client sending tool-call results had
its conversation silently truncated before the model saw it — wrong answers
with no signal.

**Fix:** `parseRequest` now requires `role ∈ {system,user,assistant}` with a
clear error naming the offending role; `tool`/`function` roles get an explicit
"not forwarded" rejection (fail-closed rather than corrupting context — naive
forwarding would break Anthropic's tool_result contract anyway, so honest
rejection is the bounded fix). `model` must be a string; `temperature` a
nonnegative finite number; `max_tokens` a nonnegative integer ≤ 131,072 (above
every cataloged `maxOutputTokens`). The silent filter is removed.

**Evidence:** `src/proxy/request.ts` validation block; `tests/l1Audit.test.ts`
F2 block (8 cases incl. a no-silent-drop forwarding assertion).

### F3 — HIGH: Budget admission reserved input cost only

`estimateRequestCost` priced only prompt tokens. A one-token prompt reserved
$0.000005 while the same request, declaring `max_tokens: 8192`, could bill up to
$0.1229 in output at gpt-4o's $15/1M — per-key budgets were trivially overrun on
a single request, the exact API-bill exposure the gateway exists to prevent.

**Fix:** estimate now adds `min(maxTokens ?? ceiling, ceiling) × outputPrice`
using the cataloged model's `maxOutputTokens` (fallback 4096 for uncataloged
models; clamps negatives). For gpt-4o that is $0.061445 against the same
one-token prompt — the reservation now tracks the output the catalog says a
request can produce. Settlement still records actual spend. The residual is D5.

**Evidence:** `src/middleware/budget.ts` `estimateRequestCost`;
`tests/l1Audit.test.ts` F3 block (4 cases); `tests/budget.test.ts` updated to
derive its expected estimate via the exported function.

## Documented findings (recommended, not yet fixed)

| # | Sev | Finding | Recommendation |
|---|---|---|---|
| D1 | Med | Provider error bodies (≤500 chars) flow verbatim into client 502 `error.message` **and** the persisted audit `errorMessage` column (`providers/*.ts` `handleError`) | Return typed error text to clients; keep bounded body server-side only |
| D2 | Med | `z.any()` on `routing`/`policy`/`budgets` YAML sections — malformed operational config validates at load, misbehaves at request time | Replace with real Zod schemas mirroring `ProviderConfigSchema` |
| D3 | Low-Med | `/metrics` and `/health` unauthenticated (providers, models, volumes, mock state); `cors()` wildcard | Optional bearer on `/metrics`; scope CORS origins in prod |
| D4 | Low | `getGlobalSpend` runs `redis.keys("budget:*")` per request — O(keyspace) scan; global check is advisory-only | Track a single `budget:global` counter; SCAN if enumeration stays |
| D5 | Med | **F3's fix is a clamp, not a guarantee.** The reservation uses the catalog's `maxOutputTokens`, so a client declaring above it (`gpt-4o`: 4,096 catalogued) reserves only the ceiling. If the provider honours the larger declared value, one in-flight request per key can overshoot the reserved amount by the difference before settlement records the actual spend | Either reject `max_tokens` above the catalogued ceiling, or size the catalog to the provider's real limit |

## Checked and cleared

- **Cross-tenant cache:** keys scoped to `accountId ?? apiKeyId ?? hash(apiKey)`; auth runs before cache in the chain.
- **Rate-limit identity:** runs after auth → canonical `accountId` in normal flow; plaintext fallback unreachable for valid requests.
- **Audit credential storage:** raw keys masked before persist (`accountId ?? maskApiKey`) and on read for legacy rows.
- **Provider registry staleness:** keys come from env only; `dotenv` won't hot-override `process.env`, so no rotation path exists to break.
- **Fallback/streaming:** honors `retryable === false`, model allowlists, circuit breaker; SSE terminal-marker + settle/release/disconnect lifecycle is careful.
- **Budget lifecycle:** atomic Redis Lua reserve/settle/release, requestId idempotency, in-memory fallback.
- **Admin routes:** require bootstrap key or stored `*` permission; key creation enforces budget under record id.
- **Guardrails/policy:** always-on pre-check, per-message sanitization write-back, `max_tokens` clamp rules run *before* budget middleware (correct ordering — but only when policy is enabled).

## Eval set

`eval-set.json` — 12 probe cases derived from the failure modes, each with the
request, the pre-fix behavior, and the expected post-fix behavior. Executed
by `tests/l1Audit.test.ts` (15 tests, all passing).
