# FR-08: Basic Analytics Dashboard -- Architecture

## 1. System Context

FR-08 adds a read-only analytics layer to the existing KommuniQ platform. It sits in the BC-03 Revenue bounded context on the backend and introduces a new `(admin)` route group in the Next.js frontend.

```
                     +---------------------------+
                     |      Browser (Admin)      |
                     |  app/(admin)/dashboard/   |
                     +-------------|-------------+
                                   | fetch (Bearer JWT)
                                   v
                     +---------------------------+
                     |    Next.js API Proxy      |
                     |  /api/proxy/analytics/*   |
                     +-------------|-------------+
                                   | HTTP
                                   v
                     +---------------------------+
                     |  Express API Server :4000 |
                     |  /api/analytics/*         |
                     |  [requireAdmin middleware] |
                     +-------------|-------------+
                                   | pg Pool
                                   v
                     +---------------------------+
                     |   PostgreSQL 16 (RLS)     |
                     |  conversations / pql /    |
                     |  revenue / iam schemas    |
                     +---------------------------+
```

## 2. Backend Architecture

### Layer Structure (within BC-03 Revenue)

| Layer | File | Responsibility |
|-------|------|----------------|
| Application | `analytics-service.ts` | Metric aggregation, parallel query orchestration, data transformation |
| Infrastructure | `analytics-routes.ts` | HTTP routing, Zod input validation, ADMIN role enforcement, error handling |

### AnalyticsService Class

```
AnalyticsService
  constructor(pool: Pool)
  +getDashboardMetrics(tenantId, period): Promise<DashboardMetrics>
  +getDialogsByChannel(tenantId): Promise<Record<string, number>>
  +getPQLByTier(tenantId): Promise<Record<string, number>>
  +getDailyTrend(tenantId, days): Promise<Array<{date, count}>>
```

- Constructor injection of `pg.Pool` (dependency inversion)
- `getDashboardMetrics` is the primary method, executing 8 SQL queries via `Promise.all`
- The three standalone methods (`getDialogsByChannel`, `getPQLByTier`, `getDailyTrend`) provide granular endpoints for future use

### Query Parallelization Strategy

The `getDashboardMetrics` method executes 8 independent SQL queries simultaneously:

```
Promise.all([
  1. COUNT(*) dialogs           -- totalDialogs
  2. COUNT(DISTINCT) detections -- pqlDetectedCount
  3. AVG(LATERAL) messages      -- avgResponseTimeMs
  4. COUNT(DISTINCT) attributions -- conversion
  5. GROUP BY channel_type      -- dialogsByChannel
  6. GROUP BY pql_tier          -- pqlByTier
  7. generate_series + LEFT JOIN -- dailyDialogCounts
  8. GROUP BY operator + JOIN   -- topOperators
])
```

This design ensures the dashboard API responds in the time of the slowest single query rather than the sum of all queries.

### Route Architecture

```
Router(/api/analytics)
  |-- [requireAdmin]  -- applied to all routes
  |
  +-- GET /dashboard         -> getDashboard handler
  |     uses: PeriodSchema (zod)
  |
  +-- GET /dialogs-by-channel -> getDialogsByChannel handler
  |
  +-- GET /pql-by-tier        -> getPQLByTier handler
  |
  +-- GET /daily-trend        -> getDailyTrend handler
        uses: DaysSchema (zod)
```

### Security Architecture

1. **Authentication:** Bearer JWT extracted by upstream tenant middleware (`TenantRequest`)
2. **Authorization:** `requireAdmin` middleware checks `TenantRequest.role === 'ADMIN'`
3. **Tenant isolation:** All queries use `WHERE tenant_id = $1` with parameterized binding; PostgreSQL RLS provides defense-in-depth
4. **Input validation:** Zod schemas reject invalid period/days values before queries execute
5. **Error handling:** All handlers catch exceptions, log to console, return generic 500

## 3. Frontend Architecture

### Route Group: `(admin)`

The Next.js App Router route group `(admin)` provides:
- Shared layout with auth check and ADMIN role enforcement
- Admin navigation header with "Back to Workspace" link
- No URL prefix (dashboard is at `/dashboard`)

### Component Tree

```
AdminLayout (auth guard)
  +-- DashboardPage (data fetching, period state)
       +-- MetricCard x 4 (Total Dialogs, PQL Rate, Avg Response, Conversion)
       +-- ChannelBreakdown (horizontal bar chart)
       +-- PQLTierChart (horizontal bar chart, color-coded)
       +-- DailyTrend (vertical bar chart + table)
       +-- TopOperators (ranked table)
```

### Data Flow

```
1. AdminLayout mounts
   -> Check localStorage for token + operator
   -> Verify ADMIN role (redirect if not)
   -> Verify token via /api/proxy/auth/me

2. DashboardPage mounts
   -> useState: period='30d', metrics=null, loading=true, error=null
   -> useEffect triggers fetchMetrics()
   -> GET /api/proxy/analytics/dashboard?period=30d
   -> On success: setMetrics(data), setLoading(false)
   -> On error: setError(message), setLoading(false)

3. Period change
   -> setPeriod(newPeriod)
   -> useCallback re-creates fetchMetrics
   -> useEffect triggers re-fetch
```

### State Management

Client-side only -- no global state management library needed:
- `period`: controlled by button group, triggers re-fetch
- `metrics`: response from API, passed to child components as props
- `loading`/`error`: UI state for loading spinner and error banner

## 4. Cross-Schema Query Pattern

The analytics service reads from 4 database schemas but only resides in BC-03 Revenue. This is acceptable because:

1. **Read-only access** -- no writes to other BC schemas
2. **RLS enforcement** -- all queries are tenant-scoped at the DB level
3. **No domain logic imported** -- raw SQL queries, no imports from other BC code
4. **Analytics is inherently cross-cutting** -- it aggregates data from multiple sources

This pattern aligns with ADR-002 (bounded context isolation at code level, not SQL level).

## 5. Deployment Architecture

No new services or containers. The analytics feature deploys as part of:
- **Express API server** -- analytics routes registered at `/api/analytics`
- **Next.js app** -- admin pages compiled as part of the existing Next.js build
- **PostgreSQL** -- no schema migration needed (uses existing tables)

## 6. Performance Considerations

| Concern | Mitigation |
|---------|------------|
| 8 queries per dashboard load | `Promise.all` parallelization |
| Large dialog tables | Indexed on `tenant_id`, `created_at`, `channel_type` |
| generate_series for daily trend | LEFT JOIN prevents full table scan; bounded by period |
| LATERAL subquery for response time | Limited to first OPERATOR message per dialog |
| Frontend re-renders on period change | `useCallback` memoizes fetch function; components are pure |
