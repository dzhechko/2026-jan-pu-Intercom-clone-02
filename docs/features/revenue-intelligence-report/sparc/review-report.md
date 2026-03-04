# Architecture Compliance Review: FR-06 Revenue Intelligence Report

**Feature ID:** FR-06
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** CONDITIONALLY APPROVED — 3 real bugs found, 2 of which are production-blocking

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — CONDITIONAL PASS

The documentation claims "PASS — all adapters use SQL, no TypeScript imports from other BCs." This is false.

**Finding 1: Direct cross-BC import in `auto-attribution-service.ts` (MEDIUM)**

```typescript
// src/revenue/application/services/auto-attribution-service.ts line 18
import { DealClosedEvent } from '@integration/infrastructure/crm-webhook-types'
```

This is a direct TypeScript import from BC-04 Integration into BC-03 Revenue's **application layer**. The application layer is domain-adjacent — importing from `@integration/infrastructure/` here violates FF-02 strictly. The type `DealClosedEvent` should be defined as a shared event type in `shared/events/` or re-declared as a local port input type in BC-03's domain ports.

**Finding 2: Direct cross-BC import in `revenue-routes.ts` (LOW)**

```typescript
// src/revenue/infrastructure/revenue-routes.ts line 24
import { StubEmailService } from '@notifications/infrastructure/email-service'
```

The infrastructure layer importing a concrete class from BC-06 Notifications breaks FF-02 at the wiring level. The `ReportEmailSender` port is correctly defined, but it is wired to a concrete implementation from another BC's infrastructure in the router factory. The `StubEmailService` should live in BC-03's own infrastructure or in a shared stub package.

**Verdict:** FF-02 has two concrete violations the validation report missed. The validation report's claim of full PASS is incorrect.

---

### FF-03: Tenant RLS Isolation — CONDITIONAL PASS with 2 Critical Gaps

**Finding 3: `findById` in `revenue-routes.ts` has no tenant scope check (CRITICAL)**

```typescript
// src/revenue/infrastructure/revenue-routes.ts lines 87-98
const getReport: RequestHandler = async (req, res) => {
  try {
    const report = await reportRepo.findById(req.params.id)
    if (!report) {
      return res.status(404).json({ error: 'Report not found' })
    }
    return res.json({ report })
  }
```

The `GET /api/reports/:id` route calls `reportRepo.findById(req.params.id)` and returns the full report including `htmlContent` to the caller — but it **never checks** that `report.tenantId === req.tenantId`. It relies 100% on RLS. The same gap applies to `GET /api/reports/:id/pdf` (line 138).

If RLS is not configured correctly — or if the database connection pool reuses a session where `app.tenant_id` was set to a different value — a tenant can fetch another tenant's complete revenue report including HTML content, deal values, and operator IDs. There is zero defense in depth at the application layer.

Compare with the correct pattern in `listReports` which correctly uses `findByTenantId(tenantReq.tenantId, ...)` — the tenant ID from the JWT is explicitly passed, giving double protection.

**Fix required before production:**
```typescript
const report = await reportRepo.findById(req.params.id)
if (!report || report.tenantId !== tenantReq.tenantId) {
  return res.status(404).json({ error: 'Report not found' })
}
```

**Finding 4: `attribution-routes.ts` — three endpoints with no tenant scope check (CRITICAL)**

```typescript
// src/revenue/infrastructure/attribution-routes.ts

// GET /:detectionId — line 108-122
const attribution = await attributionRepo.findByDetectionId(req.params.detectionId)
// Returns attribution with no check that attribution.tenantId === req.tenantId

// DELETE /:id — line 129-142
const deleted = await attributionRepo.deleteById(req.params.id)
// Deletes by ID with no check that the record belongs to the caller's tenant
```

The `GET /api/attributions/:detectionId` and `DELETE /api/attributions/:id` endpoints perform lookups by a bare UUID with no application-layer tenant check. If RLS is misconfigured, a tenant can read or delete another tenant's attribution records. The DELETE case is particularly dangerous — a malicious operator with a valid JWT can destroy another tenant's revenue data if they can enumerate UUIDs.

**Verdict:** FF-03 has two production-blocking security holes in route handlers. The RLS claim in SPARC docs is overstated; the DB-level RLS exists on `revenue.reports` (per schema in Specification.md) but there is no evidence RLS is also enabled on `revenue.attributions`. The `attribution-repository.ts` file header says "All queries run under RLS" but no schema migration creates that policy.

---

### FF-03: RLS on `revenue.attributions` — NOT VERIFIED (HIGH)

The Specification.md defines the RLS schema only for `revenue.reports`:

```sql
ALTER TABLE revenue.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON revenue.reports ...
```

No corresponding DDL exists for `revenue.attributions` in any SPARC document. The `attribution-repository.ts` comment claims RLS applies but there is no migration that creates it. This is a documentation-to-code gap that may be a production security hole.

---

### FF-02: `AnalyticsService` — No Port Abstraction (LOW)

```typescript
// src/revenue/application/services/analytics-service.ts line 48-49
export class AnalyticsService {
  constructor(private readonly pool: Pool) {}
```

`AnalyticsService` accepts a raw `pg.Pool` directly in the application layer. This violates hexagonal architecture: the application layer is coupled to a specific infrastructure technology (PostgreSQL). If the DB driver ever changes, this service must be rewritten. It should accept a port interface (e.g., `AnalyticsPort`) with concrete SQL implementations in the infrastructure layer.

This is a lesser violation because SQL-heavy analytics services are often treated pragmatically, but it is inconsistent with the rest of BC-03's design and the project's stated hexagonal pattern.

---

### FF-02: SQL Interpolation in `AnalyticsService` — Potential SQL Injection (HIGH)

```typescript
// src/revenue/application/services/analytics-service.ts lines 59, 141
const since = `NOW() - INTERVAL '${days} days'`
// ...
`WHERE tenant_id = $1 AND created_at >= ${since}`
```

The `days` integer is interpolated directly into SQL strings. Although `days` is parsed by Zod as `z.coerce.number().int().min(1).max(365)`, the value flows through `periodToDays()` which returns a hardcoded integer — the risk here is low for the current code path. However, the `getDailyTrend` method accepts `days` directly as a parameter with the same interpolation pattern:

```typescript
async getDailyTrend(tenantId: string, days = 30): Promise<...> {
  const { rows } = await this.pool.query(
    `...FROM generate_series((NOW() - INTERVAL '${days} days')::date...`,
    [tenantId],
  )
```

If `getDailyTrend` is ever called from a code path other than the validated route handler (e.g., a future cron job or admin tool that passes user-controlled `days`), this becomes an injection vector. The safe pattern is to use a lookup table or validate `days` to an enum within the service itself.

---

### ADR-007: JWT + RLS — PARTIAL PASS

The `generateReport` endpoint correctly extracts `tenantId` from the JWT:
```typescript
const tenantReq = req as TenantRequest
const report = await service.generateReportForTenant(tenantReq.tenantId, period)
```

However, `getReport` and `downloadPdf` do not extract `tenantId` from the JWT at all — they rely entirely on RLS (see Finding 3 above). This is a partial ADR-007 violation: the ADR says "RLS handles it," but the pattern across this BC is inconsistent — some routes use explicit tenant extraction, others do not.

---

### FF-04: Circuit Breaker — DEFERRED (but inadequately documented)

The MockCRMDealReader has no Circuit Breaker and the SPARC docs note this as acceptable for v1. However, the `analytics-service.ts` uses `Promise.all()` for 8 concurrent PostgreSQL queries with no timeout or error boundary per query. If any single query hangs (e.g., due to a missing index under load), the entire dashboard request hangs until the connection pool times out. This is not an MCP adapter issue but it is a reliability gap in the analytics hot path.

---

## 2. Code Quality Review

### Strengths

1. **Clean domain model.** The RevenueReport aggregate is a pure data structure with pure transition functions (`createRevenueReport`, `markReportGenerated`, `markReportSent`). No side effects in the domain layer. This is correctly done.

2. **Port/adapter pattern applied consistently in RevenueReportService.** Five port interfaces (`PQLDetectionReader`, `CRMDealReader`, `TenantReader`, `DialogReader`, `ReportEmailSender`) are all injected, making the service fully testable without infrastructure. The mock injection pattern in tests is clean.

3. **Idempotent report generation.** The DRAFT re-generation logic (step 8 in the pipeline using `existing ?? createRevenueReport(...)`) is correctly implemented and tested.

4. **Error isolation in batch processing.** `generateMonthlyReports` wraps each tenant in try/catch with proper error accumulation. This matches BR-05 exactly.

5. **Zod validation on API inputs.** Both `PaginationSchema` and `GenerateSchema` are used correctly with `safeParse()` and proper error response formatting.

6. **Self-contained HTML report.** The `report-html-generator.ts` is a pure function with inline styles — appropriate for both email delivery and Puppeteer PDF generation.

---

### Issues Found

#### Issue 1: `analytics-service.ts` references a non-existent column `report_id` (BUG — HIGH)

```typescript
// src/revenue/application/services/analytics-service.ts lines 107-113
this.pool.query(
  `SELECT COUNT(DISTINCT a.pql_detection_id)::int AS converted
   FROM revenue.attributions a
   INNER JOIN revenue.reports r ON a.report_id = r.id
   WHERE a.tenant_id = $1
     AND a.closed_at >= ${since}`,
  [tenantId],
),
```

The `revenue.attributions` table schema (as defined in `attribution-repository.ts`) does not have a `report_id` column. The INSERT statement on line 77-93 of `attribution-repository.ts` inserts: `id, tenant_id, pql_detection_id, dialog_id, deal_id, deal_value, closed_at, time_to_close, operator_id, confidence`. There is no `report_id`.

This query will throw a PostgreSQL error `column a.report_id does not exist` at runtime when the analytics dashboard is loaded. The `Promise.all` wrapping it will propagate the error, making the entire `/api/analytics/dashboard` endpoint return HTTP 500 for every request.

This is a **production-blocking bug** that the test suite did not catch because `analytics-service.test.ts` mocks the pool with predetermined responses, bypassing actual SQL validation.

**Fix:** Remove the JOIN. The conversion rate can be computed as `COUNT(DISTINCT a.pql_detection_id)` from `revenue.attributions WHERE tenant_id = $1 AND closed_at >= ${since}` without joining `revenue.reports`.

---

#### Issue 2: `getReport` and `downloadPdf` routes have no tenant ownership check (BUG — HIGH)

Already documented in Finding 3 under FF-03. Repeated here for completeness in the issues section.

A valid JWT holder for tenant-A can call `GET /api/reports/<UUID-from-tenant-B>` and receive the full report including HTML content and all financial data if RLS is misconfigured or connection pooling reuses sessions.

---

#### Issue 3: `buildAttributions` makes N sequential DB calls inside a loop (PERFORMANCE — MEDIUM)

```typescript
// src/revenue/application/services/revenue-report-service.ts lines 277-295
for (let i = 0; i < Math.min(qualifiedDetections.length, wonDeals.length); i++) {
  const operatorId = await this.deps.dialogReader.findOperatorByDialogId(
    detection.dialogId,
  )
  // ...
}
```

For each matched detection-deal pair, a separate `findOperatorByDialogId` DB query is issued. If a report has 50 attributions, this is 50 sequential `SELECT operator_id FROM conversations.dialogs WHERE id = $1` queries. This makes report generation O(N) in DB round trips for the attribution count.

The dialog IDs are known before the loop; they can be batched into a single `WHERE id = ANY($1)` query. At 50+ attributions this will measurably slow report generation and could cause timeout issues for large tenants.

---

#### Issue 4: `parsePeriod` splits on `-` which breaks for invalid input (LOW)

```typescript
// src/revenue/domain/aggregates/revenue-report.ts lines 99-103
export function parsePeriod(periodStr: string): ReportPeriod {
  const [year, month] = periodStr.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Invalid period format: ${periodStr}. Expected YYYY-MM.`)
  }
  return { year, month }
}
```

Input `"2026-00"` passes the Zod regex `/^\d{4}-\d{2}$/` but fails `month < 1`. However, input `"2026-13"` passes the regex and the `!month` guard (13 is truthy) but fails `month > 12`. Input `"0000-01"` passes all guards and produces a valid `ReportPeriod { year: 0, month: 1 }` which will create a broken date range via `getPeriodDateRange`. The Zod validation at the route layer validates the format, not the semantic validity of the year. No test covers year boundary cases.

Minor issue but shows incomplete validation depth-in-defense.

---

#### Issue 5: HTML generator does not escape `tenantName` or `operatorId` (LOW)

```typescript
// src/revenue/infrastructure/report-html-generator.ts line 71
<p style="...">${tenantName} &mdash; ${periodLabel}</p>

// line 52
<td style="...">${op.operatorId}</td>

// line 43
<td style="...">${a.operatorId ?? 'N/A'}</td>
```

`tenantName` comes from `iam.tenants.name` (user-provided at signup), `operatorId` is a UUID (safe), but if a tenant name ever contains `<script>` or HTML special characters, the generated HTML will be malformed. In email delivery this is low severity (most email clients strip scripts). In Puppeteer PDF generation, a crafted tenant name could inject HTML/JS into the PDF. The Refinement.md acknowledges this as TD-06/security note "Sanitize before HTML rendering in v2" but it should be addressed in v1 for the tenantName field specifically.

---

#### Issue 6: `getReport` route returns full report including `htmlContent` with no role guard (LOW)

```typescript
// src/revenue/infrastructure/revenue-routes.ts lines 87-97
const getReport: RequestHandler = async (req, res) => {
  const report = await reportRepo.findById(req.params.id)
  return res.json({ report })
}
```

Any operator with a valid JWT (not just ADMIN) can retrieve the full report including the `htmlContent` (which can be 50KB+). Analytics routes correctly require ADMIN role via `requireAdmin` middleware. Report routes have no role guard. Per the PRD, US-01 through US-05 all specify "As an admin" — but any operator can currently call these endpoints.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | No hardcoded credentials found |
| Parameterized SQL (injection) | PARTIAL | Most queries use `$1` params; `AnalyticsService` interpolates `days` and `period` directly into SQL strings |
| Input validated with Zod | PASS | REST routes validated; `AnalyticsService` does not validate its own inputs |
| Tenant isolation via RLS | PARTIAL — see Findings 3 & 4 | RLS on `revenue.reports` exists in spec; no DDL for `revenue.attributions`; routes lack application-layer ownership check |
| No PII sent to foreign APIs | PASS | All data stays on-premise; StubEmailService is a no-op |
| HTML sanitization | FAIL | `tenantName` is rendered unescaped into HTML report |
| Role-based access on report routes | FAIL | `GET /api/reports/:id` accessible to any operator, not only ADMIN |
| Cross-BC data exposure | FAIL | `auto-attribution-service.ts` imports `DealClosedEvent` from BC-04 (cross-BC import) |
| RLS on `revenue.attributions` | UNVERIFIED | No migration DDL found; attribution rows could be cross-tenant accessible |

---

## 4. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architectural compliance | 6/10 | Two FF-02 cross-BC imports, AnalyticsService bypasses hexagonal pattern, SQL interpolation risk |
| Code quality | 7/10 | Domain model is clean; N+1 query in attribution loop, report_id bug in analytics SQL |
| Test coverage | 6/10 | 36 tests pass but miss the `report_id` column bug entirely; no integration tests; no route-level tenant ownership tests |
| Security | 5/10 | Two routes lack ownership checks; no RLS DDL for attributions; HTML injection risk; any operator can read reports |
| Performance | 6/10 | N sequential DB calls in buildAttributions; 8 parallel queries with no per-query timeout in analytics |
| Documentation | 8/10 | SPARC docs are complete and well-structured; the claim of FF-02 and FF-03 PASS in validation report is materially incorrect |

**Overall: 38/60 (63%)**

---

## 5. Overall Verdict

**CONDITIONAL APPROVE — Fix 2 blocking issues before production deploy**

### Production-Blocking Issues (must fix before deploy)

**Block 1: `analytics-service.ts` — `report_id` column does not exist**
File: `src/revenue/application/services/analytics-service.ts` line 110
The PQL conversion query JOINs `revenue.attributions a ON a.report_id = r.id` but `report_id` is not in the `revenue.attributions` schema. This will throw a PostgreSQL error on every `/api/analytics/dashboard` call. Remove the JOIN.

**Block 2: `getReport` and `downloadPdf` — no tenant ownership check**
Files: `src/revenue/infrastructure/revenue-routes.ts` lines 87-97, 136-178
These routes return reports and HTML content identified only by UUID, with no assertion that `report.tenantId === req.tenantId`. Add the ownership check or confirm that the DB connection always has `SET app.tenant_id` set before the query executes.

### High-Priority Issues (fix before first real-tenant data)

**High 1: `deleteAttribution` — no tenant check**
File: `src/revenue/infrastructure/attribution-routes.ts` line 129-142
DELETE by bare UUID with no tenant ownership check. Add `const attr = await attributionRepo.findByDetectionId(id); if (!attr || attr.tenantId !== req.tenantId)` before deleting.

**High 2: RLS on `revenue.attributions` — add migration DDL**
No RLS policy is created for the `revenue.attributions` table in any documented migration. Create the policy analogous to `revenue.reports`.

**High 3: FF-02 cross-BC import in `auto-attribution-service.ts`**
Move `DealClosedEvent` type to `shared/events/` or redeclare it as a local port type in `src/revenue/domain/ports/`.

### Recommended Fixes Before v2

- Replace SQL string interpolation in `AnalyticsService` with allowlist lookup for interval values
- Batch the `findOperatorByDialogId` calls in `buildAttributions` into a single `WHERE id = ANY($1)` query
- Add `requireAdmin` middleware to `GET /api/reports`, `POST /api/reports/generate`, `GET /api/reports/:id/pdf`
- HTML-escape `tenantName` in `report-html-generator.ts`
- Move `StubEmailService` wiring out of BC-06 import into a BC-03 local stub

### What This Feature Does Well

The domain model is correct. The RevenueReport aggregate lifecycle, the PQLAttribution value object, and the port-driven architecture of `RevenueReportService` are all solid. The idempotency logic, COLD tier filtering, 90-day confidence window, and batch error isolation all work as specified. The test suite is thorough for the service layer. The HTML report generator is clean and email-compatible. The MockCRMDealReader is an honest placeholder with clear v2 replacement path.

The architectural problems are in the routes and analytics wiring — not the domain logic. This is fixable without redesigning the feature.
