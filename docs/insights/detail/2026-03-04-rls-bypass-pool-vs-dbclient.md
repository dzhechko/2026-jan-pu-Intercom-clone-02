# Insight: RLS Bypass — pool.query() vs req.dbClient.query()
**Date:** 2026-03-04 | **Area:** iam, conversation, integration | **Category:** security/CRITICAL

## Context
During brutal honesty review of 6 early features (FR-01 through IAM-01), discovered that RLS tenant isolation is bypassed in multiple locations.

## Insight
The tenant middleware correctly acquires a dedicated PoolClient, sets `app.tenant_id` via `SET LOCAL`, and attaches it as `req.dbClient`. However, repositories and route handlers use `pool.query()` (shared pool) instead of `req.dbClient.query()` (tenant-scoped client). This means:

1. `SET LOCAL` runs on connection A
2. The actual query runs on connection B (from pool)
3. RLS policies see no `app.tenant_id` → either fail or return all tenants' data

**Affected files:**
- `src/iam/infrastructure/operator-routes.ts` (lines 119, 196, 203)
- `src/iam/infrastructure/repositories/operator-repository.ts` (ALL methods)
- `src/conversation/infrastructure/chat-routes.ts`
- `src/pql/infrastructure/memory-ai-routes.ts`

## Impact
- FF-03 (Tenant RLS Isolation 100%) is NOT actually enforced
- Every repository that uses `this.pool` instead of the request-scoped client bypasses RLS
- **Pattern to follow:** Pass `dbClient` from middleware through service layer to repository, or use repository factory that accepts the scoped client per request
