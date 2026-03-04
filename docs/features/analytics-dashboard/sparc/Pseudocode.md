# FR-08: Basic Analytics Dashboard -- Pseudocode

## 1. AnalyticsService.getDashboardMetrics

This is the primary backend algorithm. It executes 8 independent SQL queries in parallel
and assembles the `DashboardMetrics` response.

```
FUNCTION getDashboardMetrics(tenantId: UUID, period: PeriodFilter = '30d') -> DashboardMetrics

  days = periodToDays(period)
  since = "NOW() - INTERVAL '{days} days'"

  // Execute all 8 queries in parallel
  [
    dialogCountResult,
    pqlCountResult,
    avgResponseResult,
    conversionResult,
    channelResult,
    tierResult,
    dailyResult,
    topOperatorsResult
  ] = AWAIT Promise.all([

    // Q1: Total dialogs in period
    QUERY "SELECT COUNT(*)::int AS total
           FROM conversations.dialogs
           WHERE tenant_id = $1 AND created_at >= {since}"
           PARAMS [tenantId]

    // Q2: Distinct PQL detections in period
    QUERY "SELECT COUNT(DISTINCT dialog_id)::int AS total
           FROM pql.detections
           WHERE tenant_id = $1 AND created_at >= {since}"
           PARAMS [tenantId]

    // Q3: Average response time (dialog creation to first OPERATOR message)
    QUERY "SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - d.created_at)) * 1000)::bigint
           FROM conversations.dialogs d
           INNER JOIN LATERAL (
             SELECT created_at FROM conversations.messages
             WHERE dialog_id = d.id AND sender_type = 'OPERATOR'
             ORDER BY created_at ASC LIMIT 1
           ) m ON true
           WHERE d.tenant_id = $1 AND d.created_at >= {since}"
           PARAMS [tenantId]

    // Q4: PQL conversion count (attributions closed in period)
    QUERY "SELECT COUNT(DISTINCT a.pql_detection_id)::int AS converted
           FROM revenue.attributions a
           INNER JOIN revenue.reports r ON a.report_id = r.id
           WHERE a.tenant_id = $1 AND a.closed_at >= {since}"
           PARAMS [tenantId]

    // Q5: Dialog count by channel
    QUERY "SELECT channel_type, COUNT(*)::int AS count
           FROM conversations.dialogs
           WHERE tenant_id = $1 AND created_at >= {since}
           GROUP BY channel_type"
           PARAMS [tenantId]

    // Q6: Dialog count by PQL tier
    QUERY "SELECT pql_tier, COUNT(*)::int AS count
           FROM conversations.dialogs
           WHERE tenant_id = $1 AND pql_tier IS NOT NULL AND created_at >= {since}
           GROUP BY pql_tier"
           PARAMS [tenantId]

    // Q7: Daily dialog counts (with zero-fill via generate_series)
    QUERY "SELECT d::date::text AS date, COUNT(dialogs.id)::int AS count
           FROM generate_series(
             (NOW() - INTERVAL '{days} days')::date, NOW()::date, '1 day'::interval
           ) d
           LEFT JOIN conversations.dialogs ON
             dialogs.tenant_id = $1 AND dialogs.created_at::date = d::date
           GROUP BY d::date ORDER BY d::date"
           PARAMS [tenantId]

    // Q8: Top operators by closed dialogs
    QUERY "SELECT d.operator_id, o.name,
                  COUNT(*)::int AS dialogs_closed,
                  COUNT(DISTINCT p.dialog_id)::int AS pql_converted
           FROM conversations.dialogs d
           INNER JOIN iam.operators o ON o.id = d.operator_id
           LEFT JOIN pql.detections p ON p.dialog_id = d.id
           WHERE d.tenant_id = $1 AND d.status = 'CLOSED'
             AND d.operator_id IS NOT NULL AND d.created_at >= {since}
           GROUP BY d.operator_id, o.name
           ORDER BY dialogs_closed DESC LIMIT 10"
           PARAMS [tenantId]
  ])

  // Extract scalar values with null-safe defaults
  totalDialogs     = dialogCountResult.rows[0]?.total ?? 0
  pqlDetectedCount = pqlCountResult.rows[0]?.total ?? 0
  avgResponseTimeMs = avgResponseResult.rows[0]?.avg_ms
                      ? Number(avgResponseResult.rows[0].avg_ms) : null
  pqlConverted     = conversionResult.rows[0]?.converted ?? 0

  // Calculate derived rates
  pqlRate = IF totalDialogs > 0 THEN (pqlDetectedCount / totalDialogs) * 100 ELSE 0
  pqlConversionRate = IF pqlDetectedCount > 0 THEN (pqlConverted / pqlDetectedCount) * 100 ELSE 0

  // Build channel map with defaults for known channels
  dialogsByChannel = { WEB_CHAT: 0, TELEGRAM: 0, VK_MAX: 0 }
  FOR row IN channelResult.rows:
    dialogsByChannel[row.channel_type] = row.count

  // Build tier map with defaults for known tiers
  pqlByTier = { HOT: 0, WARM: 0, COLD: 0 }
  FOR row IN tierResult.rows:
    pqlByTier[row.pql_tier] = row.count

  // Map daily and operators rows
  dailyDialogCounts = dailyResult.rows.map(row -> { date: row.date, count: row.count })
  topOperators = topOperatorsResult.rows.map(row -> {
    operatorId: row.operator_id,
    name: row.name,
    dialogsClosed: row.dialogs_closed,
    pqlConverted: row.pql_converted
  })

  RETURN {
    totalDialogs,
    pqlDetectedCount,
    pqlRate: ROUND(pqlRate, 2),
    avgResponseTimeMs,
    pqlConversionRate: ROUND(pqlConversionRate, 2),
    dialogsByChannel,
    pqlByTier,
    dailyDialogCounts,
    topOperators
  }
END FUNCTION
```

## 2. requireAdmin Middleware

```
FUNCTION requireAdmin(req, res, next)
  tenantReq = req AS TenantRequest
  IF tenantReq.role != 'ADMIN':
    RETURN res.status(403).json({ error: 'Admin access required' })
  next()
END FUNCTION
```

## 3. Frontend: DashboardPage Data Fetch

```
FUNCTION DashboardPage()
  STATE period = '30d'
  STATE metrics = null
  STATE loading = true
  STATE error = null

  FUNCTION fetchMetrics()
    SET loading = true, error = null

    token = localStorage.getItem('kommuniq_token')
    IF NOT token:
      SET error = 'Not authenticated', loading = false
      RETURN

    TRY
      response = AWAIT fetch("/api/proxy/analytics/dashboard?period={period}", {
        headers: { Authorization: "Bearer {token}" }
      })
      IF NOT response.ok:
        body = AWAIT response.json() CATCH {}
        THROW Error(body.error OR "HTTP {response.status}")
      data = AWAIT response.json()
      SET metrics = data
    CATCH err:
      SET error = err.message
    FINALLY:
      SET loading = false
  END FUNCTION

  // Re-fetch when period changes
  EFFECT [period] -> fetchMetrics()

  RENDER:
    - Period selector buttons (7d / 30d / 90d)
    - IF error: error banner with retry button
    - IF loading AND NOT metrics: loading spinner
    - IF metrics:
      - Grid of 4 MetricCards
      - Grid of ChannelBreakdown + PQLTierChart
      - Grid of DailyTrend + TopOperators
END FUNCTION
```

## 4. Frontend: formatResponseTime

```
FUNCTION formatResponseTime(ms: number | null) -> string
  IF ms IS null: RETURN '--'
  IF ms < 1000:  RETURN '{ms}ms'
  IF ms < 60000: RETURN '{(ms / 1000).toFixed(1)}s'
  minutes = FLOOR(ms / 60000)
  seconds = ROUND((ms % 60000) / 1000)
  RETURN '{minutes}m {seconds}s'
END FUNCTION
```

## 5. periodToDays Helper

```
FUNCTION periodToDays(period: PeriodFilter) -> number
  MATCH period:
    '7d'  -> RETURN 7
    '30d' -> RETURN 30
    '90d' -> RETURN 90
    _     -> RETURN 30   // fallback default
END FUNCTION
```

## 6. AdminLayout Auth Guard

```
FUNCTION AdminLayout({ children })
  STATE authorized = false
  STATE operatorName = ''

  EFFECT []:
    token = localStorage.getItem('kommuniq_token')
    operatorRaw = localStorage.getItem('kommuniq_operator')

    IF NOT token OR NOT operatorRaw:
      REDIRECT '/login'
      RETURN

    TRY
      operator = JSON.parse(operatorRaw)
      IF operator.role != 'ADMIN':
        REDIRECT '/'     // back to workspace
        RETURN
      SET operatorName = operator.name OR 'Admin'
    CATCH:
      REDIRECT '/login'
      RETURN

    // Verify token validity
    response = AWAIT fetch('/api/proxy/auth/me', { headers: { Authorization: "Bearer {token}" } })
    IF NOT response.ok:
      CLEAR localStorage
      REDIRECT '/login'
    ELSE:
      SET authorized = true
  END EFFECT

  IF NOT authorized:
    RENDER "Checking authorization..." spinner
  ELSE:
    RENDER header(nav, operatorName) + main(children)
END FUNCTION
```
