# FR-06: Revenue Intelligence Report -- Final Summary

**Feature ID:** FR-06
**Bounded Context:** BC-03 Revenue
**Status:** Implemented and Tested
**Priority:** MUST | **Milestone:** M2

---

## 1. Implementation Overview

The Revenue Intelligence Report feature transforms KommuniQ's support-driven PQL detection into a measurable revenue metric. It provides monthly reports that answer the core business question: "How much revenue did our support team generate through PQL intelligence?"

### What Was Built

- **3 domain files**: RevenueReport aggregate, PQLAttribution value object, RevenueSummary value object.
- **3 application services**: RevenueReportService (report pipeline), AutoAttributionService (deal-to-PQL linking), AnalyticsService (dashboard metrics).
- **7 infrastructure files**: PostgreSQL repository, 4 port adapters, HTML generator, 3 REST route modules.
- **3 test suites**: 36 tests total covering the full pipeline.

### File Inventory

| Layer | File | Lines |
|-------|------|-------|
| Domain | `src/revenue/domain/aggregates/revenue-report.ts` | 114 |
| Domain | `src/revenue/domain/value-objects/pql-attribution.ts` | 42 |
| Domain | `src/revenue/domain/value-objects/revenue-summary.ts` | 49 |
| Application | `src/revenue/application/services/revenue-report-service.ts` | 357 |
| Application | `src/revenue/application/services/auto-attribution-service.ts` | 183 |
| Application | `src/revenue/application/services/analytics-service.ts` | 294 |
| Infrastructure | `src/revenue/infrastructure/repositories/revenue-report-repository.ts` | 146 |
| Infrastructure | `src/revenue/infrastructure/repositories/attribution-repository.ts` | 146 |
| Infrastructure | `src/revenue/infrastructure/report-html-generator.ts` | 156 |
| Infrastructure | `src/revenue/infrastructure/revenue-routes.ts` | 202 |
| Infrastructure | `src/revenue/infrastructure/attribution-routes.ts` | 151 |
| Infrastructure | `src/revenue/infrastructure/analytics-routes.ts` | 120 |
| Infrastructure | `src/revenue/infrastructure/adapters/pg-pql-detection-reader.ts` | 39 |
| Infrastructure | `src/revenue/infrastructure/adapters/pg-dialog-reader.ts` | 35 |
| Infrastructure | `src/revenue/infrastructure/adapters/pg-tenant-reader.ts` | 35 |
| Infrastructure | `src/revenue/infrastructure/adapters/mock-crm-deal-reader.ts` | 32 |
| Tests | `src/revenue/application/services/revenue-report-service.test.ts` | 404 |
| Tests | `src/revenue/application/services/auto-attribution-service.test.ts` | 311 |
| Tests | `src/revenue/application/services/analytics-service.test.ts` | 250 |

## 2. Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Hexagonal architecture with ports/adapters | Full testability; domain logic is isolated from infrastructure |
| JSONB storage for attributions and summary | Flexible schema evolution without migrations |
| HTML-first report generation | Works for both email clients and PDF (Puppeteer) conversion |
| Idempotent report generation | Safe to retry; prevents duplicate reports for same period |
| Round-robin attribution (v1) | Simple heuristic for MVP; contact email matching planned for v2 |
| Error-isolated batch processing | One failing tenant does not block others |
| Inline HTML styles | Email client compatibility (no external CSS) |

## 3. Test Coverage

### RevenueReportService (12 tests)
- Report generation with correct summary metrics
- Conversion rate calculation
- Idempotency (skip re-generation of existing reports)
- Empty period handling (no detections, no deals)
- Detections without matching deals
- Revenue attribution with time-to-close and confidence
- COLD tier exclusion from attribution
- Top operators in summary
- DRAFT report re-generation
- Batch generation for all active tenants
- Error isolation across tenants in batch mode
- Email sending with guards for not-found and DRAFT status

### AutoAttributionService (14 tests)
- Attribution creation from deal closed event
- DealAttributed event emission
- Time-to-close calculation
- Confidence scoring
- Duplicate prevention (idempotency)
- Missing PQL detection handling
- Missing contact email handling
- Unknown tenant handling
- Deal value preservation
- Operator assignment from responsible user
- Manual link creation
- Detection not found for manual link
- Duplicate prevention for manual links
- Event emission on manual links

### AnalyticsService (10 tests)
- Full dashboard metrics with populated data
- Empty data graceful handling
- PQL rate calculation with fractional values
- Period interval parameter verification
- Default channel counts for missing channels
- Channel distribution
- Tier distribution
- Daily trend with days parameter

**Total: 36 tests, all passing.**

## 4. API Surface

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/reports | JWT | List reports (paginated, htmlContent stripped) |
| GET | /api/reports/:id | JWT | Get full report with HTML content |
| POST | /api/reports/generate | JWT | Trigger report generation |
| GET | /api/reports/:id/pdf | JWT | Download PDF or HTML preview |
| POST | /api/attributions | JWT | Manually create attribution |
| GET | /api/attributions | JWT | List attributions with optional period filter |
| GET | /api/attributions/:detectionId | JWT | Get attribution by detection |
| DELETE | /api/attributions/:id | JWT | Remove attribution |
| GET | /api/analytics/dashboard | JWT+ADMIN | All-in-one dashboard metrics |
| GET | /api/analytics/dialogs-by-channel | JWT+ADMIN | Channel distribution |
| GET | /api/analytics/pql-by-tier | JWT+ADMIN | PQL tier distribution |
| GET | /api/analytics/daily-trend | JWT+ADMIN | Daily dialog trend |

## 5. Fitness Function Compliance

| FF | Result | Notes |
|----|--------|-------|
| FF-02 No cross-BC imports | PASS | All cross-BC data access through SQL adapters |
| FF-03 Tenant RLS isolation | PASS | RLS enabled on revenue.reports; all queries parameterized |
| FF-04 Circuit Breaker on MCP | N/A (v1) | MockCRMDealReader; real adapter will use opossum |
| FF-10 Data residency | PASS | No foreign API calls; all data on Russian VPS |

## 6. Known Limitations and Next Steps

| Priority | Item | Target |
|----------|------|--------|
| HIGH | Replace MockCRMDealReader with AmoCRM MCP adapter | v2 |
| HIGH | Contact email-based deal matching (replace round-robin) | v2 |
| MEDIUM | Add RUB currency formatting | v2 |
| MEDIUM | Integrate with Resend API for real email delivery | v2 |
| MEDIUM | Add cron scheduler for automated monthly generation | v2 |
| LOW | Parallelize batch tenant processing | v2 |
| LOW | Add HTML sanitization for report content | v2 |
