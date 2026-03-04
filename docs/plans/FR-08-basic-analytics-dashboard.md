# FR-08: Basic Analytics Dashboard
**Status:** Done | **BC:** BC-03 Revenue (backend), Frontend (admin UI) | **Priority:** SHOULD

## Summary
Admin-only analytics dashboard providing real-time operational metrics including total dialogs, PQL rate, average response time, PQL conversion rate, channel distribution, tier breakdown, daily trend chart, and top operator leaderboard. Backend runs 8 parallel SQL queries under RLS; frontend renders responsive cards and charts with period filtering.

## User Stories
- US-01: As an admin, I want to see total dialog count and PQL detection rate so that I can monitor support volume and PQL efficiency
- US-02: As an admin, I want to filter metrics by time period (7d/30d/90d) so that I can analyze trends at different scales
- US-03: As an admin, I want to see dialog distribution by channel so that I can understand where conversations originate
- US-04: As an admin, I want to see PQL distribution by tier (HOT/WARM/COLD) so that I can assess detection quality
- US-05: As an admin, I want to see a daily dialog trend chart so that I can identify volume patterns
- US-06: As an admin, I want to see top operators by closed dialogs and PQL conversions so that I can evaluate team performance

## Technical Design

### Files Created
- `src/revenue/application/services/analytics-service.ts` -- AnalyticsService with 4 methods: getDashboardMetrics (8 parallel queries), getDialogsByChannel, getPQLByTier, getDailyTrend
- `src/revenue/application/services/analytics-service.test.ts` -- Unit tests with mock Pool
- `src/revenue/infrastructure/analytics-routes.ts` -- REST API routes with ADMIN role guard and zod validation
- `app/(admin)/dashboard/page.tsx` -- Main dashboard page with period selector, loading/error states, and responsive grid layout
- `app/(admin)/layout.tsx` -- Admin layout with auth check, ADMIN role enforcement, navigation header, and "Back to Workspace" link
- `app/(admin)/components/MetricCard.tsx` -- Reusable KPI card component with label, value, subtitle, and optional color class
- `app/(admin)/components/ChannelBreakdown.tsx` -- Horizontal bar chart showing dialog distribution by channel (WEB_CHAT, TELEGRAM, VK_MAX)
- `app/(admin)/components/PQLTierChart.tsx` -- Horizontal bar chart showing PQL distribution by tier with color-coded bars
- `app/(admin)/components/DailyTrend.tsx` -- Vertical bar chart with date labels and scrollable recent-days table
- `app/(admin)/components/TopOperators.tsx` -- Sortable table showing operator name, closed dialogs, and PQL conversions

### Key Decisions
- **8 parallel SQL queries:** All dashboard metrics are fetched via `Promise.all()` for optimal performance rather than sequential queries
- **Period interpolation in SQL:** `NOW() - INTERVAL '${days} days'` is used directly in SQL (safe because period is validated to enum values '7d'/'30d'/'90d')
- **ADMIN-only access:** Both backend (requireAdmin middleware) and frontend (role check in layout) enforce admin-only access
- **Default channel/tier counts:** Missing channels or tiers default to 0 in the response to ensure consistent frontend rendering
- **CSS-only charts:** Bar charts are implemented with pure Tailwind CSS rather than a charting library, keeping the bundle size minimal
- **Proxy pattern:** Frontend fetches via `/api/proxy/analytics/dashboard` for Next.js API route proxying to Express backend

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/analytics/dashboard?period=7d\|30d\|90d | All-in-one dashboard metrics (admin only) |
| GET | /api/analytics/dialogs-by-channel | Channel distribution, all time (admin only) |
| GET | /api/analytics/pql-by-tier | PQL tier distribution, all time (admin only) |
| GET | /api/analytics/daily-trend?days=30 | Daily dialog creation trend (admin only) |

## Dependencies
- Depends on: FR-01 (IAM/JWT for ADMIN role), FR-03 (PQL detections data), FR-07 (dialog data), FR-06 (attribution data)
- Blocks: None (leaf feature)

## Tests
- `src/revenue/application/services/analytics-service.test.ts` -- 8 tests covering:
  - Correct metrics calculation with populated data (all 8 query results)
  - Empty data graceful handling (zeros and nulls)
  - PQL rate calculation with fractional values (rounding to 2 decimals)
  - Period interval passed correctly to SQL queries
  - Default channel counts for missing channels
  - Channel distribution standalone query
  - PQL tier distribution standalone query
  - Daily trend with correct day interval

## Acceptance Criteria
- [x] Dashboard shows 4 KPI cards: Total Dialogs, PQL Rate, Avg Response Time, PQL Conversion
- [x] Period filter supports 7-day, 30-day, and 90-day windows
- [x] Channel breakdown shows WEB_CHAT, TELEGRAM, VK_MAX with percentage bars
- [x] PQL tier chart shows HOT, WARM, COLD with color-coded bars
- [x] Daily trend displays bar chart with date labels
- [x] Top operators table shows name, closed dialogs, and PQL conversions
- [x] Only ADMIN role can access the dashboard (403 for non-admins)
- [x] All queries run under RLS for tenant isolation (FF-03)
- [x] Empty states handled gracefully with fallback messages
- [x] Frontend handles loading, error, and retry states
