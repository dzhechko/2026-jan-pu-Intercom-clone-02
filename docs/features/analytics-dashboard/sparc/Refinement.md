# FR-08: Basic Analytics Dashboard -- Refinement

## 1. Edge Cases

### EC-01: Zero Dialogs in Period
**Scenario:** Tenant has no dialogs in the selected time window.
**Current behavior:** `totalDialogs = 0`, `pqlRate = 0`, `pqlConversionRate = 0`, `avgResponseTimeMs = null`. Channel and tier maps default to all zeros. Daily trend returns empty array. Top operators returns empty array.
**Risk:** LOW -- frontend handles all empty states with fallback messages.
**Test coverage:** "should handle empty data gracefully" test case.

### EC-02: PQL Detections Exist But No Dialogs
**Scenario:** Orphaned PQL detection records (e.g., dialog deleted after detection).
**Current behavior:** `pqlDetectedCount > 0` but `totalDialogs = 0` would produce `pqlRate = Infinity`.
**Mitigation:** Guard `totalDialogs > 0` before division. Returns 0 when totalDialogs is 0.
**Risk:** LOW -- guarded in code.

### EC-03: Multiple PQL Detections Per Dialog
**Scenario:** A dialog triggers PQL detection multiple times (e.g., score updated).
**Current behavior:** `COUNT(DISTINCT dialog_id)` ensures each dialog counted once.
**Risk:** LOW -- handled at query level.

### EC-04: Fractional PQL Rate
**Scenario:** 3 PQL detections out of 7 dialogs = 42.857142...%
**Current behavior:** Rounded to 2 decimal places via `Math.round(rate * 100) / 100`.
**Test coverage:** "should calculate PQL rate correctly with fractional values" verifies 42.86.

### EC-05: No Operator Messages (avgResponseTimeMs)
**Scenario:** All dialogs in period have only CLIENT messages (no operator replies yet).
**Current behavior:** LATERAL join produces no rows, AVG returns NULL, service returns `null`.
**Frontend display:** Shows "--" via `formatResponseTime(null)`.
**Risk:** LOW -- null handling explicit at both layers.

### EC-06: Missing Channel Types
**Scenario:** Only WEB_CHAT dialogs exist; TELEGRAM and VK_MAX have no rows in GROUP BY.
**Current behavior:** Default map `{ WEB_CHAT: 0, TELEGRAM: 0, VK_MAX: 0 }` is populated first; actual values overwrite.
**Test coverage:** "should default channel counts to zero for missing channels" test case.

### EC-07: Unknown Channel Type in Database
**Scenario:** A new channel type (e.g., `WHATSAPP`) added to dialogs but not in default map.
**Current behavior:** New channel appears in response with its count. Frontend `ChannelBreakdown` uses `CHANNEL_LABELS[channel] ?? channel` fallback.
**Risk:** LOW -- graceful degradation with raw channel name and default gray color bar.

### EC-08: Large Number of Daily Data Points (90d)
**Scenario:** 90-day period produces 91 bars in the DailyTrend chart.
**Current behavior:** Bars are `flex-1` width, so they compress proportionally. Only first, middle, and last date labels shown.
**Risk:** MEDIUM -- bars may be very narrow on mobile. Acceptable for v1.

### EC-09: Non-Admin Attempts API Access
**Scenario:** Operator with role != ADMIN calls `/api/analytics/dashboard`.
**Current behavior:** `requireAdmin` middleware returns HTTP 403 before any query executes.
**Frontend guard:** Layout checks role from localStorage and redirects to `/`.
**Risk:** LOW -- double enforcement at both layers.

### EC-10: Expired or Invalid JWT Token
**Scenario:** Token expires while admin is viewing the dashboard.
**Current behavior:** Layout verifies token on mount via `/api/proxy/auth/me`. If 401, clears localStorage and redirects to `/login`. Dashboard fetch would also fail with error banner + retry button.
**Risk:** LOW -- handled at layout level.

## 2. Performance Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Slow queries on large dialog tables | MEDIUM | Dashboard load > 2s | Queries run in parallel (8x via Promise.all); indexed columns used |
| LATERAL subquery for response time | LOW | Slowest of the 8 queries | LIMIT 1 in subquery; indexed on dialog_id + sender_type |
| generate_series with LEFT JOIN | LOW | Large date range | Bounded by period (max 90 days); grouped by date |
| Concurrent admin requests | LOW | Pool saturation | Single pool with connection limit; admin-only access limits user count |

## 3. Security Considerations

| Concern | Status | Implementation |
|---------|--------|----------------|
| Tenant data leakage | MITIGATED | RLS + parameterized tenant_id in all queries |
| SQL injection via period | MITIGATED | Period validated by Zod enum; days validated as integer 1-365 |
| SQL interpolation of days | NOTED | `NOW() - INTERVAL '${days} days'` uses string interpolation. Safe because `days` is derived from validated enum (7/30/90) via `periodToDays()`. Not a parameterized binding. |
| Non-admin access | MITIGATED | Double enforcement: backend middleware + frontend layout guard |
| Token theft | STANDARD | JWT in localStorage (standard SPA pattern); verified on layout mount |

## 4. Technical Debt

| Item | Priority | Description |
|------|----------|-------------|
| SQL interpolation for interval | LOW | `periodToDays` output is safe but could use parameterized interval for defense-in-depth |
| No caching | MEDIUM | Dashboard queries hit DB on every load. Could add Redis cache with short TTL (30s-60s) for high-traffic tenants |
| No pagination for daily trend | LOW | 90-day generates 91 rows, acceptable. Beyond 365d would need pagination |
| No WebSocket refresh | LOW | Dashboard does not auto-refresh. Manual period switch triggers re-fetch. Future: push metrics via Socket.io |
| CSS-only charts | LOW | Adequate for v1. Consider Recharts or similar for v2 with tooltips, animations, zoom |
| Test coverage: routes | MEDIUM | analytics-routes.ts has no unit tests (tested indirectly via integration). Should add supertest tests |
| Test coverage: frontend | MEDIUM | No React component tests. Should add React Testing Library tests for DashboardPage |

## 5. Operational Monitoring

| Metric | Monitoring |
|--------|-----------|
| Dashboard API latency | Express error handler logs to console; could add Prometheus histogram |
| Query failure rate | Catch block in each route handler logs errors |
| Admin access attempts | `requireAdmin` 403 responses should be logged (currently silent rejection) |

## 6. Future Enhancements (Out of Scope for v1)

1. **Real-time updates:** WebSocket push for live metric changes
2. **Comparison periods:** "vs previous period" delta indicators
3. **Export to CSV/PDF:** Download dashboard data
4. **Custom date ranges:** Arbitrary date picker instead of preset periods
5. **Drill-down:** Click on a metric to see underlying dialogs
6. **Alerting:** Notify admin when PQL rate drops below threshold
7. **Caching layer:** Redis cache with invalidation on new dialog/detection events
