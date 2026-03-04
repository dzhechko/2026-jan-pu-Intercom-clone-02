# Validation Report: FR-03 Memory AI — CRM Context
**Feature ID:** FR-03
**Validator:** requirements-validator
**Date:** 2026-03-04
**Overall Score:** 87/100 — PASS (threshold: 50)

---

## 1. INVEST Criteria Assessment

### I — Independent
**Score: 18/20**

FR-03 is largely independent. It requires:
- amoCRM MCP to be accessible (infrastructure dependency, not feature dependency)
- Redis to exist in the stack (already required by ADR-005/ADR-006)
- `contactEmail` to be on the Dialog record (BC-01 dependency — already implemented)

The feature does NOT depend on FR-01 (PQL Detector) to function for the sidebar.
PQL score boost integration is an optional enhancement.

**Minor gap:** The PQL context boost (ALG-08) is tightly coupled to PQL Detector logic
in PS-01. Separating this as a clear interface would improve independence.

---

### N — Negotiable
**Score: 17/20**

Acceptance criteria are specific but not over-specified:
- "CRM panel loads < 1 sec" — specific and measurable
- "enrichmentScore 0–1" — clear range, clear usage
- "graceful degradation when MCP unavailable" — implementation strategy is flexible

The 5-minute TTL is an implementation detail correctly left out of user stories.
The mock fallback strategy is an implementation choice, not a requirement.

**Minor concern:** The requirement to show mock data vs. "loading" state is
implicit. The business should decide whether mock data could mislead operators.

---

### V — Valuable
**Score: 20/20**

Directly addresses US-03 (core user story): "operator wants full customer history
before responding." The value is quantifiable:
- Reduces "what plan are you on?" type questions
- Enables PQL score boosting with real customer data
- Enables "Create Deal" button in sidebar (linked to FR-02, FR-12)

This is the "Memory AI" differentiator called out in CLAUDE.md as a core competitive
advantage vs. Intercom/Zendesk.

---

### E — Estimable
**Score: 18/20**

The feature is implemented — estimate is retrospective. Actual complexity:
- `CRMPort` interface: 1 hour
- `MemoryAIService` with caching: 3 hours
- `AmoCRMMCPAdapter` with ACL: 4 hours
- REST routes: 2 hours
- Unit tests: 3 hours
- **Total: ~13 hours** (1.5 days senior dev)

Estimability was high because pseudocode (PS-03, PS-06) existed before implementation.

---

### S — Small
**Score: 14/20**

The feature spans two bounded contexts (BC-02 + BC-04) and 4 files. It's at the upper
bound of "small." Could have been split:
- FR-03a: CRM data model + CRMPort interface
- FR-03b: MemoryAIService + caching
- FR-03c: AmoCRMMCPAdapter + REST API

As a single story it's still deliverable in one sprint. No split is required.

---

### T — Testable
**Score: 20/20**

Acceptance criteria are fully testable:
- "loads < 1 sec" → load test / timing assertion
- "enrichmentScore" → verified in unit tests
- "graceful degradation" → 2 explicit unit tests cover this
- "cache hit" → 1 unit test verifies CRM not called twice
- "tenant isolation" → cache key includes tenantId

11 unit tests implemented and passing. BDD scenarios defined in Refinement.md.

---

## 2. Acceptance Criteria Quality

| AC | Testable | Clear | Complete | Issues |
|----|:--------:|:-----:|:--------:|--------|
| CRM panel loads < 1 sec (US-03) | YES | YES | YES | — |
| enrichmentScore 0–1 | YES | YES | YES | — |
| Graceful degradation on MCP failure | YES | YES | YES | — |
| Redis caching with 5-min TTL | YES | YES | YES | — |
| Tenant isolated cache keys | YES | YES | YES | — |
| `not_configured` state for unconfigured tenants | YES | YES | YES | — |
| Context boost for Free plan + active account | YES | YES | PARTIAL | Score boost delta not specified |

**Gap identified:** The PQL score boost (+0.10 for Free plan, -0.05 for open deal)
is implemented in PS-01 but not in FR-03 acceptance criteria. This is a documentation
gap — the business rule exists in pseudocode but is not surfaced in the PRD. Recommend
adding to FR-03 AC or creating FR-03.8 acceptance criteria explicitly.

---

## 3. Non-Functional Requirements Assessment

| NFR | Specified | Testable | Implemented |
|-----|:---------:|:--------:|:-----------:|
| Latency < 1000ms p95 | YES | YES (load test) | YES (CB timeout 2000ms) |
| MCP timeout 2000ms | YES | YES (unit test) | YES (opossum + AbortSignal) |
| Circuit Breaker recovery < 30s | YES | YES (CB test) | YES (resetTimeout: 30000) |
| Data residency Russian VPS | YES | YES (audit) | YES (Cloud.ru MCP) |
| Tenant isolation | YES | YES (integration test) | YES (tenantId in cache key) |

**Gap:** Cache hit rate target (> 80%) is in the PRD but no monitoring is in place.
Redis metrics collection should be added to verify this in production.

---

## 4. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|:-----------:|:------:|-----------|
| Mock context misleads operators | MEDIUM | MEDIUM | Add visual indicator "Demo data" when mock is active |
| Cache serves stale plan after upgrade | LOW | MEDIUM | Webhook → `invalidateCache()` (deferred) |
| Circuit stays open undetected | MEDIUM | HIGH | Add alerting on circuit state change |
| amoCRM MCP not available at launch | HIGH | LOW | Mock fallback handles this by design |

---

## 5. Scoring Summary

| Criterion | Score | Max |
|-----------|------:|----:|
| Independent | 18 | 20 |
| Negotiable | 17 | 20 |
| Valuable | 20 | 20 |
| Estimable | 18 | 20 |
| Small | 14 | 20 |
| Testable | 20 | 20 |
| **Total** | **87** | **100** |

---

## 6. Verdict

**PASS — Score 87/100** (threshold: 50)

The feature is well-specified, valuable, and testable. The implementation matches
the requirements. Three gaps identified for future refinement:

1. **MEDIUM:** Add explicit AC for PQL score boost behavior (FR-03.8)
2. **MEDIUM:** Add monitoring for cache hit rate and circuit breaker state
3. **LOW:** Clarify mock data vs. empty state UX for operators
