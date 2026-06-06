# Contributing to LLM Gateway

## Architecture Overview

The LLM Gateway is an Express-based proxy that sits between applications and LLM providers (OpenAI, Anthropic). Every request flows through a middleware chain before reaching the router and provider layer.

### Middleware Chain (execution order)

```
Auth -> Policy -> Budget -> Cache -> RateLimit -> Router -> Provider
```

1. **Auth** (`src/middleware/auth.ts`) — Validates the `Authorization: Bearer <key>` header against registered API keys. Rejects with 401 if missing or invalid.
2. **Policy** (`src/middleware/policy.ts`) — Evaluates policy rules (content filtering, model restrictions, PII detection, request modification) against the incoming request. Rejects with 403 if denied.
3. **Budget** (`src/middleware/budget.ts`) — Estimates request cost and checks remaining budget for the API key. Rejects with 402 if exceeded.
4. **Cache** (`src/middleware/cache.ts`) — Checks Redis for an identical cached response. Returns cached result immediately on hit, skipping the provider call.
5. **RateLimit** (`src/middleware/rateLimit.ts`) — Enforces requests-per-minute limits per API key. Rejects with 429 if exceeded.
6. **Router** (`src/routing/router.ts`) — Evaluates routing rules (model preference, cost optimization, latency optimization, fallback chains) to select the best provider and model.
7. **Provider** (`src/providers/base.ts`, `openai.ts`, `anthropic.ts`, `mock.ts`) — Translates the request into the provider's native format, sends the API call, and normalizes the response back to OpenAI-compatible format.

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/middleware/` | Middleware functions executed in the request pipeline |
| `src/providers/` | Provider adapters (OpenAI, Anthropic, Mock) |
| `src/proxy/` | Core request/response parsing and the main handler |
| `src/routing/` | Routing engine with rule evaluation and fallback logic |
| `src/storage/` | Storage backends (SQLite for audit logs, Redis for cache/budget) |
| `src/types/` | TypeScript type definitions and interfaces |
| `src/admin/` | Admin API routes and dashboard aggregations |
| `config/` | YAML configuration files (routing, policy, budgets) |
| `tests/` | Vitest test files |
| `data/` | SQLite database and persistent data |

## Quick Start

```bash
git clone <repo-url> && cd llm-gateway
npm install
cp .env.example .env
cp config/routing.example.yaml config/routing.yaml
cp config/policy.example.yaml config/policy.yaml
cp config/budgets.example.yaml config/budgets.yaml
docker compose up redis -d
npm run dev
```

Send a test request:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer gateway-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'
```

## How to Add a New Provider

1. **Create the provider class** in `src/providers/` extending `BaseProvider`:

```typescript
import { BaseProvider } from "./base";
import type { ProviderRequest, ProviderResponse, ModelInfo, ProviderHealth } from "../types/provider";

export class NewProvider extends BaseProvider {
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    // Translate ProviderRequest to the provider's native format
    // Make the API call
    // Normalize the response to ProviderResponse format
  }

  async *streamComplete(request: ProviderRequest): AsyncIterable<ProviderResponse> {
    // Handle streaming responses
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Check provider availability
  }

  getModelInfo(model: string): ModelInfo {
    // Return model capabilities and pricing
  }
}
```

2. **Register the provider** in `src/providers/registry.ts` — add a `case` to the `switch` in `getProvider()`.
3. **Add to TypeScript types** — update the provider `type` union in `src/types/index.ts` if adding a new type literal.
4. **Configure in `.env`** — add environment variables for the provider's API key and optional base URL.
5. **Add tests** — create tests in `tests/` using the mock provider pattern.

## How to Add New Middleware

1. **Create the middleware file** in `src/middleware/`:

```typescript
import type { GatewayConfig } from "../types";
import type { RequestContext } from "../types/routing";
import type { MiddlewareFunction } from "../proxy/handler";

export function createMyMiddleware(config: GatewayConfig): MiddlewareFunction {
  return async (context: RequestContext, _config: GatewayConfig): Promise<RequestContext | null> => {
    // Perform your logic on the context
    // Return context to continue the chain
    // Return null to stop (response already sent)
    // Throw an error to abort with a specific status code
    return context;
  };
}
```

2. **Register it** in `src/index.ts` — add it to the `buildMiddlewareChain` array at the desired position.
3. **Write tests** — follow the patterns in existing test files.

## How to Add Routing Rules

Routing rules are defined in `config/routing.yaml`. Each rule has:

- `type`: One of `model_preference`, `cost_optimize`, `latency_optimize`, `fallback_chain`
- `priority`: Higher values are evaluated first
- Provider/model-specific fields (depends on type)

Example:

```yaml
rules:
  - type: model_preference
    priority: 10
    model: gpt-4o
    provider: openai

  - type: fallback_chain
    priority: 5
    models: [gpt-4o, gpt-4o-mini]
    chain:
      - provider: openai
        model: gpt-4o
      - provider: anthropic
        model: claude-sonnet-4-20250514
```

To add a new routing strategy:

1. Add a new type to the `RoutingRule` interface in `src/types/index.ts`
2. Add a case to `evaluateRule()` in `src/routing/rules.ts`
3. Write the evaluation function that returns a `RoutingDecision | null`

## Testing with Vitest

```bash
npm test                 # Run all tests once
npm run test:watch       # Watch mode for development
```

**Test patterns:**

- Use `describe`/`it` blocks from `vitest`
- Import from `vitest`: `describe`, `it`, `expect`, `beforeEach`, `vi`
- Mock providers use `MockProvider` from `src/providers/mock.ts`
- Storage backends automatically fall back to in-memory when Redis is unavailable
- Use `CacheStore("redis://localhost:0")` for in-memory cache testing
- Use `BudgetTracker("redis://localhost:0")` for in-memory budget testing

**Writing new tests:**

1. Create a file in `tests/` named `feature-name.test.ts`
2. Import the module under test: `import { myFunction } from "../src/module/myFile"`
3. Use `beforeEach` to set up test state
4. Use `as any` sparingly for partial types in test fixtures
5. Test both success and error paths

## PR Process

1. **Fork and branch** from `master`
2. **Write tests first** for new features or bug fixes
3. **Run the full suite**: `npm test` and `npm run lint`
4. **Update docs** if adding new configuration options or provider support
5. **Open a pull request** with a clear description of the change and why it's needed
6. **CI checks** must pass: lint, test, build, and docker-build

### Commit Convention

- `feat:` — New feature
- `fix:` — Bug fix
- `refactor:` — Code restructuring
- `test:` — Adding or updating tests
- `docs:` — Documentation changes
- `chore:` — Build, CI, or tooling changes

### Code Style

- TypeScript strict mode
- No inline comments (explanatory code beats comments)
- 2-space indentation
- Follow existing patterns in the codebase
- Use `const` over `let`, avoid `var`
- Prefer explicit types over inference when the type isn't obvious
