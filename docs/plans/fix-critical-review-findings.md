# Plan: Fix Critical Review Findings

**Date:** 2026-03-04
**Scope:** 16 findings (9 CRITICAL + 7 HIGH) from 6 feature reviews

## Fixes by Group

### Group 1: RLS Bypass — pool.query() → dbClient.query()
**Files:** operator-repository.ts, operator-routes.ts, memory-ai-routes.ts, chat-routes.ts, ws-handler.ts
**Fix:** Refactor repositories to accept PoolClient parameter; route handlers pass req.dbClient

### Group 2: SQL Injection — SET LOCAL interpolation → set_config()
**Files:** tenant.middleware.ts, ws-handler.ts
**Fix:** Replace `SET LOCAL app.tenant_id = '${id}'` with `SELECT set_config('app.tenant_id', $1, true)`

### Group 3: WebSocket Rate Limiting
**Files:** ws-handler.ts
**Fix:** Add per-socket message counter, 10 msg/min limit

### Group 4: Widget Auth Token
**Files:** ws-handler.ts
**Fix:** Add simple HMAC widget token verification on connect

### Group 5: JWT Secret Consistency
**Files:** auth-service.ts, tenant.middleware.ts, server.ts
**Fix:** Shared getJwtSecret() + startup guard

### Group 6: Disabled Operator Check
**Files:** tenant.middleware.ts
**Fix:** Add operator status check in middleware

### Group 7: Dead Code / Wrong Language
**Files:** page.tsx, RightPanel.tsx
**Fix:** Wire useOperators, fix quick replies language

### Implementation Order
1. Group 5 (JWT) — foundational, affects all auth
2. Group 2 (SQL injection) — security critical, shared middleware
3. Group 1 (RLS bypass) — most pervasive
4. Group 6 (disabled operator) — middleware change
5. Group 3 (rate limiting) — WebSocket security
6. Group 7 (dead code) — UI fixes
7. Group 4 (widget auth) — enhancement
