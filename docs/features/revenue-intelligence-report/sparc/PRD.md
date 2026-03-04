# FR-06: Revenue Intelligence Report -- Product Requirements Document

**Feature ID:** FR-06
**Bounded Context:** BC-03 Revenue
**Priority:** MUST | **Milestone:** M2
**Status:** Implemented

---

## 1. Problem Statement

PLG/SaaS companies running KommuniQ use the PQL detection engine (FR-03) to identify purchase-intent signals in support dialogs. However, without a structured reporting mechanism, there is no way to:

- Quantify the revenue impact of PQL-driven support interactions.
- Attribute closed CRM deals back to specific PQL detections.
- Evaluate operator performance in converting PQL signals into revenue.
- Communicate the ROI of the support team to executive stakeholders.

**Core Question:** "How much revenue did our support team generate this month through PQL intelligence?"

## 2. Solution Overview

A monthly Revenue Intelligence Report that automatically:

1. Collects all PQL detections for the reporting period.
2. Cross-references them with closed CRM deals (via amoCRM MCP adapter, mock in v1).
3. Calculates revenue attribution with confidence scoring based on temporal proximity.
4. Generates a styled HTML report with KPI cards, attribution table, and top operator rankings.
5. Supports PDF download (via Puppeteer, with HTML fallback) and email delivery.

## 3. User Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-01 | As an admin, I want to generate a monthly revenue report so I can see how much revenue PQL detection contributed | Report contains total dialogs, PQL detected, conversion rate, total revenue |
| US-02 | As an admin, I want to view attribution details (deal value, time-to-close, confidence) so I can evaluate PQL quality | Attribution table shows dealId, value, timeToClose, confidence, operator |
| US-03 | As an admin, I want to download the report as PDF so I can share it with stakeholders | GET /api/reports/:id/pdf returns PDF (or HTML fallback) |
| US-04 | As an admin, I want reports sent via email so I receive them automatically each month | sendReport() delivers HTML to tenant billingEmail, transitions to SENT |
| US-05 | As an admin, I want to see top-performing operators so I can recognize their contribution | Summary includes topOperators ranked by totalRevenue |

## 4. Key Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| Total Dialogs | Count of all dialogs in the period | conversation.dialogs |
| PQL Detected | Count of PQL detections (all tiers) | pql.detections |
| PQL Conversion Rate | pqlConvertedToDeals / pqlDetected | Computed |
| Total Revenue | Sum of deal values from attributed deals | CRM deals |
| Avg Time to Close | Mean days from PQL detection to deal closure | Computed |
| Attribution Confidence | timeFactor * pqlScore (90-day max window) | Computed |

## 5. Out of Scope (v1)

- Real amoCRM integration (uses MockCRMDealReader; real adapter planned for v2).
- Contact email-based deal matching (v1 uses round-robin; v2 will match via email linkage).
- SpaCy NER PII masking in reports.
- Multi-currency support (v1 uses USD formatting).
- Scheduled cron execution (generateMonthlyReports is callable but not auto-scheduled).

## 6. Dependencies

| Dependency | Direction | Description |
|-----------|-----------|-------------|
| FR-01 (IAM/JWT) | Upstream | JWT authentication for API routes |
| FR-03 (PQL RuleEngine) | Upstream | PQL detections data |
| FR-07 (Operator Workspace) | Upstream | Dialog and operator data |
| FR-08 (Analytics Dashboard) | Downstream | Uses revenue data for dashboard metrics |
| FR-12 (Auto-Attribution) | Downstream | Auto-attribution feeds into reports |
