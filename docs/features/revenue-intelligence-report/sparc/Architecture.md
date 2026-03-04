# FR-06: Revenue Intelligence Report -- Architecture

**Feature ID:** FR-06
**Bounded Context:** BC-03 Revenue

---

## 1. Component Diagram (C4 Level 3)

```
                        +--------------------+
                        |   REST API Layer   |
                        | (revenue-routes.ts)|
                        +--------+-----------+
                                 |
                    +------------v-------------+
                    |  RevenueReportService     |
                    |  (Application Service)    |
                    +--+---+---+---+---+---+---+
                       |   |   |   |   |   |
          +------------+   |   |   |   |   +------------+
          |                |   |   |   |                |
+---------v---+  +---------v-+ | +-v---------+  +-------v--------+
| PQLDetection|  | CRMDeal   | | | Dialog    |  | ReportEmail    |
| Reader      |  | Reader    | | | Reader    |  | Sender         |
| (port)      |  | (port)    | | | (port)    |  | (port)         |
+------+------+  +-----+-----+ | +-----+-----+  +-------+--------+
       |                |       |       |                 |
+------v------+  +------v-----+|+------v------+  +-------v--------+
| PgPQL       |  | MockCRM    ||| PgDialog    |  | StubEmail      |
| Detection   |  | DealReader ||| Reader      |  | Service        |
| Reader      |  +------------+|| +------------+  +----------------+
+-------------+                ||
                        +------v------+
                        | TenantReader|
                        | (port)      |
                        +------+------+
                               |
                        +------v------+
                        | PgTenant    |
                        | Reader      |
                        +-------------+

          +------------------+          +---------------------+
          | RevenueReport    |          | ReportHtmlGenerator |
          | Repository       |          | (infrastructure)    |
          | (PgRevenue...    |          +---------------------+
          | ReportRepository)|
          +------------------+
```

## 2. Layer Architecture

Following the Hexagonal (Ports & Adapters) pattern mandated by the project architecture:

### Domain Layer (`src/revenue/domain/`)

| File | Type | Responsibility |
|------|------|---------------|
| `aggregates/revenue-report.ts` | Aggregate Root | RevenueReport lifecycle (DRAFT->GENERATED->SENT), period parsing, date range calculation |
| `value-objects/pql-attribution.ts` | Value Object | Attribution data, timeToClose calculation, confidence scoring |
| `value-objects/revenue-summary.ts` | Value Object | Summary aggregation, operator performance, conversion rate |

**Key constraint:** Domain layer has zero infrastructure dependencies. All external data access is through port interfaces.

### Application Layer (`src/revenue/application/services/`)

| File | Type | Responsibility |
|------|------|---------------|
| `revenue-report-service.ts` | Application Service | Orchestrates the 11-step report generation pipeline. Defines all port interfaces. |
| `auto-attribution-service.ts` | Application Service | Handles DealClosedEvent from amoCRM webhook, creates attribution records |
| `analytics-service.ts` | Application Service | Dashboard metrics aggregation via parallel SQL queries |

### Infrastructure Layer (`src/revenue/infrastructure/`)

| File | Type | Responsibility |
|------|------|---------------|
| `repositories/revenue-report-repository.ts` | Repository | JSONB-based storage for reports with period lookups |
| `repositories/attribution-repository.ts` | Repository | Attribution CRUD with deal/detection-based lookups |
| `adapters/pg-pql-detection-reader.ts` | Adapter | Reads PQL detections from pql.detections table |
| `adapters/pg-dialog-reader.ts` | Adapter | Reads operator and dialog count data |
| `adapters/pg-tenant-reader.ts` | Adapter | Reads tenant data from iam.tenants |
| `adapters/mock-crm-deal-reader.ts` | Adapter | Mock CRM data (to be replaced by AmoCRM MCP adapter) |
| `report-html-generator.ts` | Generator | Self-contained HTML template with inline styles |
| `revenue-routes.ts` | REST Routes | Express router with Zod validation |
| `attribution-routes.ts` | REST Routes | Manual attribution management endpoints |
| `analytics-routes.ts` | REST Routes | Dashboard metric endpoints with ADMIN role guard |

## 3. Data Flow: Report Generation Pipeline

```
POST /api/reports/generate
  |
  v
RevenueReportService.generateReportForTenant(tenantId, period)
  |
  |-- 1. Check existing report (idempotency)
  |      reportRepo.findByPeriod(tenantId, period)
  |      IF status != DRAFT -> return existing
  |
  |-- 2. Calculate date range
  |      getPeriodDateRange(period) -> { start, end }
  |
  |-- 3. Collect PQL detections
  |      pqlReader.findByTenantIdForPeriod(tenantId, start, end)
  |
  |-- 4. Get closed CRM deals
  |      crmReader.findClosedDealsForPeriod(tenantId, start, end)
  |
  |-- 5. Count total dialogs
  |      dialogReader.countByTenantForPeriod(tenantId, start, end)
  |
  |-- 6. Build attributions (HOT/WARM only, round-robin match)
  |      For each min(qualifiedDetections, wonDeals):
  |        dialogReader.findOperatorByDialogId(dialogId)
  |        calculateTimeToClose(detectedAt, closedAt)
  |        calculateAttributionConfidence(timeToClose, pqlScore)
  |
  |-- 7. Calculate summary
  |      buildRevenueSummary({ totalDialogs, pqlDetected, ... })
  |      Group attributions by operator -> topOperators (top 5)
  |
  |-- 8. Create or reuse DRAFT report
  |
  |-- 9. Generate HTML
  |      generateReportHtml({ tenantName, period, summary, attributions })
  |
  |-- 10. Mark GENERATED
  |       markReportGenerated(report, summary, attributions, html, null)
  |
  |-- 11. Persist
        reportRepo.save() or reportRepo.update()
```

## 4. Data Flow: Batch Monthly Generation

```
generateMonthlyReports()
  |
  |-- Calculate previous month period
  |-- tenantReader.findAllActive()
  |
  |-- FOR EACH tenant (sequential, error-isolated):
  |     TRY:
  |       generateReportForTenant(tenant.id, period)
  |       generated++
  |     CATCH:
  |       errors.push(tenant.id + error.message)
  |       CONTINUE (do not stop)
  |
  |-- RETURN { generated, errors }
```

## 5. Cross-BC Communication

| From BC | To BC | Mechanism | Data |
|---------|-------|-----------|------|
| BC-03 Revenue | BC-02 PQL | Read-only SQL | pql.detections (PQL detection records) |
| BC-03 Revenue | BC-01 Conversation | Read-only SQL | conversation.dialogs (operator, count) |
| BC-03 Revenue | BC-05 IAM | Read-only SQL | iam.tenants (name, billing email) |
| BC-04 Integration | BC-03 Revenue | DealClosedEvent | amoCRM webhook triggers auto-attribution |
| BC-03 Revenue | BC-06 Notifications | Port interface | ReportEmailSender for email delivery |

**Important:** All cross-BC reads go through dedicated adapter classes (PgPQLDetectionReader, PgDialogReader, PgTenantReader), not direct imports from other BCs. This satisfies FF-02 (no cross-BC imports).

## 6. Security & Compliance

| Requirement | Implementation |
|-------------|---------------|
| FF-03 Tenant RLS | All DB queries run under RLS via `SET app.tenant_id` middleware |
| FF-10 Data Residency | All data stored on Russian VPS; no foreign API calls for report data |
| SH-02 PII Protection | Reports contain deal IDs and operator IDs, not raw PII |
| ADMIN role guard | Analytics routes require `role === 'ADMIN'` middleware check |

## 7. Fitness Function Compliance

| FF | Status | Evidence |
|----|--------|----------|
| FF-01 PQL < 2000ms | N/A | Report generation is asynchronous, not on PQL hot path |
| FF-02 No cross-BC imports | PASS | All adapters use SQL queries, no TypeScript imports from other BCs |
| FF-03 Tenant RLS | PASS | RLS enabled on revenue.reports; all queries parameterized by tenant_id |
| FF-04 Circuit Breaker | PASS (v2) | MockCRMDealReader used in v1; real MCP adapter will have opossum |
| FF-05 RuleEngine >= 95% | N/A | Not applicable to revenue BC |
