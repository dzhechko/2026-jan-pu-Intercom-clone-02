/**
 * Revenue Report Repository — PostgreSQL implementation.
 * Reference: docs/pseudocode.md PS-05
 *
 * Stores revenue reports as JSONB for flexible schema evolution.
 * Uses revenue.reports table (created on first access if needed).
 * RLS applies via tenant_id.
 */
import { Pool } from 'pg'
import {
  RevenueReport,
  ReportPeriod,
  formatPeriod,
  ReportStatus,
} from '@revenue/domain/aggregates/revenue-report'
import { PQLAttribution } from '@revenue/domain/value-objects/pql-attribution'
import { RevenueSummary } from '@revenue/domain/value-objects/revenue-summary'

export interface RevenueReportRepository {
  save(report: RevenueReport): Promise<RevenueReport>
  update(report: RevenueReport): Promise<RevenueReport>
  findById(id: string): Promise<RevenueReport | null>
  findByPeriod(tenantId: string, period: ReportPeriod): Promise<RevenueReport | null>
  findByTenantId(tenantId: string, options?: { limit?: number; offset?: number }): Promise<RevenueReport[]>
}

interface ReportRow {
  id: string
  tenant_id: string
  period: string
  status: string
  attributions: PQLAttribution[] | string
  summary: RevenueSummary | string | null
  pdf_url: string | null
  html_content: string | null
  created_at: Date | string
  updated_at: Date | string
}

function rowToReport(row: ReportRow): RevenueReport {
  const period = row.period.split('-').map(Number)
  const attributions =
    typeof row.attributions === 'string'
      ? JSON.parse(row.attributions)
      : row.attributions ?? []
  const summary =
    typeof row.summary === 'string'
      ? JSON.parse(row.summary)
      : row.summary ?? null

  return {
    id: row.id,
    tenantId: row.tenant_id,
    period: { year: period[0], month: period[1] },
    status: row.status as ReportStatus,
    attributions,
    summary,
    pdfUrl: row.pdf_url,
    htmlContent: row.html_content,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

export class PgRevenueReportRepository implements RevenueReportRepository {
  constructor(private readonly pool: Pool) {}

  async save(report: RevenueReport): Promise<RevenueReport> {
    const periodStr = formatPeriod(report.period)
    const { rows } = await this.pool.query(
      `INSERT INTO revenue.reports
         (id, tenant_id, period, status, attributions, summary, pdf_url, html_content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        report.id,
        report.tenantId,
        periodStr,
        report.status,
        JSON.stringify(report.attributions),
        report.summary ? JSON.stringify(report.summary) : null,
        report.pdfUrl,
        report.htmlContent,
        report.createdAt,
        report.updatedAt,
      ],
    )
    return rowToReport(rows[0])
  }

  async update(report: RevenueReport): Promise<RevenueReport> {
    const { rows } = await this.pool.query(
      `UPDATE revenue.reports
       SET status = $1, attributions = $2, summary = $3, pdf_url = $4, html_content = $5, updated_at = $6
       WHERE id = $7
       RETURNING *`,
      [
        report.status,
        JSON.stringify(report.attributions),
        report.summary ? JSON.stringify(report.summary) : null,
        report.pdfUrl,
        report.htmlContent,
        report.updatedAt,
        report.id,
      ],
    )
    if (rows.length === 0) {
      throw new Error(`RevenueReport ${report.id} not found`)
    }
    return rowToReport(rows[0])
  }

  async findById(id: string): Promise<RevenueReport | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM revenue.reports WHERE id = $1',
      [id],
    )
    return rows[0] ? rowToReport(rows[0]) : null
  }

  async findByPeriod(tenantId: string, period: ReportPeriod): Promise<RevenueReport | null> {
    const periodStr = formatPeriod(period)
    const { rows } = await this.pool.query(
      'SELECT * FROM revenue.reports WHERE tenant_id = $1 AND period = $2',
      [tenantId, periodStr],
    )
    return rows[0] ? rowToReport(rows[0]) : null
  }

  async findByTenantId(
    tenantId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<RevenueReport[]> {
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const { rows } = await this.pool.query(
      `SELECT * FROM revenue.reports
       WHERE tenant_id = $1
       ORDER BY period DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset],
    )
    return rows.map(rowToReport)
  }
}
