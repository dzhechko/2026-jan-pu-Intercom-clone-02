# Architecture Compliance Review: FR-13 Multi-operator Support

**Feature ID:** FR-13
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** CONDITIONAL APPROVAL — two medium-severity issues require acknowledgment before production; one critical architectural inconsistency documented

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — FAIL

The docs claim PASS because `PresenceService` is injected via composition root. This claim is misleading.

`src/conversation/application/services/assignment-service.ts` line 12:

```typescript
import { PresenceService } from '@iam/application/services/presence-service'
```

This is a direct module import of a BC-05 class inside a BC-01 **application service**. The application layer is not the composition root. The composition root is `server.ts`. The application service `AssignmentService` carries a compile-time and runtime dependency on the concrete `PresenceService` class from BC-05.

The documentation justifies this as "injected at composition root — domain layer is clean." That argument is technically accurate about the domain layer but misleading about the application layer. `AssignmentService` is in `src/conversation/application/services/` — an **application layer file** — and it imports from `@iam/application/services/`. This violates FF-02 as written.

The correct fix would be to define a `PresencePort` interface in `src/conversation/domain/ports/` and have `PresenceService` implement it. `AssignmentService` would then type-check against the port interface, and the concrete `PresenceService` would be injected at `server.ts` without any import in the application layer.

The test file `assignment-service.test.ts` line 7 independently imports `PresenceService` from `@iam/` as well, further cementing the coupling.

**Severity:** MEDIUM — the pattern works, but it violates the stated FF-02 rule and creates a coupling that will complicate future BC-01/BC-05 independent deployment.

**Required action:** Define `PresencePort` in BC-01 domain. This is not blocking now, but must be addressed before any BC isolation work.

---

### FF-03: Tenant RLS Isolation — PARTIAL PASS with a critical gap

**What works:** The tenant middleware (`tenant.middleware.ts`) correctly acquires a dedicated `PoolClient`, sets `app.tenant_id` via `set_config()`, and exposes it as `req.dbClient`. The operator routes correctly use `tenantReq.dbClient` for repository calls, so RLS is active for those queries.

**What does not work:** `AssignmentService` and `DialogRepository` bypass RLS entirely.

`AssignmentService` is constructed with the raw `pool` at `server.ts` line 155:

```typescript
const assignmentService = new AssignmentService(pool, presenceService)
```

`DialogRepository` uses `this.pool.query()` for all operations including `findById()` and `assignOperator()`. These connections are taken from the pool with no `SET app.tenant_id` applied. RLS policies on `conversations.dialogs` are therefore never evaluated for any assignment operation.

Instead, the code uses `WHERE tenant_id = $1` as a filter parameter — which is the exact pattern ADR-007 explicitly forbids:

> **ADR-007:** "NEVER pass tenant_id as WHERE clause filter — RLS handles it"

The `getOperatorLoad`, `getUnassignedDialogs`, and `getQueueSize` methods in `AssignmentService` all pass `tenantId` as `$1` to raw `pool.query()` calls without any RLS session setup.

This means the RLS policies are a dead letter for the assignment flow. If RLS is misconfigured (e.g., policy accidentally disabled or migrated incorrectly), tenant A could see and assign tenant B's dialogs via the queue, because the only defense is the application-layer `WHERE tenant_id = $1` filter on a raw pool connection.

Similarly, `DialogRepository.findById()` uses `this.pool.query()` with no tenant scope at all. A dialog UUID from another tenant would be returned if RLS is disabled.

**Severity:** MEDIUM — the application-layer tenant filter does provide isolation in practice, but it contradicts the architecture's single source of truth for tenant isolation (RLS) and creates a hidden dependency on application-code correctness rather than database enforcement.

**Required action before production:** Either (a) pass a `dbClient` through to `AssignmentService` / `DialogRepository`, or (b) document explicitly in ADR-007 that the assignment flow is an intentional exception to the RLS-only rule, with rationale.

---

### FF-04: Circuit Breaker on MCP — N/A

FR-13 does not use MCP adapters. Correct.

---

### FF-05: RuleEngine Coverage — N/A

FR-13 is not a RuleEngine feature. Correct.

---

### ADR-007: JWT + RLS — PARTIAL PASS

As noted above, the route handlers correctly use `tenantReq.dbClient` for direct DB calls via `OperatorRepository`. However, `AssignmentService` and `DialogRepository` use raw pool connections. This is an ADR-007 deviation that the documentation does not surface as a risk — it surfaces only `findByEmail` as an intentional bypass.

---

## 2. Code Quality Review

### Strengths

1. **Clean least-loaded algorithm:** `findLeastLoadedOperator` is a clear O(n) loop with no side effects. Well-matched to the pseudocode spec. The Map-based load tracking is efficient for the ≤10 operator constraint.

2. **Zod validation on body inputs:** Both `ManualAssignSchema` and `UpdateRoleSchema` use Zod correctly. Error responses include `parsed.error.flatten()` for client-side debugging.

3. **Result<T, E> pattern consistency:** `OperatorRepository` uses the shared `Result` type for all operations and handles both `.ok` and error cases at the route layer.

4. **Soft-delete rationale is sound:** Setting `status = 'DISABLED'` rather than hard-deleting preserves referential integrity and audit trail. Dialog history is not broken when an operator is deactivated.

5. **Route ordering is correct:** `router.get('/online', ...)` is registered before `router.get('/:id/stats', ...)` in `operator-routes.ts`, preventing `/online` from being captured as a stats lookup for the ID `"online"`.

6. **Self-protection is clear and tested:** Both self-demotion and self-deactivation guards are present, with the correct HTTP status codes (400 for business rule violation, 403 for role check).

---

### Issues Found

#### Issue 1: `getOperatorStats` conflates DB error with Not Found (MEDIUM)

```typescript
// operator-routes.ts line 188
if (!operatorResult.ok || !operatorResult.value) {
  return res.status(404).json({ error: 'Operator not found' })
}
```

When `operatorResult.ok === false`, this is a database error — not a missing record. Returning HTTP 404 instead of 500 for a DB failure misleads the caller into thinking the operator does not exist. The pattern is inconsistent with how `updateRole` and `deactivateOperator` handle it (those correctly return 500 for `!ok` and 404 for `!value` as separate branches).

**Fix:** Split into two checks, matching the pattern used in the other handlers:
```typescript
if (!operatorResult.ok) {
  return res.status(500).json({ error: 'Failed to fetch operator' })
}
if (!operatorResult.value) {
  return res.status(404).json({ error: 'Operator not found' })
}
```

---

#### Issue 2: `updateRole` uses raw inline SQL instead of repository method (LOW)

```typescript
// operator-routes.ts line 119-122
await tenantReq.dbClient.query(
  'UPDATE iam.operators SET role = $1 WHERE id = $2',
  [parsed.data.role, req.params.id],
)
```

`OperatorRepository` already has `updateStatus()`. An analogous `updateRole()` method should exist in the repository rather than writing raw SQL in the route handler. The route handler's job is HTTP concerns, not SQL. This also bypasses the `Result<T,E>` error handling pattern — if this query throws, it is caught only by the outer `try/catch`, which returns a generic 500 with no structured logging of what failed.

**Fix:** Add `updateRole(id: string, role: string, client?: PoolClient): Promise<Result<void, Error>>` to `OperatorRepository`.

---

#### Issue 3: `PresenceService` has zero error handling (MEDIUM)

```typescript
// presence-service.ts — all 4 methods
async setOnline(operatorId: string, tenantId: string): Promise<void> {
  await this.redis.sadd(`presence:${tenantId}`, operatorId)
}
```

Every Redis operation throws unhandled exceptions on connection failure. The Refinement doc acknowledges Redis failure as a risk ("PresenceService degrades: all operators appear offline"), but the code does not implement any degradation — it propagates the exception. A Redis connection failure in `setOnline` or `getOnlineOperators` will crash the route handler with a 500 and unhandled rejection rather than gracefully degrading.

The Refinement doc's mitigation claim ("assignment falls back to queue") is not implemented. There is no fallback in `AssignmentService.findLeastLoadedOperator()` when `presenceService.getOnlineOperators()` throws.

**Fix:** Wrap Redis calls in try/catch and return safe defaults on failure:
```typescript
async getOnlineOperators(tenantId: string): Promise<string[]> {
  try {
    return await this.redis.smembers(`presence:${tenantId}`)
  } catch (err) {
    console.error('[PresenceService] Redis failure, returning empty set', err)
    return []
  }
}
```

---

#### Issue 4: Path parameter `:id` is never validated as UUID (LOW)

```typescript
// operator-routes.ts, assignment-routes.ts
req.params.id  // used as-is, no UUID format check
```

`req.params.id` is used directly as a SQL parameter (`$1`, `$2`) without validation that it is a valid UUID. While PostgreSQL will reject an invalid UUID with an error (which the try/catch handles), the error returned will be a generic 500 rather than a 400. The spec says `GET /api/operators/:id/stats` should return 404 for a not-found operator — but with an invalid UUID string the response will be 404 (from the `!operatorResult.ok` path collapsing) rather than 400.

**Fix:** Add a simple UUID validation at the top of each handler:
```typescript
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (!uuidRegex.test(req.params.id)) {
  return res.status(400).json({ error: 'Invalid operator ID format' })
}
```

---

#### Issue 5: Self-demotion guard is asymmetric (LOW)

```typescript
// operator-routes.ts line 115
if (req.params.id === tenantReq.operatorId && parsed.data.role !== 'ADMIN') {
  return res.status(400).json({ error: 'Cannot change your own role' })
}
```

An ADMIN can promote themselves from OPERATOR to ADMIN (redundant but harmless), but cannot demote themselves. This is intentional for self-demotion protection. However, an ADMIN can also set their own role to `ADMIN` (no-op update), which will succeed silently. This is not a bug, but the guard message "Cannot change your own role" is slightly misleading — it only blocks role reduction, not role setting. A more accurate message: "Admins cannot demote themselves."

**Severity:** Negligible — the behavior is correct, the error message is imprecise.

---

#### Issue 6: Race condition in `assignNextDialog` is unmitigated (MEDIUM, known)

```typescript
// assignment-service.ts lines 40-48
const unassigned = await this.getUnassignedDialogs(tenantId)
const dialog = unassigned[0]
const operatorId = await this.findLeastLoadedOperator(tenantId)
const assigned = await this.dialogRepo.assignOperator(dialog.id, operatorId)
```

Two simultaneous `POST /api/dialogs/assign-next` calls with the same tenant can both read the same dialog from `getUnassignedDialogs`, both find the same `operatorId`, and both call `assignOperator`. The second `UPDATE` will succeed and silently overwrite the first, resulting in the dialog being "assigned" twice. The Refinement doc acknowledges this as EC-01 and defers to v2. That deferral is acceptable, but the code comment says "race condition: someone else assigned it" which implies it handles the case — it does not; the comment is misleading.

**Fix for comment clarity only:**
```typescript
// Race condition risk: concurrent assign-next calls may assign the same dialog twice.
// Mitigated in v2 with SELECT FOR UPDATE SKIP LOCKED. Acceptable in v1 (<=10 operators).
```

---

## 3. Test Coverage Review

### What Exists

- `assignment-service.test.ts` — 16 unit tests with a well-structured mock factory
- All core paths covered: `assignNextDialog`, `autoAssign`, `reassign`, `findLeastLoadedOperator`, `getQueueSize`
- Cross-tenant operator assignment rejection test is present and effective (Issue 4 in test suite)

### What is Missing

The Refinement doc self-identifies these gaps. They are real, not just theoretical:

| Missing Test | Severity | Impact |
|---|---|---|
| `PresenceService` unit tests (mocked Redis) | HIGH | Zero coverage on the Redis operations that underpin all assignment |
| `operator-routes.ts` integration tests | HIGH | Admin auth, self-protection, role change, deactivation — zero HTTP-level tests |
| `assignment-routes.ts` integration tests | MEDIUM | Zod validation, HTTP status codes, 404 vs 500 distinction — zero HTTP-level tests |
| RLS isolation integration test for operators | CRITICAL | FF-03 requires this test; it does not exist |
| `PresenceService` error handling tests | HIGH | Given the zero error handling, even a basic mock of Redis failure is needed |
| `useOperators` hook tests | LOW | Frontend, lower priority |

The most significant gap is the RLS isolation integration test. The Refinement doc lists it as "CRITICAL (FF-03)" in the recommended test priority, then the feature ships without it. That is not acceptable for production multi-tenant isolation — it is exactly the test that verifies the foundational claim that tenant A cannot see tenant B's data.

---

## 4. Security Review

| Check | Status | Notes |
|---|---|---|
| No API keys in code | PASS | — |
| No raw SQL injection | PASS | All queries use parameterized `$1, $2` |
| Input validated with Zod (body) | PASS | ManualAssignSchema, UpdateRoleSchema |
| Path parameters validated | FAIL | No UUID format check on `:id` params |
| Tenant isolation via RLS | PARTIAL | Routes use dbClient; AssignmentService uses raw pool |
| Admin role enforcement | PASS | ADMIN check before role change and deactivation |
| Self-protection | PASS | Both self-demotion and self-deactivation blocked |
| No PII to external APIs | PASS | No external calls in this feature |
| Redis error isolation | FAIL | PresenceService throws on Redis failure, no fallback |

The biggest security concern is the RLS gap in `AssignmentService`. It is mitigated by the `WHERE tenant_id = $1` filter, but it relies on application-layer correctness rather than database enforcement. If a bug were ever introduced that passed the wrong `tenantId` to `assignNextDialog`, the database would not catch it.

---

## 5. Documentation Accuracy Review

The SPARC docs are generally accurate and well-written. Three inaccuracies to note:

1. **Architecture.md claims FF-02 PASS** with the justification that "PresenceService injected via composition root." The import of `PresenceService` from `@iam/` inside `src/conversation/application/services/assignment-service.ts` is a cross-BC import. The claim is technically wrong as written.

2. **Final_Summary.md claims FF-03 PASS.** The assignment flow does not use RLS-scoped connections. The claim overstates the isolation guarantee.

3. **Refinement.md states Redis failure fallback: "PresenceService degrades: all operators appear offline, assignment falls back to queue."** The code does not implement this degradation. Redis failure throws an exception. The documented behavior is aspirational, not implemented.

---

## 6. Summary Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Architectural compliance | 6/10 | Cross-BC import in application layer; RLS bypass in assignment flow |
| Code quality | 7/10 | Mostly clean; inline SQL in route, missing repo method, DB/404 conflation |
| Test coverage | 5/10 | Good AssignmentService unit tests; zero integration tests, zero PresenceService tests, missing critical RLS test |
| Security | 7/10 | No path param validation; RLS gap in assignment flow; PresenceService has no error isolation |
| Performance | 9/10 | Algorithm is O(n) for n≤10; Redis SETs are optimal; no load test needed at this scale |
| Documentation accuracy | 7/10 | Three specific inaccuracies in compliance claims and fallback behavior |

**Overall: 41/60 (68%) — CONDITIONAL APPROVAL**

---

## 7. Required Actions Before Production

| Priority | Action | Severity |
|---|---|---|
| P1 | Add RLS isolation integration test for operator routes (FF-03) | CRITICAL |
| P1 | Document explicitly in ADR-007 that AssignmentService is an intentional RLS exception, or fix it | MEDIUM |
| P1 | Add try/catch error handling to PresenceService Redis operations with safe fallback returns | MEDIUM |
| P2 | Fix `getOperatorStats` to return 500 on DB error, not 404 | MEDIUM |
| P2 | Add `PresenceService` unit tests with mocked Redis (including failure paths) | HIGH |
| P2 | Add `operator-routes` integration tests (Supertest) for auth, self-protection, deactivation flows | HIGH |
| P3 | Define `PresencePort` interface in BC-01 domain; remove direct `@iam/` import from AssignmentService | MEDIUM |
| P3 | Extract `updateRole` SQL into `OperatorRepository.updateRole()` method | LOW |
| P3 | Add UUID format validation for path parameters in both route files | LOW |

**Blocking issues before production:** P1 items — specifically the missing RLS integration test and the undocumented RLS bypass in the assignment flow.

**Recommended fixes before v2 feature development:** All P1 and P2 items above.
