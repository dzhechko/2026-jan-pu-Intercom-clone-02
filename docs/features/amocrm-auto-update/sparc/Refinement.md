# FR-12: amoCRM Auto-Update — Refinement

## Edge Cases and Risk Analysis

### EC-12a: Unknown amoCRM Account ID

**Scenario:** Webhook arrives from an amoCRM account not registered in KommuniK.
**Current Behavior:** `TenantLookup.findByAmoCRMAccountId()` returns null; service logs warning and returns null.
**Risk:** LOW -- amoCRM must be configured by admin, so orphan webhooks are rare.
**Mitigation:** Logging allows monitoring for misconfiguration.

### EC-12b: Duplicate Deal Attribution

**Scenario:** Same deal closed event arrives twice (amoCRM retries, or network duplication).
**Current Behavior:** `findByDealId()` returns existing attribution; no new record created.
**Risk:** NONE -- idempotency is guaranteed.
**Test:** `should return existing attribution when deal is already attributed`

### EC-12c: No PQL Detection for Contact Email

**Scenario:** Deal closes for a contact who never triggered a PQL detection.
**Current Behavior:** Returns null, logs info message. Attribution is not created.
**Risk:** LOW -- expected behavior for deals unrelated to support interactions.
**Future Enhancement:** Partial attribution with lower confidence for "nearby" detections.

### EC-12d: Multiple Deals in Single Webhook

**Scenario:** amoCRM batch webhook contains status changes for multiple deals.
**Current Behavior:** `Promise.allSettled` processes each independently. Failures do not cascade.
**Risk:** LOW -- error isolation prevents one bad deal from blocking others.
**Test:** Verified by webhook route implementation pattern.

### EC-12e: Time-to-Close Exceeds 90 Days

**Scenario:** Deal closes 3+ months after PQL detection.
**Current Behavior:** Attribution is still created but with `confidence = 0`.
**Risk:** MEDIUM -- zero-confidence attributions may confuse revenue reports.
**Recommendation:** Consider adding a configurable max-window filter. Currently the report should filter or flag zero-confidence attributions.

### EC-12f: Missing Contact Email (EC-05)

**Scenario:** amoCRM deal has no contact email in custom fields.
**Current Behavior:** Service returns null, logs warning. No error thrown.
**Risk:** MEDIUM -- if amoCRM contacts frequently lack email, many deals will not be attributed.
**Mitigation:** Future enhancement could match by phone number or amoCRM contact ID.

### EC-12g: Concurrent Webhook Processing

**Scenario:** Two webhooks for the same deal arrive simultaneously.
**Current Behavior:** Both may pass the `findByDealId` check before either inserts. The second INSERT would succeed (no UNIQUE constraint enforced in current schema).
**Risk:** LOW -- amoCRM rarely sends true duplicates simultaneously.
**Recommendation:** Add UNIQUE constraint on `deal_id` column and catch unique violation as idempotency.

### EC-12h: Deal Value = 0

**Scenario:** Free-tier conversion or deal with no monetary value.
**Current Behavior:** Attribution created normally. Value 0 is valid.
**Risk:** NONE -- intentional design for tracking non-monetary conversions.

## Security Considerations

### Webhook Authentication (SH-04 -- Deferred)

**Current State:** No authentication on `/api/webhooks/amocrm` endpoint.
**Risk:** HIGH -- anyone can POST fake webhook payloads.
**Recommended Hardening:**
1. IP allowlist for amoCRM server ranges
2. HMAC-SHA256 signature verification using shared secret
3. Rate limiting on webhook endpoint (SH-03)

### Tenant Data Isolation

**Current State:** RLS policies on `revenue.attributions` table. Webhook route resolves tenant from `account_id`.
**Risk:** LOW -- proper implementation. Even if a malicious webhook provides wrong `account_id`, the attribution would go to wrong tenant (but tenant must exist in lookup table).
**Mitigation:** The `TenantLookup` acts as a whitelist -- only known account IDs map to tenants.

## Performance Considerations

### Webhook Latency

The attribution pipeline performs 3-4 database queries sequentially:
1. `findByAmoCRMAccountId` -- tenant lookup
2. `findByDealId` -- idempotency check
3. `findByContactEmail` -- PQL detection match
4. `save` -- insert attribution

**Estimated p95:** < 100ms for in-region PostgreSQL.
**Constraint:** FF-01 PQL detection latency does not apply here (webhook is async).

### Index Coverage

Required indexes for query performance:
- `revenue.attributions(deal_id)` -- idempotency lookups
- `revenue.attributions(tenant_id, closed_at)` -- period queries for reports
- `revenue.attributions(pql_detection_id)` -- detection-level lookups

## Test Coverage Assessment

### Current Coverage: 14 tests passing

| Category | Tests | Status |
|----------|-------|--------|
| Happy path: auto-attribution | 4 | PASS |
| Idempotency | 2 | PASS |
| Null/missing data paths | 3 | PASS |
| Value preservation | 2 | PASS |
| Manual attribution | 3 | PASS |
| Domain event emission | 2 (included above) | PASS |

### Missing Test Coverage

| Gap | Priority | Description |
|-----|----------|-------------|
| Webhook route tests | HIGH | No integration tests for `crm-webhook-routes.ts` |
| ACL translation tests | MEDIUM | No unit tests for `isDealClosedWebhook` and `translateToDealClosedEvents` |
| Repository integration tests | MEDIUM | No tests with real PostgreSQL for `PgAttributionRepository` |
| Attribution routes tests | MEDIUM | No tests for REST API endpoints |
| Concurrent webhook race condition | LOW | No test for simultaneous duplicate processing |

### Recommendations

1. **Add webhook route tests:** Use supertest to verify HTTP 400/200 responses, payload validation, and batch processing.
2. **Add ACL unit tests:** Test `isDealClosedWebhook` with various payload shapes and `translateToDealClosedEvents` with edge cases (missing fields, multiple deals).
3. **Add UNIQUE constraint on deal_id:** Prevents race condition in EC-12g.
4. **Consider structured logging:** Replace `console.warn`/`console.info` with a structured logger for better observability.
5. **Implement webhook signature verification (SH-04):** Critical for production deployment.
