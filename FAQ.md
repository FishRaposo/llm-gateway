# LLM Gateway FAQ

## Q: How do I add a new provider?
**A:** Define the provider adapter class in `src/providers/` (extending `BaseProvider`), register the provider type inside the factory switch in `src/providers/registry.ts`, and configure the provider's API key in your `.env` file. See `CONTRIBUTING.md` for a complete step-by-step guide.

## Q: How does caching work?
**A:** Non-streaming responses are hashed using SHA-256 and stored in Redis with a configurable TTL. The cache key is a deterministic hash of the model, messages, temperature, and maxTokens. Streaming requests bypass the cache.

## Q: Can I use this in production?
**A:** Yes! The gateway has been fully enhanced with production-grade middleware including API key authentication (persistent in SQLite with bcrypt hashing), Redis sliding-window rate limiting, per-key monthly budget tracking/enforcement, fallback routing, and safety/PII guardrails.
