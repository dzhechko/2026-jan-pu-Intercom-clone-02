# Validation Report: FR-01 PQL Detector v1 (Rule-Based)

**Feature ID:** FR-01
**Validator:** Requirements Validator (INVEST criteria)
**Date:** 2026-03-04
**Overall Score:** 87 / 100 — PASS (threshold: 50)

---

## 1. INVEST Criteria Evaluation

### I — Independent (18/20)

FR-01 is largely independent. It has no runtime dependency on FR-03 (Memory AI), FR-02 (PQL Flag UI), or FR-10 (ML v1). The rule engine is self-contained.

**Deduction (-2):** The `DialogPQLUpdater` port creates a compile-time coupling with BC-01 Conversation. However, this is resolved via dependency injection — the port interface is defined in BC-02, implemented by BC-01 infrastructure, and injected at bootstrap. Acceptable DDD pattern.

**Score: 18/20**

---

### N — Negotiable (18/20)

The 15 rules, weights, and tier thresholds are all constants in the codebase, making them easy to tune. The scoring model (top-5 normalization) is a deliberate design choice with documented rationale.

**Deduction (-2):** The tier thresholds (0.80 / 0.65) are hardcoded in `pql-score.ts`. They should ideally be per-tenant configurable (tactical design specifies `PQLDetector.threshold`). Currently global constants.

**Score: 18/20**

---

### V — Valuable (20/20)

This feature is the core differentiator of the product. Without PQL detection, the platform is just another chat tool. All downstream revenue features (FR-02, FR-06, FR-11) depend on it.

**Score: 20/20**

---

### E — Estimable (15/15)

The scope is precisely defined:
- 15 rules with exact patterns, weights, and types
- Scoring formula specified in pseudocode (PS-02)
- Database schema defined (tactical-design.md)
- API endpoints defined (2 routes)

**Score: 15/15**

---

### S — Small (9/15)

FR-01 spans 6 implementation files + 2 test files. It includes domain logic, service orchestration, 2 infrastructure adapters (REST + Socket.io), and a PostgreSQL repository.

**Deduction (-6):** This is closer to a small feature set than a single user story. In practice it was implemented across multiple waves and commits. However, it is still deliverable in a single sprint.

**Score: 9/15**

---

### T — Testable (7/10)

All acceptance criteria are testable:
- Tier classification tested with specific messages
- Score bounds tested (0–1 normalization)
- Sender type filter tested
- Edge cases (emoji, long messages) tested

**Deduction (-3):** No integration tests currently verify:
- RLS isolation (FF-03) for pql.detections specifically
- Round-trip DB persistence (only mocked in unit tests)
- The actual latency under load (FF-01 not measured in test suite)

**Score: 7/10**

---

## 2. Acceptance Criteria Quality

| Criterion | Measurable | Unambiguous | Testable |
|-----------|-----------|-------------|---------|
| 15+ signal patterns | YES | YES | YES |
| Score normalized 0–1 | YES | YES | YES |
| HOT >= 0.80, WARM >= 0.65 | YES | YES | YES |
| < 2 sec latency | YES | YES | PARTIAL (no load test) |
| RuleEngine coverage >= 95% | YES | YES | YES (jest --coverage) |
| Only CLIENT messages analyzed | YES | YES | YES |
| Cyrillic + Latin support | YES | PARTIAL (no explicit test per language) | PARTIAL |

---

## 3. Requirements Gaps Found

| Gap | Severity | Recommendation |
|-----|----------|----------------|
| No explicit test for each of the 15 rules individually | MEDIUM | Add per-rule positive/negative test matrix (FF-05 strict interpretation) |
| Tier thresholds not configurable per tenant | LOW | ADR item — defer to v2 per-tenant customization |
| No idempotency requirement specified for duplicate messages | LOW | Add to Refinement.md; implement in v2 |
| "Precision >= 65%" not backed by a test | MEDIUM | Need synthetic test set for offline evaluation (NFR-07) |
| Missing requirement: what happens when pql.detections INSERT fails | MEDIUM | Error handling spec missing; consumer silently catches all errors |

---

## 4. Summary

The requirements for FR-01 are well-specified, testable, and implemented correctly. The feature delivers clear business value as the foundation of the PQL detection pipeline.

**Primary gap:** The "precision >= 65% on synthetic test set" acceptance criterion (NFR-07) has no corresponding automated test. This should be addressed before claiming the full acceptance criteria are met.

**Recommendation:** Create `tests/synthetic/pql-precision.test.ts` with a labeled set of 50+ messages covering true positives and true negatives, measuring precision and recall against the 65% threshold.

**Final score: 87/100 — APPROVED for merge**
