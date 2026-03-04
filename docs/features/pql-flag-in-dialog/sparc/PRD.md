# PRD: FR-02 — PQL Flag in Dialog
**Feature ID:** FR-02
**Version:** 1.0 | **Date:** 2026-03-04 | **Status:** Implemented
**Bounded Context:** BC-02 PQL Intelligence

---

## 1. Overview

FR-02 makes the output of PQL detection (FR-01) visible to operators in the Operator Workspace. When a client message triggers PQL signals, the operator immediately sees a tier badge on the dialog item in the dialog list and a dedicated "PQL Score" panel in the right sidebar with a signal breakdown ("Why this is a lead").

This feature closes the loop: detection fires automatically, the operator sees the flag in real time, and can act without manual analysis.

---

## 2. Problem Statement

Operators handle tens of simultaneous dialogs. Without an automatic signal, high-intent clients are missed or detected too late. The PQL detector (FR-01) identifies purchase intent within 2 seconds, but that information must reach the operator's screen instantly and explain itself — otherwise operators will not trust or use it.

---

## 3. User Stories

```
US-01 [MUST]
  As an operator,
  I want to see a HOT / WARM / COLD tier badge on a dialog in the list
  when a client demonstrates buying intent,
  so that I can prioritise that dialog over routine support requests
  without reading every message.
  Acceptance: Badge appears within 2 seconds of the triggering message.

US-02 [MUST]
  As an operator,
  I want the right sidebar to show a PQL score and the list of matched signals
  when I open a flagged dialog,
  so that I understand WHY the system considers this a lead
  and can have an informed sales conversation.
  Acceptance: Top 5 signals shown (type + weight %), sorted by weight descending.

US-03 [SHOULD]
  As an operator,
  I want the PQL panel to update if a second, stronger PQL signal arrives in the
  same dialog session,
  so that an escalating interest is reflected immediately.
  Acceptance: pqlScore and pqlTier on the Dialog object update; sidebar re-fetches.

US-04 [COULD]
  As an operator,
  I want a one-click CRM link from the PQL panel to open the amoCRM contact card,
  so that I can view deal history without leaving the workspace.
  Acceptance: CRM link visible when contactEmail is present (Memory AI enriched).
```

---

## 4. Functional Requirements

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-02.1 | Tier badge in dialog list | HOT/WARM/COLD badge rendered next to channel badge for every dialog with pqlTier set. COLD is visually muted. |
| FR-02.2 | PQL Score panel in right sidebar | Shows numeric score (0–1) and tier label with colour coding. HOT = red, WARM = orange, COLD = grey. |
| FR-02.3 | Signal list ("Why lead") | Top 5 unique signals from the dialog's detections, sorted by weight descending, showing signal type and weight percentage. |
| FR-02.4 | Real-time update via WebSocket | pql:detected Socket.io event triggers refresh of dialog pqlScore/pqlTier without page reload. |
| FR-02.5 | Signal deduplication | Across multiple detections in one dialog, show one entry per signal type (highest-weight instance wins). |
| FR-02.6 | Loading state | While fetching signal data, display "Loading signals..." placeholder. |
| FR-02.7 | Empty state | If no signals detected, display "No significant signals detected" in the panel. |
| FR-02.8 | Score display | Score rendered as raw number from dialog aggregate (e.g. 0.85). Tier badge rendered as HOT/WARM/COLD string. |

---

## 5. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | PQL flag latency | Tier badge visible to operator < 2 seconds from triggering message (FF-01) |
| NFR-02 | Signal API response | GET /api/pql/detections/:dialogId responds < 300ms p95 |
| NFR-03 | Tenant isolation | Operator of tenant A cannot retrieve detections of tenant B (FF-03, RLS enforced) |
| NFR-04 | Accuracy | PQL precision >= 65% (rule-based v1) — threshold before showing badge (NFR-07) |
| NFR-05 | No PII in signals | matchedText stored from client message; never forwarded to foreign APIs (ADR-003) |

---

## 6. Out of Scope (FR-02)

- One-click CRM deal creation (FR-12)
- PQL Pulse push notifications (FR-11)
- ML-based scoring (FR-10, v2 pipeline)
- Revenue attribution (FR-06)
- Feedback collection on PQL accuracy (separate feature)

---

## 7. Acceptance Criteria (BDD Summary)

1. Given a client sends "А у вас есть Enterprise-тариф для команды 50 человек?"
   When the message is received by the backend
   Then within 2 seconds the dialog item shows a HOT badge
   And the right panel shows score >= 0.80 with signals ENTERPRISE, SCALE

2. Given a dialog with no client PQL signals
   When the operator opens the right panel
   Then PQL Score section shows "No significant signals detected"
   And no tier badge appears on the dialog list item

3. Given tenant A operator authenticated
   When they call GET /api/pql/detections/:dialogId for a dialog belonging to tenant B
   Then the API returns an empty detections array (RLS isolation)
