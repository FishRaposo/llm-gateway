# Security Guide

## Secrets Management

### API Key Security

Gateway uses bcrypt-hashed API keys:

```yaml
# config.yaml
api_keys:
  - name: production-app
    key_hash: $2b$12$...  # bcrypt hash
    rate_limit_rpm: 60
    budget_usd: 100.0
```

### Provider API Keys

Store provider keys as environment variables:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

Never commit these to git.

### Policy Enforcement

Gateway enforces:
- Content filtering (regex patterns)
- Model restrictions per key
- Budget limits per key
- Rate limits per key

## Security Checklist

- [ ] API keys use bcrypt (not plaintext)
- [ ] Provider keys in env vars only
- [ ] Content policies configured
- [ ] Rate limits enabled
- [ ] Audit logging enabled
