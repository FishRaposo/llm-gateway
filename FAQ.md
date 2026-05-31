# LLM Gateway FAQ

## Q: How do I add a new provider?
**A:** Add an entry to the `providers` array in `src/server.ts` with name, URL, and priority.

## Q: How does caching work?
**A:** Responses are cached in Redis with a TTL. The cache key is a hash of the request body.

## Q: Can I use this in production?
**A:** The current implementation is a scaffold. Add auth, rate limiting, and budget enforcement before production use.
