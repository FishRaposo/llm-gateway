# Diagnostic repair candidate — 2026-10-28

This branch fixes reproduced boundaries; connected/browser acceptance remains
pending. No live provider credential or generative model was used.

- API-key model allowlists and chat permissions apply before routing and again
  to selected/fallback models. Authentication/policy/budget/rate errors retain
  their intended HTTP statuses.
- Client correlation headers do not deduplicate provider execution. Every
  dispatched attempt gets a separate server accounting identity and is charged
  separately. No exactly-once provider guarantee is claimed.
- Missing provider usage and unpriced models have unknown cost provenance.
  Unknown settlement retains the admission reservation for explicit later
  reconciliation; it never establishes zero spend. The frozen price table is
  unchanged and is not a current billing quote.
- Redis clients explicitly connect before issuing commands with offline queues
  disabled. Budget status/remaining reads use atomic Lua for any period reset,
  so a delayed read cannot overwrite a concurrent settlement.

The declared integration command now has its missing configuration and actual
Redis tests. Start a disposable loopback Redis-compatible instance, then run:

```powershell
$env:GATEWAY_TEST_REDIS_URL='redis://127.0.0.1:19619'
npm run test:integration
```

The suite requires an explicit numeric loopback URL, uses unique account/cache
keys, and never clears a database. It checks real strict connection/admission,
cross-tracker persistence, cache backend writes, and delayed read versus actual
Lua settlement. Unit mocks remain separate from this connected evidence.

Open acceptance includes actual HTTP restricted/repeated/uncertain requests,
provider-fixture streaming/abort behavior, strict readiness with unavailable
storage, restart durability and dashboard browser checks. Application budgets
are estimates and must not be described as absolute provider billing caps.
