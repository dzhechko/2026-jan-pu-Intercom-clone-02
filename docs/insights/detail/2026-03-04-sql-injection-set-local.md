# Insight: SQL Injection in SET LOCAL — Use set_config() Instead
**Date:** 2026-03-04 | **Area:** shared, iam | **Category:** security/CRITICAL

## Context
Code review of tenant middleware and ws-handler found string interpolation in SQL context-setting.

## Insight
```typescript
// WRONG — SQL injection vector
await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`)

// CORRECT — parameterized
await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
```

`set_config(name, value, is_local)` with `is_local=true` is equivalent to `SET LOCAL` but accepts parameterized values. The third parameter `true` means the setting is local to the current transaction.

**Found in 4 locations:**
- `src/shared/middleware/tenant.middleware.ts`
- `src/conversation/infrastructure/ws-handler.ts` (2 occurrences)
- Various route handlers

Zod UUID validation on input mitigates but does NOT eliminate the risk — defense in depth requires parameterized queries at every layer.

## Impact
- Must replace ALL `SET LOCAL` string interpolation with `set_config($1, true)`
- Add to coding standards: NEVER use string interpolation in SQL, even for GUC settings
