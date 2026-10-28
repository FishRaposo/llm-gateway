# Case study — LLM Gateway

*How this project came to be, what it decides, what the evidence shows, and where it
honestly stops. All numbers here are measured by the commands in
[portfolio-verification.md](portfolio-verification.md) — nothing below is a
projection or a production claim.*

## The problem it prevents

An application that calls LLM providers directly has four unmanaged failure modes:
a provider outage takes the product down; one runaway agent can burn an unbounded
budget; nothing records who asked what or what it cost; and policy enforcement
(blocked models, PII rules) lives scattered across every caller. The gateway is the
single control point where those four concerns converge — the thesis in the README:
**the proxy is the control point**.

## The approach

Every request walks one ordered middleware chain — auth → policy → budget → cache →
rate limit → router — with each concern isolated and independently testable. The
router selects a provider/model from versioned YAML rules; on failure a fallback
chain tries the next provider; an append-only SQLite audit log and Prometheus
metrics capture the aftermath; per-account (not per-key-material) identities key
budgets, cache entries, rate limits, and audit rows.

## The interesting engineering decisions

| Decision | What made it hard | How it was settled |
|---|---|---|
| **Streaming + fallback interaction** | Naive retry after tokens have already flowed would show the user a doubled or mismatched completion | Fallback is allowed only **before** any content is emitted; after that the client gets an explicit partial-stream error instead of a disguised second completion. Locked by stream-semantics tests (pre-content-only fallback, single `[DONE]`, abort propagation into provider streams). |
| **Storage availability vs correctness** | A portfolio/integration environment has no Redis or C++ toolchain, but a gateway silently degrading is exactly the kind of hidden behavior this project exists to expose | Default portable mode degrades budgets/cache/rate-limit to in-memory with explicit labeling; `STRICT_STORAGE=true` makes Redis/SQLite availability a readiness requirement instead. The full test suite runs without native bindings. |
| **Cost numbers must not drift silently** | Model prices change; a refactor that moved a cost constant would corrupt every historical report | The pricing table is pinned by a frozen golden snapshot (`tests/pricing.test.ts`, lineage frozen at the archived shared-core v1.3.0); the known `claude-3-5-haiku` divergence is documented and gated, not silently "updated". |
| **Atomic accounting under concurrency** | Reserve/settle/release races can double-charge or free budget twice | Atomic budget lifecycle with idempotent settle/release replay; measured by the portfolio benchmark under 200-way contention (single-process, in-memory: ~6.4 ms mean reserve, ~0.2 ms settle, ~0.08 ms replay) — demonstrating the atomic path, not production throughput. |

## What the evidence shows

- **177 backend tests / 25 files, 41 dashboard tests / 4 files** — routing,
  fallback/circuit-breaker, cache TTL, budget lifecycle under concurrency,
  SQLite durability across restart, Redis outage/reconnect with a fake client,
  stream semantics, account-identity isolation.
- `tsc --noEmit` and ESLint clean; `next build` green; 10 Playwright browser
  tests (desktop + mobile, including an axe accessibility pass).
- The dashboard demo reducer keeps provider health, budgets and audit rows

 consistent — every simulated request appends exactly one audit row.

## What went wrong along the way

- The first storage design trusted the native `better-sqlite3` binding;
  environments without build tools simply didn't start. The fallback had to be
  made explicit and labeled — including the `STRICT_STORAGE` escape hatch —
  because "silently in-memory" is a correctness lie for a budget enforcer.
- Golden cost tests caught at least one intended pricing merge that would have
  moved historical outputs; the divergence is now a ticket, not a diff.

## What I would do next

Multi-region behind a load balancer with shared Redis state (design exists,
untested); webhook budget alerts; token counting before forwarding. None is
started; the roadmap marks them open.

## Sixty-second explanation

"Applications were calling OpenAI and Anthropic directly: when a provider went
down, the product went down; when an agent looped, the bill went up; and nobody
could answer 'what did feature X cost last month'. I built the proxy that sits in
the middle: one OpenAI-compatible endpoint, versioned routing rules with automatic
failover, per-account budgets that reserve and settle atomically, guardrails that
run before the model is ever called, and an append-only audit log with cost
attribution. The streaming path is the part I'm proudest of — fallback only
happens before the first token, so a recovering provider can never show a user a
franken-completion, and that invariant is locked by tests. Everything runs
credential-free: 177 backend and 41 dashboard tests, typecheck clean, and the
atomic budget path is benchmarked under 200-way contention."

## Limits (stated plainly)

- No production deployment, throughput, uptime or real-bill claim is made.
- Benchmark numbers are single-process and in-memory by design.
- Live Redis and live provider paths are exercised in Docker/CI-compatible form;
  the credential-free gate does not include them.
- Real provider behavior is covered by adapter-level request/response translation
  tests only — the mock provider is deterministic and the README says so.
