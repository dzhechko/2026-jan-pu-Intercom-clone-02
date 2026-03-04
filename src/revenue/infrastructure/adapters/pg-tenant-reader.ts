/**
 * Tenant Reader for Revenue Reports — adapts tenant queries
 * to the TenantReader port interface needed by RevenueReportService.
 */
import { Pool } from 'pg'
import { TenantReader } from '@revenue/application/services/revenue-report-service'

export class PgTenantReader implements TenantReader {
  constructor(private readonly pool: Pool) {}

  async findAllActive(): Promise<Array<{ id: string; name: string; billingEmail: string }>> {
    const { rows } = await this.pool.query(
      `SELECT id, name, billing_email FROM iam.tenants WHERE status = 'ACTIVE'`,
    )
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      billingEmail: r.billing_email as string,
    }))
  }

  async findById(id: string): Promise<{ id: string; name: string; billingEmail: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name, billing_email FROM iam.tenants WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) return null
    return {
      id: rows[0].id as string,
      name: rows[0].name as string,
      billingEmail: rows[0].billing_email as string,
    }
  }
}
