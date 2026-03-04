/**
 * Dialog Reader for Revenue Reports — adapts dialog queries
 * to the DialogReader port interface needed by RevenueReportService.
 */
import { Pool } from 'pg'
import { DialogReader } from '@revenue/application/services/revenue-report-service'

export class PgDialogReader implements DialogReader {
  constructor(private readonly pool: Pool) {}

  async findOperatorByDialogId(dialogId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT operator_id FROM conversation.dialogs WHERE id = $1`,
      [dialogId],
    )
    return rows[0]?.operator_id ?? null
  }

  async countByTenantForPeriod(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count
       FROM conversation.dialogs
       WHERE tenant_id = $1
         AND created_at >= $2
         AND created_at < $3`,
      [tenantId, start, end],
    )
    return rows[0]?.count ?? 0
  }
}
