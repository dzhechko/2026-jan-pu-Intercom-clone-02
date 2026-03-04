# FR-12: amoCRM Auto-Update — Review Report

**Date:** 2026-03-04
**Reviewer:** Automated code review pipeline
**Feature:** FR-12 amoCRM Auto-Update
**Verdict:** APPROVED with recommendations

---

## 1. Code Quality Assessment

### Overall Rating: 8.5/10

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | All tests pass; logic is sound |
| Architecture | 9/10 | Clean ACL, port-based DI, proper layer separation |
| Testability | 8/10 | Service fully testable via mocks; gaps in route/ACL tests |
| Security | 6/10 | No webhook auth in v1 (deferred SH-04) |
| Performance | 9/10 | Sequential queries are efficient; batch processing with allSettled |
| Maintainability | 9/10 | Clear naming, JSDoc comments, consistent patterns |
| Error Handling | 8/10 | Graceful nulls, but console.warn/info instead of structured logger |

## 2. Architecture Review

### Strengths

**Anti-Corruption Layer (ACL)**
The `crm-webhook-types.ts` file is an exemplary ACL implementation. External amoCRM types are defined alongside the translation functions, keeping the boundary explicit. The domain `DealClosedEvent` is a clean, minimal DTO with no amoCRM-specific fields.

**Port-Based Dependency Injection**
`AutoAttributionService` depends on three interfaces (`AttributionRepository`, `PQLDetectionLookup`, `TenantLookup`), achieving full inversion of control. This makes the service testable without any infrastructure dependencies.

**Idempotent Design**
Both `processDealClosed` and `linkDetectionToDeal` check for existing attributions before creating new ones. This is critical for webhook-driven systems where duplicate delivery is common.

**Value Object Logic**
The `calculateAttributionConfidence` function encapsulates the attribution confidence algorithm as a pure function. The 90-day decay window is a reasonable business rule, and the math is transparent.

### Concerns

**Cross-BC Import (FF-02 Warning)**
```typescript
// In auto-attribution-service.ts (BC-03 Revenue):
import { DealClosedEvent } from '@integration/infrastructure/crm-webhook-types'
```
This imports from BC-04 Integration into BC-03 Revenue. While `DealClosedEvent` is a simple readonly DTO, the import technically violates FF-02. Recommendation: move `DealClosedEvent` to `shared/events/` or define a separate type in BC-03 that the webhook route maps to.

**Webhook Route Authentication Gap**
The `/api/webhooks/amocrm` endpoint has zero authentication. While the plan document notes this is intentional (amoCRM sends directly), this is a production blocker. Any attacker can POST fake deal-closed events and create spurious attributions.

**Race Condition in Idempotency Check**
```typescript
const existing = await this.attributionRepo.findByDealId(event.dealId)
if (existing) return existing
// ... time gap ...
const attribution = await this.attributionRepo.save(input)
```
Between the `findByDealId` and `save` calls, a concurrent request could create a duplicate. The database schema should have a UNIQUE constraint on `deal_id` with an ON CONFLICT clause.

## 3. Test Review

### Coverage Analysis

| Component | Unit Tests | Integration Tests | Notes |
|-----------|-----------|------------------|-------|
| AutoAttributionService | 14 PASS | None | Excellent mock-based coverage |
| crm-webhook-routes | None | None | GAP: no supertest tests |
| crm-webhook-types (ACL) | None | None | GAP: no translation tests |
| PgAttributionRepository | None | None | GAP: no DB integration tests |
| attribution-routes (REST) | None | None | GAP: no API tests |
| pql-attribution (VO) | Implicit | None | Tested via service tests |

### Test Quality

The existing 14 tests are well-structured:
- Clear `describe`/`it` organization
- Factory functions for test data (`createDealClosedEvent`, `createPQLDetectionRecord`)
- Proper mock setup with `jest.Mocked<T>` types
- Tests verify both return values and side effects (repository calls, event emissions)
- Edge cases covered (null email, unknown account, duplicates)

### Missing Tests (prioritized)

1. **HIGH:** `isDealClosedWebhook` with various payload shapes (empty, no status changes, non-142 status, mixed statuses)
2. **HIGH:** `translateToDealClosedEvents` with custom field edge cases (missing email field, multiple custom fields, empty values)
3. **MEDIUM:** Webhook route HTTP tests (400 for invalid payload, 200 for non-deal events, 200 with processed/failed counts)
4. **MEDIUM:** Attribution routes tests (Zod validation errors, 404 for missing detection, 201 for success)
5. **LOW:** `PgAttributionRepository` integration tests with RLS verification

## 4. Security Review

| Check | Status | Detail |
|-------|--------|--------|
| SH-01: API key storage | N/A | No API keys in this feature |
| SH-02: PII protection | PASS | Contact emails are used for matching only, not logged in full |
| SH-03: Rate limiting | MISSING | No rate limit on webhook endpoint |
| SH-04: Webhook verification | MISSING | No HMAC signature check (deferred) |
| RLS tenant isolation | PASS | All repository queries are RLS-protected |
| Zod input validation | PASS | Manual attribution route validates with Zod |
| SQL injection | PASS | Parameterized queries throughout |

## 5. Performance Review

| Operation | Estimated Latency | Concern |
|-----------|------------------|---------|
| Webhook handler (single deal) | ~50-100ms | 3-4 sequential DB queries; acceptable |
| Webhook handler (N deals) | ~N * 100ms | Sequential per deal within allSettled; concurrent across deals |
| Attribution list query | ~10-50ms | Index on (tenant_id, closed_at) |
| Confidence calculation | < 1ms | Pure math, no I/O |

No performance concerns for expected load.

## 6. Recommendations

### Must Fix (before production)

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | Implement webhook HMAC verification (SH-04) | HIGH | 2h |
| 2 | Add UNIQUE constraint on deal_id column | MEDIUM | 30min |
| 3 | Add rate limiting to webhook endpoint | MEDIUM | 1h |

### Should Fix (before M2 release)

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 4 | Add ACL translation unit tests | MEDIUM | 2h |
| 5 | Add webhook route integration tests | MEDIUM | 3h |
| 6 | Move DealClosedEvent to shared/events/ | LOW | 1h |
| 7 | Replace console.warn/info with structured logger | LOW | 1h |

### Could Improve (future)

| # | Issue | Description |
|---|-------|-------------|
| 8 | Configurable status_id per pipeline | Support non-default amoCRM status mappings |
| 9 | Phone-based matching fallback | When email is missing, try phone number |
| 10 | Attribution audit log | Track who created/modified attributions |

## 7. Verdict

**APPROVED** -- FR-12 is well-implemented with clean architecture, comprehensive unit tests, and correct business logic. The code follows project conventions (ACL, ports, RLS, idempotency) and integrates properly with the Revenue Intelligence pipeline.

The three "must fix" items (webhook auth, UNIQUE constraint, rate limiting) should be addressed before production deployment with external amoCRM traffic, but do not block the current M2 milestone for internal testing.
