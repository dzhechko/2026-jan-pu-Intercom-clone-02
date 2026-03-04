# FR-08: Basic Analytics Dashboard -- Specification

## 1. Data Model

The analytics dashboard does not introduce new database tables. It reads from existing tables across three schemas:

### Source Tables

| Schema | Table | Columns Used | Purpose |
|--------|-------|-------------|---------|
| `conversations` | `dialogs` | `id`, `tenant_id`, `created_at`, `status`, `operator_id`, `channel_type`, `pql_tier` | Dialog counts, channel breakdown, tier distribution, daily trend |
| `conversations` | `messages` | `dialog_id`, `created_at`, `sender_type` | Average response time (first OPERATOR message) |
| `pql` | `detections` | `dialog_id`, `tenant_id`, `created_at` | PQL detection count |
| `revenue` | `attributions` | `pql_detection_id`, `tenant_id`, `closed_at`, `report_id` | Conversion rate (PQL to closed deal) |
| `revenue` | `reports` | `id` | Join target for attributions |
| `iam` | `operators` | `id`, `name` | Operator name lookup |

### DashboardMetrics Response Shape

```typescript
interface DashboardMetrics {
  totalDialogs: number
  pqlDetectedCount: number
  pqlRate: number                    // percentage, rounded to 2 decimals
  avgResponseTimeMs: number | null   // null when no data
  pqlConversionRate: number          // percentage, rounded to 2 decimals
  dialogsByChannel: Record<string, number>  // keys: WEB_CHAT, TELEGRAM, VK_MAX
  pqlByTier: Record<string, number>         // keys: HOT, WARM, COLD
  dailyDialogCounts: Array<{ date: string; count: number }>
  topOperators: Array<{
    operatorId: string
    name: string
    dialogsClosed: number
    pqlConverted: number
  }>
}
```

## 2. Period Filtering

| Parameter | Type | Values | Default | Validation |
|-----------|------|--------|---------|------------|
| `period` | enum | `7d`, `30d`, `90d` | `30d` | Zod `z.enum(['7d', '30d', '90d'])` |
| `days` | integer | 1--365 | 30 | Zod `z.coerce.number().int().min(1).max(365)` |

Period maps to SQL interval via `periodToDays()`:
- `7d` -> 7 days
- `30d` -> 30 days
- `90d` -> 90 days

## 3. Metric Definitions

### 3.1 Total Dialogs
- **Query:** `COUNT(*)` from `conversations.dialogs` where `created_at >= NOW() - INTERVAL '{days} days'`
- **Scope:** Tenant-filtered via `tenant_id = $1`

### 3.2 PQL Detected Count
- **Query:** `COUNT(DISTINCT dialog_id)` from `pql.detections` within period
- **Note:** Uses DISTINCT to avoid counting multiple detections per dialog

### 3.3 PQL Rate
- **Formula:** `(pqlDetectedCount / totalDialogs) * 100`
- **Edge case:** Returns 0 when totalDialogs is 0
- **Precision:** Rounded to 2 decimal places via `Math.round(rate * 100) / 100`

### 3.4 Average Response Time
- **Query:** LATERAL join from `dialogs` to first `OPERATOR` message in `messages`
- **Formula:** `AVG(EXTRACT(EPOCH FROM (message.created_at - dialog.created_at)) * 1000)`
- **Unit:** Milliseconds
- **Edge case:** Returns `null` when no operator messages exist
- **Frontend formatting:** `< 1s` -> ms, `< 1m` -> seconds, `>= 1m` -> `Xm Ys`

### 3.5 PQL Conversion Rate
- **Query:** `COUNT(DISTINCT pql_detection_id)` from `revenue.attributions` joined with `revenue.reports` within period
- **Formula:** `(converted / pqlDetectedCount) * 100`
- **Edge case:** Returns 0 when pqlDetectedCount is 0

### 3.6 Dialogs by Channel
- **Query:** `GROUP BY channel_type` with `COUNT(*)`
- **Default keys:** `WEB_CHAT`, `TELEGRAM`, `VK_MAX` -- all default to 0 if no rows

### 3.7 PQL by Tier
- **Query:** `GROUP BY pql_tier` from dialogs where `pql_tier IS NOT NULL`
- **Default keys:** `HOT`, `WARM`, `COLD` -- all default to 0 if no rows

### 3.8 Daily Dialog Counts
- **Query:** `generate_series` from period start to today, LEFT JOIN with dialogs on date
- **Behavior:** Always returns a row per day even if count is 0

### 3.9 Top Operators
- **Query:** Dialogs with status `CLOSED` joined with operators and PQL detections
- **Limit:** Top 10 by `dialogs_closed DESC`
- **Fields:** operatorId, name, dialogsClosed, pqlConverted

## 4. Authorization Specification

### Backend (analytics-routes.ts)
- Middleware: `requireAdmin` checks `(req as TenantRequest).role !== 'ADMIN'`
- Response: HTTP 403 `{ error: 'Admin access required' }` for non-admin operators

### Frontend (layout.tsx)
- Reads `kommuniq_operator` from localStorage
- Parses JSON and checks `operator.role !== 'ADMIN'`
- Redirects non-admins to `/` (workspace)
- Validates token via `GET /api/proxy/auth/me`
- Shows "Checking authorization..." spinner during verification

## 5. REST API Specification

### GET /api/analytics/dashboard

**Query Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| period | string | No | `30d` | One of: `7d`, `30d`, `90d` |

**Response 200:** `DashboardMetrics` object (see section 2)

**Response 400:** `{ error: 'Invalid query params', details: ZodFlattenedError }`

**Response 403:** `{ error: 'Admin access required' }`

**Response 500:** `{ error: 'Internal server error' }`

### GET /api/analytics/dialogs-by-channel

**Response 200:** `Record<string, number>` with keys `WEB_CHAT`, `TELEGRAM`, `VK_MAX`

### GET /api/analytics/pql-by-tier

**Response 200:** `Record<string, number>` with keys `HOT`, `WARM`, `COLD`

### GET /api/analytics/daily-trend

**Query Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| days | integer | No | `30` | 1--365 |

**Response 200:** `{ dailyTrend: Array<{ date: string; count: number }> }`

## 6. Frontend Component Specification

| Component | Props | Behavior |
|-----------|-------|----------|
| `MetricCard` | label, value, subtitle?, colorClass? | Static KPI card with optional color |
| `ChannelBreakdown` | data: Record<string, number> | Horizontal bars sorted by count desc; "No data" if total is 0 |
| `PQLTierChart` | data: Record<string, number> | Fixed order HOT/WARM/COLD; color-coded bars; "No PQL detections" if total is 0 |
| `DailyTrend` | data: Array<{date, count}> | Vertical bar chart + scrollable table of last 10 days; "No data" if empty |
| `TopOperators` | data: Array<{operatorId, name, dialogsClosed, pqlConverted}> | Ranked table; green badge for pqlConverted; "No operator data" if empty |
| `DashboardPage` | (none) | Orchestrates all components; period selector; loading/error/retry states |
