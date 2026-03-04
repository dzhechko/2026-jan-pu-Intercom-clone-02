/**
 * Analytics Service — FR-08 Basic Analytics Dashboard
 * Provides aggregated metrics for the admin dashboard.
 *
 * All queries run under RLS (FF-03) — tenant isolation is enforced at DB level.
 * Reference: docs/tactical-design.md — Revenue Bounded Context
 */
import { Pool } from 'pg'

// ─── Types ──────────────────────────────────────────────────────────────────

export type PeriodFilter = '7d' | '30d' | '90d'

export interface DashboardMetrics {
  totalDialogs: number
  pqlDetectedCount: number
  pqlRate: number
  avgResponseTimeMs: number | null
  pqlConversionRate: number
  dialogsByChannel: Record<string, number>
  pqlByTier: Record<string, number>
  dailyDialogCounts: Array<{ date: string; count: number }>
  topOperators: Array<{
    operatorId: string
    name: string
    dialogsClosed: number
    pqlConverted: number
  }>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function periodToDays(period: PeriodFilter): number {
  switch (period) {
    case '7d':
      return 7
    case '30d':
      return 30
    case '90d':
      return 90
    default:
      return 30
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export class AnalyticsService {
  constructor(private readonly pool: Pool) {}

  /**
   * Get all dashboard metrics for a tenant within a given period.
   */
  async getDashboardMetrics(
    tenantId: string,
    period: PeriodFilter = '30d',
  ): Promise<DashboardMetrics> {
    const days = periodToDays(period)
    const since = `NOW() - INTERVAL '${days} days'`

    // Execute all queries in parallel for performance
    const [
      dialogCountResult,
      pqlCountResult,
      avgResponseResult,
      conversionResult,
      channelResult,
      tierResult,
      dailyResult,
      topOperatorsResult,
    ] = await Promise.all([
      // Total dialogs in period
      this.pool.query(
        `SELECT COUNT(*)::int AS total
         FROM conversations.dialogs
         WHERE tenant_id = $1
           AND created_at >= ${since}`,
        [tenantId],
      ),

      // PQL detections in period
      this.pool.query(
        `SELECT COUNT(DISTINCT dialog_id)::int AS total
         FROM pql.detections
         WHERE tenant_id = $1
           AND created_at >= ${since}`,
        [tenantId],
      ),

      // Average response time: time from dialog creation to first OPERATOR message
      this.pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - d.created_at)) * 1000)::bigint AS avg_ms
         FROM conversations.dialogs d
         INNER JOIN LATERAL (
           SELECT created_at FROM conversations.messages
           WHERE dialog_id = d.id
             AND sender_type = 'OPERATOR'
           ORDER BY created_at ASC
           LIMIT 1
         ) m ON true
         WHERE d.tenant_id = $1
           AND d.created_at >= ${since}`,
        [tenantId],
      ),

      // PQL conversion: deals closed (attributions) / PQL detected
      this.pool.query(
        `SELECT COUNT(DISTINCT a.pql_detection_id)::int AS converted
         FROM revenue.attributions a
         INNER JOIN revenue.reports r ON a.report_id = r.id
         WHERE a.tenant_id = $1
           AND a.closed_at >= ${since}`,
        [tenantId],
      ),

      // Dialogs by channel
      this.pool.query(
        `SELECT channel_type, COUNT(*)::int AS count
         FROM conversations.dialogs
         WHERE tenant_id = $1
           AND created_at >= ${since}
         GROUP BY channel_type`,
        [tenantId],
      ),

      // PQL by tier
      this.pool.query(
        `SELECT pql_tier, COUNT(*)::int AS count
         FROM conversations.dialogs
         WHERE tenant_id = $1
           AND pql_tier IS NOT NULL
           AND created_at >= ${since}
         GROUP BY pql_tier`,
        [tenantId],
      ),

      // Daily dialog counts
      this.pool.query(
        `SELECT d::date::text AS date, COUNT(dialogs.id)::int AS count
         FROM generate_series(
           (NOW() - INTERVAL '${days} days')::date,
           NOW()::date,
           '1 day'::interval
         ) d
         LEFT JOIN conversations.dialogs ON
           dialogs.tenant_id = $1
           AND dialogs.created_at::date = d::date
         GROUP BY d::date
         ORDER BY d::date`,
        [tenantId],
      ),

      // Top operators by closed dialogs
      this.pool.query(
        `SELECT
           d.operator_id,
           o.name,
           COUNT(*)::int AS dialogs_closed,
           COUNT(DISTINCT p.dialog_id)::int AS pql_converted
         FROM conversations.dialogs d
         INNER JOIN iam.operators o ON o.id = d.operator_id
         LEFT JOIN pql.detections p ON p.dialog_id = d.id
         WHERE d.tenant_id = $1
           AND d.status = 'CLOSED'
           AND d.operator_id IS NOT NULL
           AND d.created_at >= ${since}
         GROUP BY d.operator_id, o.name
         ORDER BY dialogs_closed DESC
         LIMIT 10`,
        [tenantId],
      ),
    ])

    const totalDialogs = dialogCountResult.rows[0]?.total ?? 0
    const pqlDetectedCount = pqlCountResult.rows[0]?.total ?? 0
    const avgResponseTimeMs = avgResponseResult.rows[0]?.avg_ms
      ? Number(avgResponseResult.rows[0].avg_ms)
      : null
    const pqlConverted = conversionResult.rows[0]?.converted ?? 0

    const pqlRate = totalDialogs > 0 ? (pqlDetectedCount / totalDialogs) * 100 : 0
    const pqlConversionRate =
      pqlDetectedCount > 0 ? (pqlConverted / pqlDetectedCount) * 100 : 0

    // Build channel map with defaults
    const dialogsByChannel: Record<string, number> = {
      WEB_CHAT: 0,
      TELEGRAM: 0,
      VK_MAX: 0,
    }
    for (const row of channelResult.rows) {
      dialogsByChannel[row.channel_type as string] = row.count as number
    }

    // Build tier map with defaults
    const pqlByTier: Record<string, number> = {
      HOT: 0,
      WARM: 0,
      COLD: 0,
    }
    for (const row of tierResult.rows) {
      pqlByTier[row.pql_tier as string] = row.count as number
    }

    const dailyDialogCounts = dailyResult.rows.map((row) => ({
      date: row.date as string,
      count: row.count as number,
    }))

    const topOperators = topOperatorsResult.rows.map((row) => ({
      operatorId: row.operator_id as string,
      name: row.name as string,
      dialogsClosed: row.dialogs_closed as number,
      pqlConverted: row.pql_converted as number,
    }))

    return {
      totalDialogs,
      pqlDetectedCount,
      pqlRate: Math.round(pqlRate * 100) / 100,
      avgResponseTimeMs,
      pqlConversionRate: Math.round(pqlConversionRate * 100) / 100,
      dialogsByChannel,
      pqlByTier,
      dailyDialogCounts,
      topOperators,
    }
  }

  /**
   * Get dialog counts grouped by channel for a tenant.
   */
  async getDialogsByChannel(tenantId: string): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT channel_type, COUNT(*)::int AS count
       FROM conversations.dialogs
       WHERE tenant_id = $1
       GROUP BY channel_type`,
      [tenantId],
    )
    const result: Record<string, number> = { WEB_CHAT: 0, TELEGRAM: 0, VK_MAX: 0 }
    for (const row of rows) {
      result[row.channel_type as string] = row.count as number
    }
    return result
  }

  /**
   * Get PQL detections grouped by tier for a tenant.
   */
  async getPQLByTier(tenantId: string): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT pql_tier, COUNT(*)::int AS count
       FROM conversations.dialogs
       WHERE tenant_id = $1
         AND pql_tier IS NOT NULL
       GROUP BY pql_tier`,
      [tenantId],
    )
    const result: Record<string, number> = { HOT: 0, WARM: 0, COLD: 0 }
    for (const row of rows) {
      result[row.pql_tier as string] = row.count as number
    }
    return result
  }

  /**
   * Get daily dialog creation counts for a given number of days.
   */
  async getDailyTrend(
    tenantId: string,
    days = 30,
  ): Promise<Array<{ date: string; count: number }>> {
    const { rows } = await this.pool.query(
      `SELECT d::date::text AS date, COUNT(dialogs.id)::int AS count
       FROM generate_series(
         (NOW() - INTERVAL '${days} days')::date,
         NOW()::date,
         '1 day'::interval
       ) d
       LEFT JOIN conversations.dialogs ON
         dialogs.tenant_id = $1
         AND dialogs.created_at::date = d::date
       GROUP BY d::date
       ORDER BY d::date`,
      [tenantId],
    )
    return rows.map((row) => ({
      date: row.date as string,
      count: row.count as number,
    }))
  }
}
