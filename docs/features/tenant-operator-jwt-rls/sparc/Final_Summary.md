# IAM-01: Final Implementation Summary

**Feature ID:** IAM-01 — Tenant + Operator + JWT + RLS
**BC:** BC-05 Identity & Access
**Status:** Done (Implemented, Tested)
**Milestone:** M1
**Date:** 2026-03-04

---

## What Was Built

IAM-01 is the foundational security layer for КоммуниК. It establishes:

1. **Multi-tenant isolation** via PostgreSQL Row-Level Security — data from different tenants is never mixed, even under application bugs
2. **JWT authentication** with role-based access control (ADMIN / OPERATOR)
3. **Operator lifecycle management** — registration, invitation, activation, deactivation
4. **Presence tracking** — online/offline status via Redis for the operator workspace

This feature unblocks all downstream features: FR-07 (Operator Workspace), FR-13 (Multi-operator), and every feature requiring authenticated API access.

---

## Implementation Summary

### Files Created

| File | Purpose |
|------|---------|
| `src/iam/domain/aggregates/tenant.ts` | Tenant aggregate interface + TenantSettings value object |
| `src/iam/domain/aggregates/operator.ts` | Operator aggregate interface + JwtPayload interface |
| `src/iam/infrastructure/repositories/tenant-repository.ts` | PostgreSQL CRUD for iam.tenants |
| `src/iam/infrastructure/repositories/operator-repository.ts` | PostgreSQL CRUD for iam.operators (with intentional RLS bypass for login) |
| `src/iam/application/services/auth-service.ts` | register(), login(), inviteOperator(), verifyToken() |
| `src/iam/application/services/presence-service.ts` | Redis-based online/offline tracking |
| `src/iam/infrastructure/auth-routes.ts` | Public + protected auth endpoints |
| `src/iam/infrastructure/operator-routes.ts` | Operator management endpoints (admin-guarded) |
| `src/shared/middleware/tenant.middleware.ts` | JWT verify + dedicated DB client + SET app.tenant_id |
| `src/iam/application/services/auth-service.test.ts` | 16 unit tests with mocked Pool |
| `migrations/002_iam_tables.sql` | iam.tenants + iam.operators + RLS policy |

---

## Key Technical Decisions

### Decision 1: Dedicated PoolClient Per Request

The most critical implementation detail. PostgreSQL session parameters (`SET app.tenant_id`) only persist for the lifetime of a single connection. Since `pg.Pool` returns connections to the pool after each query (resetting session state), a dedicated `pool.connect()` must be used per request. The client is attached to `req.dbClient` and released via `res.on('close')`.

**Why not pool.query():** Using `pool.query()` would silently drop the `SET app.tenant_id` GUC after each query, causing subsequent queries in the same request to execute without tenant isolation.

### Decision 2: JWT Secret Read at Call Time

```typescript
function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? 'dev-secret-change-me'
}
```

Reading `JWT_SECRET` at call time (not at module import) allows Jest tests to set `process.env.JWT_SECRET` in `beforeEach` hooks. If read at import time, all test instances would share the module-level value, making parallel test isolation impossible.

### Decision 3: Atomic Registration Transaction

`register()` wraps both `INSERT INTO iam.tenants` and `INSERT INTO iam.operators` in a single `BEGIN/COMMIT` transaction with explicit `ROLLBACK` on error. This guarantees no orphaned tenant records exist without a corresponding admin operator.

### Decision 4: Intentional RLS Bypass for Login

`findByEmail()` uses `this.pool.query()` directly (not the tenant-scoped client) because at login time, the tenant is unknown. This is the only place in the codebase where RLS is intentionally bypassed, and it is documented with a comment.

### Decision 5: Generic Authentication Error Messages

Both "email not found" and "wrong password" return identical `"Invalid email or password"` responses. This prevents email enumeration — an attacker cannot determine which emails are registered by testing login responses.

### Decision 6: bcrypt 12 Rounds

Selected as the balance between security and user experience:
- 10 rounds: ~50ms (too fast, weaker against brute force)
- 12 rounds: ~200ms (good security, acceptable UX)
- 14 rounds: ~800ms (too slow for registration flow)

---

## Architecture Patterns Applied

| Pattern | Application |
|---------|------------|
| **Result<T, E> type** | All service/repository methods return Result — no exceptions across boundaries |
| **Zod schema validation** | All API input validated before any DB operation |
| **Repository pattern** | OperatorRepository + TenantRepository abstract all DB access |
| **Middleware chain** | JWT verify → RLS setup → route handler (separation of concerns) |
| **Soft delete** | Operators set to DISABLED, never hard-deleted (preserves audit trail) |
| **Defense in depth** | JWT (layer 1) + RLS (layer 2) + application tenant check (layer 3) |

---

## Fitness Functions Status

| FF | Description | Status |
|----|------------|--------|
| FF-03 | Tenant RLS isolation 100% | RLS policy created on iam.operators; middleware enforced on all protected routes |
| FF-02 | No cross-BC imports | IAM domain has no imports from other BCs. Shared middleware in `@shared/` |

---

## API Surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/auth/register | None | Register tenant + first ADMIN |
| POST | /api/auth/login | None | Authenticate, receive JWT |
| GET | /api/auth/me | JWT | Current operator profile |
| POST | /api/auth/operators | JWT (ADMIN) | Invite operator to tenant |
| GET | /api/operators | JWT | List tenant operators |
| GET | /api/operators/online | JWT | List online operators |
| GET | /api/operators/:id/stats | JWT | Operator stats |
| PATCH | /api/operators/:id/role | JWT (ADMIN) | Change operator role |
| DELETE | /api/operators/:id | JWT (ADMIN) | Deactivate operator (soft) |

---

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| AuthService unit tests | 16 | Passing |
| Integration RLS tests | 0 (required for FF-03) | Pending (next sprint) |
| E2E auth flow | 0 | Pending |

**Unit test approach:** All 16 tests use a `createMockPool()` factory that simulates PostgreSQL responses without a real DB connection. This makes the tests fast (<1s) and CI-independent.

---

## What Was NOT Built (Deferred)

| Feature | Reason | Future Issue |
|---------|--------|-------------|
| Refresh token rotation | Not needed for M1 | FR-IAM-x |
| Password reset via email | No email service in v1 | FR-IAM-x |
| OAuth2/SSO | Out of scope | FR-IAM-x |
| JWT blocklist | Token revocation deferred | FR-IAM-x |
| Rate limiting on /login | SH-03 scope | SH-03 |
| Last-admin prevention | Edge case for later | FR-IAM-x |

---

## Dependencies Unlocked

With IAM-01 complete, the following features are unblocked:

- **FR-07** — Operator Workspace (requires auth middleware) ✅ Unblocked
- **FR-13** — Multi-operator management (requires operator invite + roles) ✅ Unblocked
- **FR-01** — PQL RuleEngine (requires tenantId for per-tenant settings) ✅ Unblocked
- **All other features** requiring authenticated API access ✅ Unblocked
