# FR-13: Multi-operator Support -- Review Report

**Date:** 2026-03-04
**Reviewer:** Claude Code (automated)
**Phase:** Phase 4 -- Review

---

## Executive Summary

FR-13 Multi-operator is a well-structured feature spanning BC-01 (Conversation) and BC-05 (IAM). The core assignment logic is thoroughly tested (16 unit tests, all passing). The architecture respects bounded context boundaries, RLS is properly configured, and the API design follows RESTful conventions with Zod validation. Several areas require attention: missing integration tests, potential race conditions, and stale presence risk.

**Overall Rating: 7.5/10** -- Solid implementation with known v1 trade-offs.

---

## Architecture Review

### Strengths

1. **Clean BC separation.** AssignmentService and PresenceService live in their respective BCs. Cross-BC dependency is resolved at the composition root (server.ts), not in domain code. This satisfies FF-02.

2. **Least-loaded algorithm is pragmatic.** Rather than a complex round-robin with pointer management, the system queries actual load from the DB. This naturally handles operator churn (online/offline transitions) without stale state.

3. **Redis SET for presence is the right choice.** For teams of <= 10, SMEMBERS is effectively O(1). The simplicity of SADD/SREM eliminates complex state machines.

4. **Soft-delete preserves integrity.** DISABLED status maintains FK relationships with dialogs and preserves audit history.

5. **Admin self-protection.** Both self-demotion and self-deactivation are explicitly blocked.

### Concerns

1. **No database-level locking on assignment.** Two concurrent `assignNextDialog` calls could assign the same dialog to two different operators. The UPDATE does not use `SELECT ... FOR UPDATE SKIP LOCKED`. This is acceptable for v1 (low concurrency) but must be addressed before scaling.

2. **PresenceService has no TTL/heartbeat.** If an operator's browser crashes, they remain "online" in Redis indefinitely. This means the assignment algorithm will try to route dialogs to a ghost operator. Risk is mitigated by the low operator count but becomes critical at scale.

3. **AssignmentService constructor creates DialogRepository internally.** This makes it harder to mock in tests (the test mocks the Pool instead). Consider injecting DialogRepository for better testability.

---

## RLS Isolation Review (FF-03)

### Database Layer

| Table | RLS Enabled | Policy | Status |
|-------|-------------|--------|--------|
| `iam.operators` | YES | `tenant_id = current_setting('app.tenant_id')::UUID` | PASS |
| `conversations.dialogs` | YES | `tenant_id = current_setting('app.tenant_id')::UUID` | PASS |

### Application Layer

| Route | Tenant Check | Status |
|-------|-------------|--------|
| GET /api/operators | `findByTenantId(tenantReq.tenantId)` | PASS |
| GET /api/operators/online | Filters by tenant presence key | PASS |
| PATCH /api/operators/:id/role | `operatorResult.value.tenantId !== tenantReq.tenantId` | PASS |
| DELETE /api/operators/:id | Same tenant check | PASS |
| GET /api/operators/:id/stats | Same tenant check | PASS |
| POST /api/dialogs/:id/assign | Relies on dialog RLS (tenant middleware sets GUC) | PARTIAL |
| POST /api/dialogs/:id/assign-auto | Relies on dialog RLS + tenantId passed to service | PASS |

**Finding:** The manual assign route (`POST /api/dialogs/:id/assign`) does not explicitly verify the target operatorId belongs to the same tenant. It calls `reassign(dialogId, operatorId)` which only checks dialog status. If the dialog is found (via RLS), any operatorId UUID could be set. However, the FK constraint `operator_id REFERENCES iam.operators(id)` prevents setting an operator from a different tenant only if the operator UUID does not exist in the operators table at all. Since UUIDs are globally unique across tenants in the operators table (no RLS on the FK check), a crafted request could theoretically assign a dialog to an operator from another tenant.

**Severity:** MEDIUM
**Recommendation:** Add a tenant ownership check for the target operatorId in the reassign flow, or add a CHECK constraint that validates the operator's tenant_id matches the dialog's tenant_id.

### Redis Layer

| Key Pattern | Tenant Scoped | Status |
|-------------|---------------|--------|
| `presence:{tenantId}` | YES -- tenantId in key | PASS |

Redis presence keys are naturally isolated by tenant. There is no mechanism for tenant A to query `presence:{tenantB}`.

---

## Code Quality Review

### Positive Patterns

1. **Result<T, Error> return type** used consistently in OperatorRepository
2. **Zod schemas** validate all user input at API boundaries
3. **Error handling** follows project convention: catch -> log -> return 500
4. **TypeScript types** are explicit: `Operator['role']`, `Operator['status']`
5. **Test helpers** are well-structured: `createMockPool`, `createMockPresenceService`, `makeDialogRow`

### Issues Found

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| Missing return type annotation | LOW | `assignment-routes.ts` handlers | RequestHandler callbacks have implicit return types |
| Console.error for logging | LOW | Both route files | Should use structured logger (e.g., pino) for production |
| `as TenantRequest` type assertion | LOW | All route handlers | Could use generic `Request<P, B, Q, Locals>` for type safety |
| PresenceService.setOffline tenantId optional | LOW | `presence-service.ts` | If tenantId is undefined, setOffline is a no-op. This is fragile. |
| Stats endpoint N+1 potential | LOW | `OperatorList.tsx` | Fetches stats for each online operator individually |
| No error boundary | LOW | `OperatorList.tsx` | Component silently swallows fetch errors |

### Naming Convention Compliance

| Entity | Expected | Actual | Status |
|--------|----------|--------|--------|
| AssignmentService | PascalCase + "Service" | AssignmentService | PASS |
| PresenceService | PascalCase + "Service" | PresenceService | PASS |
| OperatorRepository | PascalCase + "Repository" | OperatorRepository | PASS |
| Dialog (aggregate) | PascalCase noun | Dialog | PASS |
| Operator (aggregate) | PascalCase noun | Operator | PASS |

Domain language compliance:
- Uses "Dialog" (not "chat") -- PASS
- Uses "Operator" (not "user") -- PASS
- Uses "Tenant" (not "customer") -- PASS

---

## Test Quality Review

### Coverage

| Component | Unit Tests | Integration Tests | Status |
|-----------|-----------|-------------------|--------|
| AssignmentService | 16 tests | None | PARTIAL |
| PresenceService | 0 tests | None | MISSING |
| operator-routes | 0 tests | None | MISSING |
| assignment-routes | 0 tests | None | MISSING |
| OperatorList.tsx | 0 tests | None | MISSING |
| useOperators.ts | 0 tests | None | MISSING |

### Test Quality (AssignmentService)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Happy path coverage | 9/10 | All major flows tested |
| Edge case coverage | 8/10 | Max capacity, no operators, CLOSED dialogs |
| Mock quality | 7/10 | SQL string matching is fragile; consider extracting query methods |
| Test isolation | 9/10 | Each test creates fresh mocks |
| Naming | 9/10 | Clear, descriptive test names |
| Assertion quality | 8/10 | Good use of `not.toBeNull()` + specific field checks |

---

## Security Review

| Check | Status | Notes |
|-------|--------|-------|
| Admin-only endpoints protected | PASS | Role check returns 403 |
| Self-demotion blocked | PASS | Explicit check in updateRole |
| Self-deactivation blocked | PASS | Explicit check in deactivateOperator |
| Cross-tenant access denied | PARTIAL | See RLS finding above (manual assign) |
| Input validation (Zod) | PASS | UUID and enum validation |
| Password not exposed in API | PASS | List endpoints exclude passwordHash |
| No secrets in logs | PASS | Only generic error messages logged |

---

## Recommendations

### Critical (must fix before M2 release)
1. **Add tenant check on manual assign target operatorId.** Verify the target operator belongs to the same tenant before calling `dialogRepo.assignOperator`.

### High Priority
2. **Add PresenceService unit tests.** Use ioredis-mock to test SADD/SREM/SMEMBERS/SISMEMBER.
3. **Add operator-routes integration tests.** Test admin authorization, self-protection, cross-tenant rejection with supertest.
4. **Add RLS integration test.** Verify tenant A cannot list tenant B operators.

### Medium Priority
5. **Add `SELECT ... FOR UPDATE SKIP LOCKED` to assignment queries.** Prevent race conditions on concurrent assignment.
6. **Replace console.error with structured logger.**
7. **Add heartbeat mechanism for presence (v2).** TTL-based with background cleanup.

### Low Priority
8. **Enforce max 10 operators per tenant in inviteOperator.**
9. **Add batch stats endpoint to avoid N+1 in OperatorList.**
10. **Add frontend component tests with React Testing Library.**

---

## Conclusion

FR-13 Multi-operator delivers a functional and well-designed feature that meets all stated acceptance criteria. The assignment algorithm is pragmatic, the API surface is clean, and the code follows project conventions. The primary risk is the missing tenant check on manual assignment (cross-tenant operator injection), which should be fixed before M2 release. Test coverage is solid for the core logic but insufficient for the HTTP layer, presence service, and frontend components. The v1 trade-offs (no heartbeat, no race condition protection) are acceptable for the current scale but should be addressed as the platform grows.
