# FR-06: Revenue Intelligence Report
**Status:** Done | **BC:** BC-03 Revenue | **Priority:** MUST

## Summary
Monthly revenue report that collects PQL detections and CRM deal data, calculates revenue attribution with confidence scoring, generates a styled HTML report (with optional PDF via Puppeteer), and supports email delivery. The report proves that support-driven PQL detection directly contributes to closed revenue.

## User Stories
- US-01: As an admin, I want to generate a monthly revenue report so that I can see how much revenue PQL detection contributed
- US-02: As an admin, I want to view attribution details (deal value, time-to-close, confidence) so that I can evaluate PQL quality
- US-03: As an admin, I want to download the report as PDF so that I can share it with stakeholders
- US-04: As an admin, I want reports sent via email so that I receive them automatically each month
- US-05: As an admin, I want to see top-performing operators so that I can recognize their contribution

## Technical Design

### Files Created
- `src/revenue/domain/aggregates/revenue-report.ts` -- RevenueReport aggregate with DRAFT -> GENERATED -> SENT lifecycle, period parsing, and date range helpers
- `src/revenue/domain/value-objects/pql-attribution.ts` -- PQLAttribution value object with time-to-close calculation and confidence scoring (90-day max window)
- `src/revenue/domain/value-objects/revenue-summary.ts` -- RevenueSummary value object with operator performance aggregation and conversion rate calculation
- `src/revenue/application/services/revenue-report-service.ts` -- Orchestrates the full report pipeline: collect PQL detections, cross-reference CRM deals, build attributions, calculate summary, generate HTML
- `src/revenue/infrastructure/repositories/revenue-report-repository.ts` -- PostgreSQL repository with JSONB storage for attributions/summary, period-based lookups
- `src/revenue/infrastructure/report-html-generator.ts` -- Self-contained HTML template with inline styles for email/PDF compatibility, includes KPI cards, attribution table, and top operators
- `src/revenue/infrastructure/revenue-routes.ts` -- REST API routes for report CRUD and generation
- `src/revenue/infrastructure/adapters/pg-pql-detection-reader.ts` -- PostgreSQL adapter implementing PQLDetectionReader port
- `src/revenue/infrastructure/adapters/pg-dialog-reader.ts` -- PostgreSQL adapter implementing DialogReader port
- `src/revenue/infrastructure/adapters/pg-tenant-reader.ts` -- PostgreSQL adapter implementing TenantReader port
- `src/revenue/infrastructure/adapters/mock-crm-deal-reader.ts` -- Mock CRM deal reader for development (real amoCRM adapter planned for v2)

### Key Decisions
- **Idempotent generation:** If a GENERATED or SENT report already exists for a tenant+period, it is returned without re-generation. DRAFT reports get re-generated.
- **Round-robin attribution (v1):** HOT/WARM PQL detections are matched to WON deals in order. Production v2 will match via contact email linkage.
- **COLD tier excluded:** Only HOT and WARM PQL detections are eligible for revenue attribution.
- **Confidence scoring:** Based on temporal proximity (90-day max window) multiplied by PQL score. Beyond 90 days, confidence drops to 0.
- **HTML-first approach:** Reports are stored as HTML; PDF is generated on-demand via Puppeteer with fallback to HTML preview.
- **Error isolation in batch:** `generateMonthlyReports()` processes all tenants independently, collecting errors without stopping.
- **Port/adapter pattern:** Domain service depends on abstract ports (PQLDetectionReader, CRMDealReader, etc.), making it fully testable with mocks.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/reports | List reports for authenticated tenant (paginated) |
| GET | /api/reports/:id | Get specific report with full details |
| POST | /api/reports/generate | Trigger report generation (optional `period` in YYYY-MM format) |
| GET | /api/reports/:id/pdf | Download PDF or HTML preview |

## Dependencies
- Depends on: FR-01 (IAM/JWT), FR-03 (PQL RuleEngine detections), FR-07 (Operator Workspace for dialog data)
- Blocks: FR-08 (Analytics Dashboard uses revenue data), FR-12 (Auto-Attribution feeds into reports)

## Tests
- `src/revenue/application/services/revenue-report-service.test.ts` -- 12 tests covering:
  - Report generation with correct summary from detections and deals
  - Conversion rate calculation
  - Idempotency (no re-generation of existing reports)
  - Empty period handling (no detections, no deals)
  - Detections with no matching deals
  - Revenue attribution with time-to-close and confidence
  - COLD tier exclusion from attribution
  - Top operators in summary
  - DRAFT report re-generation
  - Batch generation for all active tenants
  - Error isolation across tenants in batch mode
  - Email sending for GENERATED reports (with guards for not-found and DRAFT status)

## Acceptance Criteria
- [x] Report aggregate supports DRAFT -> GENERATED -> SENT lifecycle
- [x] Attribution confidence calculated from temporal proximity and PQL score
- [x] Only HOT and WARM PQL detections are attributed to deals
- [x] HTML report includes KPI cards, attribution table, and top operators
- [x] Report generation is idempotent per tenant+period
- [x] Batch generation isolates errors per tenant
- [x] PDF download falls back to HTML preview when Puppeteer unavailable
- [x] REST API validates input with zod schemas
- [x] All queries respect RLS tenant isolation
