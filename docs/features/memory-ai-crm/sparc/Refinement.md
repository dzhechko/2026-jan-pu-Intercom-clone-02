# Refinement: FR-03 Memory AI — CRM Context
**Feature ID:** FR-03
**Version:** 1.0 | **Date:** 2026-03-04
**Reference:** docs/refinement.md edge case catalog

---

## 1. Edge Cases

### EC-01: MCP Timeout (2000ms exceeded)

**Scenario:** amoCRM MCP takes longer than 2 seconds to respond.

**How it manifests:**
- `AbortSignal.timeout(2000)` aborts the fetch
- `opossum` circuit breaker also has a 2000ms timeout
- The error propagates to `callMCP()`, which throws

**Current handling:**
```typescript
// AmoCRMMCPAdapter.getContactContextEnriched()
} catch {
  return CRMResult.ok(this.generateMockContext(email))
}
```

**Result:** Operator sees mock context in sidebar. No error shown. Dialog continues normally.

**Risk:** If MCP consistently times out, circuit opens after 50% error rate in 10s window.
Recovery takes 30 seconds (resetTimeout). During that window, all context calls return mock.

**Mitigation:** Monitor `opossum` metrics. Alert when circuit opens. Set timeout expectations.

---

### EC-02: Partial CRM Data (contact found, no deals)

**Scenario:** Contact exists in amoCRM but has no leads/deals yet.

**translateToEnrichedContext() behavior:**
```typescript
deals = (raw.leads || []).map(...)   // empty array if no leads
hasDeal field = false → enrichmentScore -= 0.20
```

**Result:** Context returned with `deals: []`, `enrichmentScore` reduced accordingly.
PQL score boost logic handles this: if `enrichmentScore < 0.3`, no boost applied.

---

### EC-03: Contact Not Found in CRM

**Scenario:** `contactEmail` has no record in amoCRM.

**MCP response:** `{ contacts: [], leads: [], dialogs_count: 0 }`

**translateToEnrichedContext() behavior:**
- `contact = undefined`
- All optional fields absent
- `enrichmentScore = 0.0` (no fields filled)
- `deals = []`, `tags = []`, `previousDialogCount = 0`

**Result:** Minimal context object returned. Operator sees "no CRM data" state in sidebar.

---

### EC-04: Tenant CRM Not Configured

**Scenario:** Tenant has not connected their amoCRM account yet.

**Trigger:** `mcpBaseUrl` is empty string (`''`).

**AmoCRMMCPAdapter.getContactContextEnriched():**
```typescript
if (!this.mcpBaseUrl) {
  return CRMResult.notConfigured()
}
```

**MemoryAIService.fetchContext():**
```typescript
if (result.status === 'not_configured') {
  return result  // pass through — do NOT cache, do NOT degrade
}
```

**API response:**
```json
{ "status": "not_configured", "data": null }
```

**Operator UX:** Sidebar shows "Connect amoCRM to enable Memory AI" prompt.

---

### EC-05: Empty Contact Email

**Scenario:** Dialog was started without a contact email (e.g., anonymous widget session).

**MemoryAIService.fetchContext():**
```typescript
if (!contactEmail) {
  return CRMResult.ok(this.emptyContext(contactEmail))
}
```

**No Redis lookup, no CRM call.** Returns immediately with `enrichmentScore: 0`.

**Operator UX:** Sidebar shows "No contact information" state.

---

### EC-06: Redis Unavailable

**Scenario:** Redis container is down or connection timed out.

**MemoryAIService constructor:** Redis is passed as `Redis | null`.
**getFromCache():**
```typescript
} catch {
  return null   // Redis read error → treat as cache miss
}
```

**setInCache():**
```typescript
} catch {
  // Cache write failure is non-critical — log and continue
}
```

**Result:** Every request hits CRM directly. No errors surfaced to operator.
Performance degrades (every call is a live MCP call), but correctness is maintained.

---

### EC-07: Concurrent Requests (Same Email, Same Tenant)

**Scenario:** Two operators open dialogs with the same client simultaneously.

**Race condition:** Both miss cache simultaneously, both call CRM, both write cache.

**Impact:** Duplicate CRM calls (2 instead of 1). Both write identical data to Redis.
Second write overwrites first — no corruption, no data loss.

**Not worth fixing at v1 scale.** At high scale, a distributed lock (Redis SET NX) could
prevent the "thundering herd" problem. Deferred to v2.

---

### EC-08: CRM Data Changes During TTL

**Scenario:** Client upgrades their plan during a 5-minute cache window.

**Impact:** Operator sees stale plan info for up to 5 minutes.

**Mitigation:**
- `invalidateCache()` method exists for webhooks to call on CRM updates.
- TTL is 5 minutes (short enough for support sessions).
- Operator can manually refresh (route will re-fetch on next call after TTL expires).

---

### EC-09: Very Large Email Strings

**Scenario:** Malformed email like `a@${'x'.repeat(1000)}.com` in cache key.

**Redis key:** `memory-ai:context:{tenantId}:{email.toLowerCase()}`
Redis keys have a max length of 512MB — not a practical concern.

**Impact:** None. Redis handles arbitrary key lengths.

---

### EC-10: Unicode/Special Characters in Tags

**Scenario:** amoCRM tags contain Russian text or emoji.

**translateToEnrichedContext():**
```typescript
tags: contact?.tags?.map((t: any) => t.name || String(t)) ?? []
```

Tags are stored as-is. JSON serialization handles Unicode correctly.
Redis stores UTF-8 strings. No issue.

---

## 2. Testing Strategy

### 2.1 Unit Tests (Implemented)

File: `src/pql/application/services/memory-ai-service.test.ts`

| Test | Coverage |
|------|----------|
| Returns enriched CRM context from adapter | Happy path |
| Returns empty context for empty email | EC-05 |
| Passes through `not_configured` status | EC-04 |
| Caches result in Redis after successful fetch | Cache write |
| Returns cached result on second call without hitting CRM | Cache hit |
| `invalidateCache()` removes cached entry | EC-cache invalidation |
| Works without Redis (null) | EC-06 |
| Returns empty context when CRM adapter throws | EC-01 |
| Returns empty context when CRM returns error status | Graceful degradation |
| Returns 0 enrichmentScore for empty context | EC-05 |
| Returns high enrichmentScore when CRM provides full data | Happy path |

### 2.2 Integration Tests (Required)

```typescript
describe('MemoryAI Integration', () => {
  it('GET /api/memory/:dialogId returns context for known dialog')
  it('GET /api/memory/:dialogId returns 404 for unknown dialog')
  it('GET /api/memory/:dialogId returns not_configured when mcpBaseUrl empty')
  it('GET /api/memory/contact/:email returns context directly')
  it('tenant A cannot access tenant B dialog context via /api/memory/:dialogId')
})
```

### 2.3 Circuit Breaker Tests (Required)

```typescript
describe('AmoCRMMCPAdapter Circuit Breaker', () => {
  it('returns mock context when circuit is OPEN')
  it('transitions to OPEN state after 50% errors in rolling window')
  it('MCP call respects 2000ms timeout')
  it('returns mock context on network timeout')
  it('notConfigured when mcpBaseUrl is empty')
})
```

### 2.4 BDD Scenarios

From `docs/test-scenarios.feature` Memory AI section:

```gherkin
Scenario: Operator opens dialog with known CRM contact
  Given tenant has amoCRM configured
  And client "alice@acme.com" exists in amoCRM with plan "Professional"
  When operator opens dialog with alice@acme.com
  Then sidebar shows plan "Professional"
  And sidebar shows enrichmentScore > 0.5
  And response time < 1000ms

Scenario: Operator opens dialog with unknown client
  Given tenant has amoCRM configured
  And client "unknown@example.com" does NOT exist in amoCRM
  When operator opens dialog
  Then sidebar shows empty context
  And enrichmentScore is 0

Scenario: amoCRM MCP is unavailable
  Given amoCRM MCP circuit is OPEN
  When operator opens any dialog
  Then sidebar shows mock context (no error)
  And enrichmentScore shows 0.85 (mock)
  And no exception is thrown to operator

Scenario: Tenant has no CRM configured
  Given tenant mcpBaseUrl is empty
  When operator opens dialog
  Then API returns status "not_configured"
  And sidebar shows "Connect amoCRM" prompt
```

---

## 3. Performance Risks

| Risk | Probability | Impact | Mitigation |
|------|:-----------:|:------:|-----------|
| Redis cache miss storm on Redis restart | LOW | MEDIUM | Circuit breaker limits CRM hammering |
| amoCRM MCP rate limiting | MEDIUM | LOW | Redis cache reduces CRM calls by ~80% |
| Enrichment score calculation wrong at scale | LOW | LOW | Unit tested, pure function |
| Mock context shown in production indefinitely | MEDIUM | MEDIUM | Alert on circuit open; monitor MCP health |
| Cache key collision across tenants | NEAR-ZERO | HIGH | tenantId embedded in key |

---

## 4. Security Considerations

### 4.1 PII in Redis Cache

CRM context contains PII (contact name, email, plan). Redis cache must be:
- Deployed on the same private Docker network (not public-facing)
- Protected by Redis AUTH if network is shared
- Not logged (never log raw CRM context)

### 4.2 Tenant Isolation in Cache

Cache key format: `memory-ai:context:{tenantId}:{email}`

The tenantId prevents cross-tenant reads. However, if an attacker knows both the tenant
ID and a victim's email, they could construct the key. This is acceptable because:
1. Redis is internal to the Docker network
2. Attackers cannot access Redis without network access
3. JWT middleware validates tenantId before any cache key is constructed

### 4.3 No PII in Logs

The `catch` blocks do not log the email or CRM data — only error messages.

```typescript
console.error('[MemoryAI] Error fetching context by dialogId:', error)
// NOT: console.error('[MemoryAI] Error for email:', contactEmail)
```

---

## 5. Open Questions

| # | Question | Status |
|---|----------|--------|
| OQ-01 | Should `invalidateCache()` be exposed as a REST endpoint for CRM webhooks? | Deferred to v2 |
| OQ-02 | Should cache TTL be configurable per tenant (e.g., high-churn vs. enterprise)? | Deferred to v2 |
| OQ-03 | When RAG MCP is connected (FR-03.9), should it be parallel to CRM or sequential? | Parallel (see PS-03) |
| OQ-04 | Should enrichmentScore be stored in the PQL detection record for ML training? | Yes (PS-01 step 8 snapshots memoryContext) |
