# Insight: JWT_SECRET Needs Startup Guard — Never Fallback to Weak Default
**Date:** 2026-03-04 | **Area:** iam | **Category:** security/HIGH

## Context
Review of IAM-01 found that auth-service.ts falls back to `'dev-secret-change-me'` when JWT_SECRET env var is missing, while tenant.middleware.ts uses non-null assertion `process.env.JWT_SECRET!`.

## Insight
This creates a split-brain scenario:
- Token SIGNING uses weak fallback `'dev-secret-change-me'`
- Token VERIFICATION uses `undefined` (crashes or always fails)

**Correct pattern:**
```typescript
// At application startup (server.ts), BEFORE any route registration:
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 chars')
  process.exit(1)
}
```

Never use a fallback for security-critical env vars. Fail fast at startup, not at request time.

## Impact
- Add startup guards for ALL security env vars: JWT_SECRET, ENCRYPTION_KEY
- Add to security.md rule: "Security env vars MUST fail at startup, NEVER use defaults"
