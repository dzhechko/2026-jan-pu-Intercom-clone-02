# Validation Report: FR-02 — PQL Flag in Dialog
**Feature ID:** FR-02
**Date:** 2026-03-04
**Validator:** requirements-validator

---

## 1. INVEST Analysis

### User Story US-01: Tier Badge in Dialog List

| Criterion | Score (0–5) | Assessment |
|-----------|:-----------:|------------|
| **I**ndependent | 4 | Depends on FR-01 (PQL Detector) being implemented. FR-02 itself can be developed independently from FR-03 (Memory AI). |
| **N**egotiable | 5 | Display format (badge vs. icon vs. colour) is negotiable. Tier logic is fixed by domain. |
| **V**aluable | 5 | Directly enables operators to prioritise high-value dialogs. Core revenue-intelligence value proposition. |
| **E**stimable | 5 | Frontend badge = 2 hours. WebSocket listener update = 1 hour. Well-estimated. |
| **S**mall | 5 | Badge display is a focused UI change. Fits in one sprint. |
| **T**estable | 5 | Visual: badge colour + label. Automated: `pqlBadge('HOT')` renders red. WS: event received → state updated. |
| **TOTAL** | **29/30** | Excellent |

### User Story US-02: Signal Panel ("Why lead")

| Criterion | Score (0–5) | Assessment |
|-----------|:-----------:|------------|
| **I**ndependent | 4 | Requires pql.detections rows to exist (FR-01 detection must have run). Fetches via REST. |
| **N**egotiable | 5 | Number of signals shown (currently 5), sorting, deduplication strategy — all negotiable. |
| **V**aluable | 5 | Operators need explanation, not just a flag. "Why lead" is essential for trust and conversion behaviour. |
| **E**stimable | 4 | API already exists. Frontend fetch + render = 3–4 hours. Deduplication logic = 1 hour. |
| **S**mall | 4 | Could ship separately from the badge if needed. |
| **T**estable | 5 | API: GET returns signals. Frontend: signals list renders, deduplication verified, loading/empty states. |
| **TOTAL** | **27/30** | Excellent |

---

## 2. Acceptance Criteria Quality

### FR-02.1 Tier Badge in Dialog List
- **Testable?** YES — can be automated with component test `pqlBadge('HOT')` returns element with class `text-red-700`
- **Unambiguous?** YES — explicit colour mapping defined in Specification.md section 6.1
- **Complete?** YES — all three tiers handled, null/undefined handled

### FR-02.2 PQL Score Panel
- **Testable?** YES — render test with `dialog.pqlScore = 0.9, pqlTier = 'HOT'` → `text-3xl` number + badge
- **Unambiguous?** YES — background colours, text colours, score format specified
- **Complete?** YES — covers HOT/WARM/COLD and undefined

### FR-02.3 Signal List
- **Testable?** YES — `data-testid="pql-signals-list"` exists on the list element
- **Unambiguous?** YES — top 5, descending by weight, type + percentage format
- **Complete?** MOSTLY — deduplication rule documented. Edge case: what if signal list changes between detections within one session? Covered in Refinement EC-09.

### FR-02.4 Real-time Update
- **Testable?** YES — integration test: emit `pql:detected` → assert dialog state updated
- **Unambiguous?** YES — depends on `dialog?.pqlScore` in useEffect
- **Complete?** YES — trigger chain documented in Pseudocode.md

### FR-02.5 Signal Deduplication
- **Testable?** YES — unit test: two detections with overlapping type → one entry
- **Unambiguous?** YES — "highest-weight instance wins" is explicit
- **Complete?** YES

### FR-02.6 / FR-02.7 Loading & Empty States
- **Testable?** YES — render tests with mock API states
- **Unambiguous?** YES — distinct string constants
- **Complete?** YES

---

## 3. NFR Validation

| NFR | Criterion | Measurable? | How to Measure |
|-----|-----------|:-----------:|----------------|
| NFR-01: < 2s latency | Time from message to badge | YES | Playwright E2E: `page.waitForSelector('[data-tier="HOT"]')` with 2000ms timeout |
| NFR-02: API < 300ms | GET /api/pql/detections response time | YES | `supertest` + `Date.now()` comparison in integration test |
| NFR-03: RLS isolation | Cross-tenant query returns empty | YES | Integration test with two tenant tokens |
| NFR-04: >= 65% precision | PQL accuracy on test set | YES | Offline eval script on labeled dialog dataset |
| NFR-05: No PII forwarded | matchedText stored locally only | YES | Audit: no HTTP call from RuleEngine or PQLDetectorService to external APIs |

---

## 4. Requirements Coverage Gaps

### Gap 1: CRM Click-Through (FR-02 PRD mentions it)
The PRD acceptance criteria states "Click-through в CRM-карточку". The implementation includes Memory AI (FR-03) which provides `contactEmail` but does NOT include a direct amoCRM URL link in the PQL panel. This is deferred. Recommendation: add as FR-02.9 or track under FR-12.

**Severity:** LOW — core value (flag + explanation) is delivered. CRM link is a workflow enhancement.

### Gap 2: COLD Tier Badge
The implementation renders a COLD badge (gray) in DialogList. From a UX perspective, showing COLD badges for every dialog could create visual noise. The PRD does not explicitly specify whether COLD should show a badge or be invisible. Current implementation: COLD badge visible (gray, muted).

**Recommendation:** Consider suppressing COLD badge or making it opt-in via operator settings. Document as UX debt.

**Severity:** LOW

### Gap 3: pql:detected Frontend Handler Not Tested in Integration
The `useDialogs` hook `pql:detected` handler is not explicitly covered by an integration test. Only unit tests for `pqlBadge()` and `pqlTierDisplay()` exist in component tests.

**Recommendation:** Add Socket.io mock test for `useDialogs` that verifies state mutation on `pql:detected` event.

**Severity:** MEDIUM

---

## 5. Overall Score

| Section | Weight | Score |
|---------|--------|-------|
| INVEST (US-01) | 25% | 29/30 = 97% |
| INVEST (US-02) | 25% | 27/30 = 90% |
| Acceptance Criteria Quality | 30% | 6.5/7 = 93% |
| NFR Coverage | 20% | 5/5 = 100% |
| **Weighted Total** | | **94%** |

**Gate:** >= 50 required to proceed. **PASS** (94%)

---

## 6. Recommendations

1. Add integration test for `pql:detected` → `useDialogs` state update
2. Track CRM click-through link as a separate acceptance criterion (FR-02.9 or FR-12)
3. Define explicit UX policy for COLD badge visibility (show/hide based on operator preference)
4. Add E2E Playwright test measuring badge appearance latency (NFR-01 automated gate)
