# Brutal Honesty Review: FR-12 amoCRM Auto-Update

**Feature ID:** FR-12
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** CONDITIONALLY APPROVED — several real gaps exist, one is a HIGH security risk for production

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — FAIL (known violation, severity MEDIUM)

`auto-attribution-service.ts` line 18:

```typescript
import { DealClosedEvent } from '@integration/infrastructure/crm-webhook-types'
```

This is a direct import from BC-04 infrastructure into BC-03 application layer. The Final Summary acknowledges this and calls it "acceptable DTO" — that reasoning is weak. The problem:

1. `DealClosedEvent` is defined inside `src/integration/infrastructure/`, not in a shared kernel. BC-03 now has a compile-time dependency on BC-04's infrastructure layer.
2. If BC-04 refactors its internal ACL types, BC-03 breaks — that is precisely what FF-02 is protecting against.
3. The comment in Architecture.md says "In a future refactor, this could be moved to `shared/events/`" — there is no reason this was not done as part of the feature, given that `shared/events/` already exists as an established pattern.

**Fix required:** Move `DealClosedEvent` to `src/shared/events/deal-closed-event.ts`. Both BC-04 and BC-03 import from shared. This is a 15-minute change that eliminates the violation.

---

### FF-03: Tenant RLS Isolation — PASS with critical gap

Strengths: RLS is enabled on `revenue.attributions`. The `SET app.tenant_id` middleware path is documented. Manual attribution routes use `TenantRequest` to extract tenant from JWT.

**Critical gap in `getByDetection` route (attribution-routes.ts lines 108-123):**

```typescript
const getByDetection: RequestHandler = async (req, res) => {
  const attribution = await attributionRepo.findByDetectionId(
    req.params.detectionId,
  )
  // ...
}
```

`findByDetectionId` in the repository runs:

```sql
SELECT * FROM revenue.attributions WHERE pql_detection_id = $1 LIMIT 1
```

This query relies purely on RLS for tenant isolation. If `SET app.tenant_id` was not properly applied by the middleware before this query executes, any authenticated operator from any tenant could retrieve attributions belonging to a different tenant by guessing or knowing a `detectionId` UUID.

The PQL detector v1 review identified exactly this pattern as a gap. The same risk exists here and is still not addressed. There is no defense-in-depth: no double-check by `tenant_id` in the WHERE clause, no verification that the returned attribution's `tenantId` matches the requesting operator's tenant.

**Same issue with `deleteById` (attribution-routes.ts lines 129-142):** Any authenticated operator can delete any attribution by UUID if they know or guess the ID. There is no ownership check.

**Fix:** Add `AND tenant_id = $2` to `findByDetectionId` and add a tenant ownership check before `deleteById`.

---

### FF-04: Circuit Breaker — NOT APPLICABLE (correctly noted)

The webhook is inbound. The feature does not make outbound MCP calls. The Final Summary correctly marks this N/A. No issue here.

---

### FF-03: RLS on `findByDealId` — PARTIAL RISK

```typescript
async findByDealId(dealId: string): Promise<Attribution | null> {
  const { rows } = await this.pool.query(
    `SELECT * FROM revenue.attributions WHERE deal_id = $1 LIMIT 1`,
    [dealId],
  )
```

This query is used for idempotency checks inside `processDealClosed`. It is called from the webhook handler, which does not go through JWT middleware. The `SET app.tenant_id` is NOT applied in the webhook path — there is no JWT and therefore no tenant middleware invocation.

This means: for the webhook path, the idempotency check (`findByDealId`) runs WITHOUT an active RLS tenant context. The query will work because `deal_id` is globally unique (UNIQUE constraint), but the RLS policy is effectively bypassed since `current_setting('app.tenant_id')` is unset, which PostgreSQL may handle as an error or return empty results depending on the RLS policy definition.

**Whether this causes a runtime failure or silently returns no rows depends on the `SET app.tenant_id` middleware being called at webhook route level.** The webhook route does NOT invoke `authenticateTenant` middleware. This is a latent bug that needs verification: does `PgAttributionRepository.findByDealId` work correctly from the webhook handler context?

---

### ADR-002: ACL Compliance — PASS

`AmoCRMWebhookPayload` and `AmoCRMWebhookLeadStatus` do not appear in BC-03 code. The translation to `DealClosedEvent` happens in BC-04 before crossing the boundary. This is correct. The ACL pattern is properly applied.

---

### ADR-007: JWT + RLS — PARTIAL (see FF-03 gap above)

Manual attribution routes correctly extract `tenantId` from JWT via `TenantRequest`. Webhook route correctly bypasses JWT (amoCRM does not authenticate this way). However, the absence of tenant middleware on the webhook route creates the RLS context gap described above.

---

## 2. Code Quality Review

### Issue 1: Redundant filter condition in `translateToDealClosedEvents` (LOW)

`crm-webhook-types.ts` line 88:

```typescript
const emailField = lead.custom_fields?.find(
  (f) => f.name.toLowerCase() === 'email' || f.name.toLowerCase() === 'email',
)
```

The condition `f.name.toLowerCase() === 'email' || f.name.toLowerCase() === 'email'` is identical on both sides of the `||`. This is a copy-paste error. It was likely meant to also match Russian field names (e.g., `'эл. почта'` or `'почта'`) or other amoCRM field variants.

In practice, amoCRM supports multiple email field name conventions. Without matching common variants, many real-world installations will fail to extract the contact email, causing `contactEmail` to be null and the attribution to be silently dropped (EC-05 path).

**Impact:** HIGH data loss for deployments where the amoCRM email field is not named exactly `'email'`.

**Fix:** Add known amoCRM email field name variants to the find condition, or fix the copy-paste to include the intended second pattern.

---

### Issue 2: `closedAt` is always `new Date()` — data accuracy bug (MEDIUM)

`crm-webhook-types.ts` line 95:

```typescript
return {
  dealId: lead.id,
  // ...
  closedAt: new Date(), // always set to webhook receipt time
```

amoCRM does not include the actual deal closure timestamp in the `leads.status` webhook payload type defined in this file. So `closedAt` is set to the time the webhook was received by KommuniK, not the time the deal was actually closed in amoCRM.

**Impact:** `timeToClose` and `confidence` calculations are based on inaccurate data. If the webhook is delayed (amoCRM retries, network issues), the actual deal close time could be hours or days different from what is stored. A deal closed yesterday but whose webhook only arrives today would have incorrect attribution metrics.

**Severity:** MEDIUM — the confidence calculation and time-to-close report will be subtly wrong in real-world conditions. This is a design choice that should be explicit, not accidental.

**Fix:** Document this limitation explicitly in the code comment, or add a `closed_at` timestamp to the webhook type if amoCRM provides it in other webhook fields.

---

### Issue 3: No input validation in webhook handler (MEDIUM)

`crm-webhook-routes.ts` line 33:

```typescript
const payload = req.body as AmoCRMWebhookPayload
```

The payload is cast directly to `AmoCRMWebhookPayload` without any Zod validation. The only check is whether `leads` or `contacts` keys exist. If amoCRM sends a malformed payload with unexpected field types (e.g., `status_id` as a number instead of a string), the `=== '142'` comparison silently fails and the event is ignored without any log entry.

The same pattern was cited as an issue in the FR-01 review for the Socket.io consumer. It reappears here in a different layer.

**Fix:** Add a Zod schema for `AmoCRMWebhookPayload` and use `.safeParse()` before processing.

---

### Issue 4: `console.warn` / `console.info` instead of structured logger (LOW)

All logging across `auto-attribution-service.ts` and `crm-webhook-routes.ts` uses raw `console.warn`, `console.info`, `console.error`. The Refinement document itself identifies this as a gap and recommends replacing with pino or winston.

In a production multi-tenant system, unstructured logs make it impossible to:
- Filter by `tenant_id` or `deal_id` in a log aggregator
- Set log levels per environment
- Correlate a specific webhook with its downstream events

**Severity:** LOW for functionality, MEDIUM for production operability.

---

### Issue 5: `operatorId` type mismatch — no UUID validation (LOW)

`auto-attribution-service.ts` line 115:

```typescript
operatorId: event.responsibleUserId,
```

`event.responsibleUserId` comes from amoCRM as `string | null`. In amoCRM, user IDs are integers. The `CreateAttributionInput.operatorId` expects a UUID (the DB column is `UUID`). Storing an amoCRM integer user ID string in a UUID column will cause a PostgreSQL type error at runtime.

**Fix:** Either store the amoCRM responsible user ID in a separate `varchar` column, or document that `operatorId` in the webhook context stores the amoCRM ID as a string and ensure the DB schema allows this. The current schema defines `operator_id UUID`, which will reject a non-UUID string.

---

### Issue 6: `findByTenantId` hard limit of 100 with no pagination (LOW)

`attribution-repository.ts` lines 128-135:

```typescript
const { rows } = await this.pool.query(
  `SELECT * FROM revenue.attributions
   WHERE tenant_id = $1
   ORDER BY created_at DESC
   LIMIT 100`,
  [tenantId],
)
```

The limit of 100 is hardcoded with no pagination support. For active tenants with many attributions, this silently truncates results. The Revenue Report (FR-06) may be aggregating only the last 100 attributions, not all of them, leading to underreported revenue.

**Fix:** Add `offset` and `limit` parameters to the repository method signature, or at minimum document the 100-record limit prominently so FR-06 callers are aware.

---

### Issue 7: `linkDetectionToDeal` does not validate tenant ownership (MEDIUM)

`auto-attribution-service.ts` lines 151-154:

```typescript
const detection = await this.pqlDetectionLookup.findById(detectionId)
if (!detection) {
  return null
}
```

When an operator creates a manual attribution, the service looks up the PQL detection by ID but does not verify that the detection belongs to the operator's tenant. A malicious operator who knows a `detectionId` from a different tenant could create an attribution pointing to another tenant's detection.

The `detection.tenantId` is read and used to populate `input.tenantId` (line 163), but there is no check that `detection.tenantId === operatorId's tenantId`. The attribution would be saved with the correct `tenantId` from the detection, but the attribution's `tenantId` would belong to the other tenant — meaning the operator's tenant would not see the record they just created, and the other tenant would have a record they did not create.

**Fix:** Add `if (detection.tenantId !== operatorTenantId) return null` after the detection lookup. The `operatorTenantId` must be passed as a parameter from the route handler.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | No hardcoded credentials |
| No raw SQL injection | PASS | All queries use parameterized $1/$2 |
| Webhook auth | FAIL — HIGH | No IP allowlist, no HMAC. Unauthenticated endpoint in production |
| Tenant isolation (manual routes) | PARTIAL | `deleteById` has no ownership check |
| Tenant isolation (webhook path) | PARTIAL | RLS context may not be set during webhook processing |
| Rate limiting | FAIL | No rate limiting on `/api/webhooks/amocrm` — trivially DoS-able |
| Input validation | FAIL | Webhook payload cast without Zod validation |
| PII handling | PASS | Contact email used transiently, not logged |

### Security Issue: Unauthenticated Webhook Endpoint (HIGH — production blocker)

The `/api/webhooks/amocrm` endpoint has no authentication. The Refinement document rates this as HIGH risk. The documentation says "security is provided by infrastructure-level IP allowlist" — but there is no implementation of this IP allowlist anywhere in the codebase.

A realistic attack scenario: any external party who discovers or guesses the webhook URL can POST fake deal-closed events with arbitrary `account_id` values, potentially:
1. Creating fake attributions in the system
2. Inflating revenue reports
3. Triggering downstream callbacks (`onDealAttributed`)

The HMAC-SHA256 implementation is deferred to SH-04. That deferral is acceptable for an MVP. What is not acceptable is shipping without ANY authentication mechanism — the IP allowlist should be implemented at the Nginx config level before this goes live.

---

## 4. Test Coverage Review

### What is tested (14 tests, all unit):

- `processDealClosed` happy path (4 tests)
- Idempotency via `findByDealId` (2 tests)
- Null returns for missing tenant, email, detection (3 tests)
- Value and operator preservation (2 tests)
- `linkDetectionToDeal` with various scenarios (3 tests + 1 event emit)

### What is NOT tested:

| Gap | Severity | Impact |
|-----|----------|--------|
| `isDealClosedWebhook` — no unit tests | MEDIUM | The ACL filter function has zero test coverage |
| `translateToDealClosedEvents` — no unit tests | HIGH | The copy-paste bug in email extraction (Issue 1) would have been caught by tests |
| `crm-webhook-routes.ts` — no integration tests | HIGH | HTTP behavior (400 validation, 200 for non-deal events, batch processing) is untested |
| `PgAttributionRepository` — no DB integration tests | MEDIUM | RLS behavior is unverified |
| `attribution-routes.ts` — no API tests | MEDIUM | REST endpoints untested end-to-end |
| Race condition (EC-12g) — no test | LOW | Concurrent webhook processing with same deal_id |
| `operatorId` UUID validation — no test | MEDIUM | amoCRM integer ID stored in UUID column — no test covers the runtime error |

The ACL translation functions (`isDealClosedWebhook`, `translateToDealClosedEvents`) are pure functions with no side effects. They are trivial to test with unit tests. Their absence is not justified by complexity — it is an omission.

The copy-paste bug in `translateToDealClosedEvents` (Issue 1) would have been caught by a test for Russian amoCRM field names or for alternative email field name formats. The absence of these tests means a real-world data loss bug shipped unchecked.

---

## 5. Documentation vs. Implementation Gaps

### Gap: Architecture.md describes ports incorrectly

Architecture.md states:

> `AttributionRepository` defined in `src/revenue/infrastructure/repositories/attribution-repository.ts`

The repository interface and implementation are both in the infrastructure layer, not in domain/ports. Per the project's folder structure rules, interfaces should be in `domain/ports/`. The `AttributionRepository` interface lives at the wrong layer. This is a structural deviation from the DDD pattern used elsewhere in the project.

### Gap: Specification.md says `findByTenantId` has "limit 100"

The Specification correctly documents the limit. However, the PRD's acceptance criteria for US-03 ("GET /api/attributions returns tenant-scoped data with date filters") does not mention the 100-record limit. An admin reviewing their attribution history would not know they might be seeing truncated results.

### Gap: EC-12g (race condition) is documented with recommendation to "add UNIQUE constraint on deal_id"

The Architecture.md schema shows:

```sql
CREATE UNIQUE INDEX idx_attributions_deal_id ON revenue.attributions(deal_id);
```

The schema has the UNIQUE constraint. But the repository code does not catch the unique constraint violation and handle it as idempotency. If the race condition triggers, the second INSERT will throw a PostgreSQL unique violation error that propagates to the caller as an unhandled exception.

---

## 6. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architectural compliance | 6/10 | Cross-BC import violation, RLS context gap in webhook path |
| Code quality | 6/10 | Copy-paste bug in ACL, `closedAt` accuracy issue, operatorId type mismatch |
| Test coverage | 4/10 | Zero tests for ACL functions, webhook route, repository, REST endpoints |
| Security | 5/10 | Unauthenticated webhook endpoint, no rate limiting, no input validation |
| Performance | 8/10 | Sequential DB queries are acceptable; indexes in place; 100-record limit is a latent issue |
| Documentation | 8/10 | SPARC docs are thorough; known gaps are documented; some inaccuracies in layer assignment |

**Overall: 37/60 (62%) — CONDITIONALLY APPROVED**

---

## 7. Blocking Issues Before Production

| # | Issue | Severity | Must Fix Before |
|---|-------|----------|----------------|
| P0 | No webhook authentication (no IP allowlist, no HMAC) | CRITICAL | Production deploy |
| P1 | `operatorId` UUID type mismatch — amoCRM user IDs are integers, not UUIDs | HIGH | Any real amoCRM integration |
| P2 | Copy-paste bug in email field matching — `'email' || 'email'` is a dead second condition | HIGH | Any real amoCRM integration |

## 8. Recommended Fixes Before v2

| # | Issue | Priority |
|---|-------|----------|
| R1 | Move `DealClosedEvent` to `shared/events/` to fix FF-02 violation | HIGH |
| R2 | Add tenant ownership check in `linkDetectionToDeal` | HIGH |
| R3 | Add `AND tenant_id = $2` to `findByDetectionId` and `deleteById` ownership check | HIGH |
| R4 | Add Zod validation for `AmoCRMWebhookPayload` | MEDIUM |
| R5 | Add unit tests for `isDealClosedWebhook` and `translateToDealClosedEvents` | MEDIUM |
| R6 | Add supertest-based integration tests for webhook route and attribution REST API | MEDIUM |
| R7 | Document `closedAt = new Date()` as webhook receipt time, not actual deal close time | MEDIUM |
| R8 | Add pagination to `findByTenantId` or document the 100-record truncation for FR-06 callers | MEDIUM |
| R9 | Replace `console.*` logging with structured logger | LOW |
| R10 | Catch PostgreSQL unique violation in `save()` and convert to idempotency return | LOW |
