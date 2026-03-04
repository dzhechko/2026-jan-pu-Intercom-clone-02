# FR-06: Revenue Intelligence Report -- Review Report

**Feature ID:** FR-06
**Bounded Context:** BC-03 Revenue
**Reviewed:** 2026-03-04
**Reviewer:** Automated Code Review (brutal-honesty)

---

## 1. Overall Assessment

**Rating: GOOD (7.5/10)**

The Revenue Intelligence Report is a well-structured implementation that follows hexagonal architecture principles consistently. The port/adapter pattern enables full testability, and the 36-test suite provides solid coverage. However, there are several areas where the implementation could be strengthened before production deployment.

## 2. Strengths

### S-01: Clean Port/Adapter Separation
The `RevenueReportService` depends on 5 abstract port interfaces (`PQLDetectionReader`, `CRMDealReader`, `TenantReader`, `DialogReader`, `ReportEmailSender`), making the entire report pipeline testable with mock injection. This is textbook hexagonal architecture.

### S-02: Idempotent Report Generation
The idempotency check at the start of `generateReportForTenant` prevents duplicate reports. DRAFT recovery is also handled correctly (re-use existing ID, call `update` instead of `save`).

### S-03: Error-Isolated Batch Processing
`generateMonthlyReports` wraps each tenant in a try/catch, collecting errors without stopping the batch. This is critical for production reliability.

### S-04: Comprehensive Test Coverage
36 tests across 3 suites cover happy paths, edge cases (empty data, COLD exclusion, DRAFT recovery), error conditions (not found, wrong status), and batch failure isolation.

### S-05: Zod Input Validation
All REST API inputs are validated with Zod schemas, preventing malformed data from reaching the service layer.

## 3. Issues Found

### CRITICAL: None

### HIGH

#### H-01: Round-Robin Attribution Is Inaccurate

**File:** `src/revenue/application/services/revenue-report-service.ts`, lines 262-299

The `buildAttributions` method matches detections to deals by array index (round-robin). This produces arbitrary pairings that do not reflect actual causation. While documented as a v1 simplification, the reports generated with this logic may mislead stakeholders about which PQL detections actually led to which deals.

**Recommendation:** At minimum, add a visible disclaimer in the HTML report stating that attributions are heuristic estimates. Prioritize contact email-based matching for v2.

#### H-02: Currency Hardcoded to USD

**File:** `src/revenue/infrastructure/report-html-generator.ts`, line 30-33

```typescript
const revenueFormatted = summary.totalRevenue.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
})
```

The project targets the Russian market (FF-10 Data Residency, 152-FZ compliance). Reports should display amounts in RUB, not USD.

**Recommendation:** Make currency configurable per tenant. Default to RUB for the Russian market.

### MEDIUM

#### M-01: No Input Sanitization in HTML Generator

**File:** `src/revenue/infrastructure/report-html-generator.ts`

`tenantName`, `operatorId`, and `dealId` are interpolated directly into HTML without escaping. While these values originate from the database (not user input), a compromised DB record or a tenant name containing HTML/JS could lead to XSS in the rendered report.

**Recommendation:** Add HTML entity escaping for all interpolated values.

#### M-02: Sequential Data Collection in Report Pipeline

**File:** `src/revenue/application/services/revenue-report-service.ts`, lines 136-154

Steps 3-5 (fetch detections, deals, dialog count) are executed sequentially. These are independent queries that could run in parallel with `Promise.all`.

```typescript
// Current (sequential):
const detections = await this.deps.pqlReader.findByTenantIdForPeriod(...)
const deals = await this.deps.crmReader.findClosedDealsForPeriod(...)
const totalDialogs = await this.deps.dialogReader.countByTenantForPeriod(...)

// Recommended (parallel):
const [detections, deals, totalDialogs] = await Promise.all([
  this.deps.pqlReader.findByTenantIdForPeriod(...),
  this.deps.crmReader.findClosedDealsForPeriod(...),
  this.deps.dialogReader.countByTenantForPeriod(...),
])
```

**Impact:** Reduces report generation latency by ~2x for the data collection phase.

#### M-03: AnalyticsService Uses String Interpolation for SQL Intervals

**File:** `src/revenue/application/services/analytics-service.ts`, line 59

```typescript
const since = `NOW() - INTERVAL '${days} days'`
```

While `days` is derived from a controlled enum (`periodToDays`), this pattern of string interpolation in SQL is fragile and could become a SQL injection vector if the input validation is relaxed in the future.

**Recommendation:** Use parameterized intervals or precompute the date in TypeScript and pass it as a parameter.

#### M-04: Mock CRM Data Is Deterministic by Tenant Hash

**File:** `src/revenue/infrastructure/adapters/mock-crm-deal-reader.ts`

The mock generates deals based on `tenantId.split('').reduce(...)`, which means the same tenant always gets the same deals regardless of period. This makes development testing unreliable because period boundaries are ignored.

**Recommendation:** Incorporate `start` and `end` dates into the mock generation for more realistic behavior.

### LOW

#### L-01: No Rate Limiting on Report Generation

**File:** `src/revenue/infrastructure/revenue-routes.ts`

The `POST /api/reports/generate` endpoint has no rate limiting. While idempotency prevents duplicate reports, repeated calls still execute the full pipeline (DB queries, HTML generation) before discovering the existing report.

**Recommendation:** Add rate limiting per SH-03 specifications (should follow `/api/dialogs` pattern).

#### L-02: Missing Period Validation in parsePeriod

**File:** `src/revenue/domain/aggregates/revenue-report.ts`, lines 98-104

`parsePeriod` validates month range (1-12) but does not validate year range. A period like "0001-01" or "9999-12" would be accepted.

**Recommendation:** Add year range validation (e.g., 2020-2100).

#### L-03: Console Logging Instead of Structured Logger

Multiple files use `console.log`, `console.warn`, `console.error` directly. This makes log aggregation and filtering difficult in production.

**Recommendation:** Introduce a structured logger (e.g., pino) with correlation IDs.

#### L-04: No Integration Tests for Repository Layer

`PgRevenueReportRepository` and `PgAttributionRepository` have no dedicated integration tests. They are only tested indirectly through mock-based unit tests.

**Recommendation:** Add integration tests with a real PostgreSQL instance verifying RLS isolation (per FF-03 testing requirements).

## 4. Architectural Compliance Checklist

| Rule | Status | Notes |
|------|--------|-------|
| Domain layer has no infra imports | PASS | Clean separation |
| Cross-BC communication via adapters only | PASS | SQL adapters, no TS imports |
| Zod validation on all API inputs | PASS | PaginationSchema, GenerateSchema, CreateAttributionSchema |
| Error handling: never swallow silently | PASS | All catches logged to console |
| Port interfaces for external dependencies | PASS | 5 ports defined in service layer |
| RLS tenant isolation | PASS | Parameterized queries + RLS policies |
| No `any` or `@ts-ignore` | PASS | Correct typing throughout |

## 5. Recommendations Summary

| Priority | Item | Effort |
|----------|------|--------|
| HIGH | H-01: Add disclaimer for round-robin attribution | 1h |
| HIGH | H-02: Switch currency to RUB | 2h |
| MEDIUM | M-01: HTML entity escaping | 2h |
| MEDIUM | M-02: Parallelize data collection | 1h |
| MEDIUM | M-03: Parameterize SQL intervals | 1h |
| LOW | L-01: Rate limiting on generate endpoint | 1h |
| LOW | L-02: Year range validation | 30m |
| LOW | L-03: Structured logging | 4h |
| LOW | L-04: Repository integration tests | 4h |

## 6. Verdict

**APPROVED with recommendations.** The implementation is solid, well-tested, and architecturally compliant. The critical path (report generation, attribution, batch processing) works correctly. The HIGH-priority items (H-01 attribution disclaimer, H-02 currency) should be addressed before the M2 milestone release. MEDIUM items can be addressed in the next sprint.
