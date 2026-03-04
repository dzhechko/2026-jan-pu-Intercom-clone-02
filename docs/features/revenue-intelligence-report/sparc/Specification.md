# FR-06: Revenue Intelligence Report -- Specification

**Feature ID:** FR-06
**Bounded Context:** BC-03 Revenue

---

## 1. Domain Model

### 1.1 Aggregate: RevenueReport

```
RevenueReport {
  id: UUID (PK)
  tenantId: UUID (FK -> iam.tenants)
  period: ReportPeriod { year: number, month: number }
  status: 'DRAFT' | 'GENERATED' | 'SENT'
  attributions: PQLAttribution[]  (JSONB)
  summary: RevenueSummary | null  (JSONB)
  pdfUrl: string | null
  htmlContent: string | null
  createdAt: DateTime
  updatedAt: DateTime
}
```

**Lifecycle:** `DRAFT -> GENERATED -> SENT`

- `DRAFT`: Created during data collection phase.
- `GENERATED`: All data collected, HTML rendered, summary calculated.
- `SENT`: Email delivered to tenant billing address.

### 1.2 Value Object: PQLAttribution

```
PQLAttribution {
  pqlDetectionId: string
  dialogId: string
  dealId: string
  dealValue: number
  closedAt: Date
  timeToClose: number       // days from detection to deal close
  operatorId: string | null
  confidence: number         // 0-1 score
}
```

### 1.3 Value Object: RevenueSummary

```
RevenueSummary {
  totalDialogs: number
  pqlDetected: number
  pqlConvertedToDeals: number
  pqlConversionRate: number  // 0-1
  totalRevenue: number
  avgTimeToClose: number     // days
  topOperators: OperatorPerformance[]
}

OperatorPerformance {
  operatorId: string
  dealsWon: number
  totalRevenue: number
  avgTimeToClose: number
}
```

## 2. Port Interfaces

The domain service depends on five abstract ports, enabling full testability through mock injection:

| Port | Method | Purpose |
|------|--------|---------|
| `PQLDetectionReader` | `findByTenantIdForPeriod(tenantId, start, end)` | Load PQL detections for the reporting period |
| `CRMDealReader` | `findClosedDealsForPeriod(tenantId, start, end)` | Load closed deals from CRM |
| `TenantReader` | `findAllActive()`, `findById(id)` | Tenant lookup for batch processing and email |
| `DialogReader` | `findOperatorByDialogId(dialogId)`, `countByTenantForPeriod(...)` | Operator resolution and dialog counts |
| `ReportEmailSender` | `send({ to, subject, html })` | Email delivery abstraction |

## 3. API Specification

### 3.1 List Reports

```
GET /api/reports?limit=50&offset=0
Authorization: Bearer <JWT>

Response 200:
{
  "reports": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "period": { "year": 2026, "month": 1 },
      "status": "GENERATED",
      "attributions": [...],
      "summary": {...},
      "pdfUrl": null,
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

Note: `htmlContent` is stripped from list responses to reduce payload size.

### 3.2 Get Report

```
GET /api/reports/:id
Authorization: Bearer <JWT>

Response 200: { "report": { ...full report including htmlContent } }
Response 404: { "error": "Report not found" }
```

### 3.3 Generate Report

```
POST /api/reports/generate
Authorization: Bearer <JWT>
Body: { "period": "YYYY-MM" }  // optional, defaults to previous month

Response 201: { "report": { ...without htmlContent } }
Response 400: { "error": "Invalid request body", "details": {...} }
```

### 3.4 Download PDF

```
GET /api/reports/:id/pdf
Authorization: Bearer <JWT>

Response 200: application/pdf (Puppeteer available)
Response 200: text/html (Puppeteer fallback)
Response 404: { "error": "Report not found" }
```

## 4. Validation Rules

All API inputs are validated with Zod schemas:

| Schema | Field | Rule |
|--------|-------|------|
| `PaginationSchema` | limit | int, 1-100, default 50 |
| `PaginationSchema` | offset | int, min 0, default 0 |
| `GenerateSchema` | period | regex `/^\d{4}-\d{2}$/`, optional |

## 5. Business Rules

| Rule | Description |
|------|-------------|
| BR-01: Idempotent Generation | If a GENERATED or SENT report exists for tenant+period, return it without re-generation. DRAFT reports are re-generated. |
| BR-02: HOT/WARM Only | Only HOT and WARM tier PQL detections are eligible for revenue attribution. COLD is excluded. |
| BR-03: 90-Day Window | Attribution confidence drops to 0 if time-to-close exceeds 90 days. |
| BR-04: Round-Robin v1 | Detections are matched to deals in order (index-based). v2 will use contact email linkage. |
| BR-05: Error Isolation | Batch generation (generateMonthlyReports) catches errors per tenant and continues processing. |
| BR-06: Top 5 Operators | Summary includes at most 5 operators, sorted by totalRevenue descending. |
| BR-07: Email Guard | sendReport() rejects DRAFT reports and nonexistent reports with explicit error messages. |

## 6. Database Schema

```sql
-- Table: revenue.reports
CREATE TABLE revenue.reports (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES iam.tenants(id),
  period       VARCHAR(7) NOT NULL,          -- "YYYY-MM"
  status       VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  attributions JSONB NOT NULL DEFAULT '[]',
  summary      JSONB,
  pdf_url      TEXT,
  html_content TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policy (FF-03)
ALTER TABLE revenue.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON revenue.reports
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Storage strategy: attributions and summary are stored as JSONB for flexible schema evolution without migrations.
