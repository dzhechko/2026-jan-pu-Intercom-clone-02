/**
 * PQL Detection Reader for Revenue Reports — adapts PgPQLDetectionRepository
 * to the PQLDetectionReader port interface needed by RevenueReportService.
 *
 * Adds period-filtered query not available in the base repository.
 */
import { Pool } from 'pg'
import {
  PQLDetectionReader,
  PQLDetectionForReport,
} from '@revenue/application/services/revenue-report-service'

export class PgPQLDetectionReader implements PQLDetectionReader {
  constructor(private readonly pool: Pool) {}

  async findByTenantIdForPeriod(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<PQLDetectionForReport[]> {
    const { rows } = await this.pool.query(
      `SELECT id, dialog_id, score, tier, created_at
       FROM pql.detections
       WHERE tenant_id = $1
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at DESC`,
      [tenantId, start, end],
    )
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      dialogId: row.dialog_id as string,
      score: Number(row.score),
      tier: row.tier as 'HOT' | 'WARM' | 'COLD',
      createdAt: new Date(row.created_at as string),
    }))
  }
}
