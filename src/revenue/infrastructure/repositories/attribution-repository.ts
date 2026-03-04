/**
 * Attribution Repository — PostgreSQL implementation.
 * FR-12: Stores PQL-to-deal attribution records.
 * Schema: revenue.attributions (migration TBD)
 *
 * All queries run under RLS (FF-03) — tenant_id filtering is automatic.
 */
import { Pool } from 'pg'

// ─── Attribution Entity ─────────────────────────────────────────────────────

export interface Attribution {
  readonly id: string
  readonly tenantId: string
  readonly pqlDetectionId: string
  readonly dialogId: string
  readonly dealId: string
  readonly dealValue: number
  readonly closedAt: Date
  readonly timeToClose: number
  readonly operatorId: string | null
  readonly confidence: number
  readonly createdAt: Date
}

export interface CreateAttributionInput {
  readonly id: string
  readonly tenantId: string
  readonly pqlDetectionId: string
  readonly dialogId: string
  readonly dealId: string
  readonly dealValue: number
  readonly closedAt: Date
  readonly timeToClose: number
  readonly operatorId: string | null
  readonly confidence: number
}

// ─── Repository Interface ───────────────────────────────────────────────────

export interface AttributionRepository {
  save(input: CreateAttributionInput): Promise<Attribution>
  findByDealId(dealId: string): Promise<Attribution | null>
  findByDetectionId(detectionId: string): Promise<Attribution | null>
  findByTenantId(
    tenantId: string,
    period?: { start: Date; end: Date },
  ): Promise<Attribution[]>
  deleteById(id: string): Promise<boolean>
}

// ─── Row Mapper ─────────────────────────────────────────────────────────────

function rowToAttribution(row: Record<string, unknown>): Attribution {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    pqlDetectionId: row.pql_detection_id as string,
    dialogId: row.dialog_id as string,
    dealId: row.deal_id as string,
    dealValue: Number(row.deal_value),
    closedAt: new Date(row.closed_at as string),
    timeToClose: Number(row.time_to_close),
    operatorId: (row.operator_id as string) || null,
    confidence: Number(row.confidence),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── PostgreSQL Implementation ──────────────────────────────────────────────

export class PgAttributionRepository implements AttributionRepository {
  constructor(private readonly pool: Pool) {}

  async save(input: CreateAttributionInput): Promise<Attribution> {
    const { rows } = await this.pool.query(
      `INSERT INTO revenue.attributions
         (id, tenant_id, pql_detection_id, dialog_id, deal_id, deal_value,
          closed_at, time_to_close, operator_id, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.pqlDetectionId,
        input.dialogId,
        input.dealId,
        input.dealValue,
        input.closedAt,
        input.timeToClose,
        input.operatorId,
        input.confidence,
      ],
    )
    return rowToAttribution(rows[0])
  }

  async findByDealId(dealId: string): Promise<Attribution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM revenue.attributions WHERE deal_id = $1 LIMIT 1`,
      [dealId],
    )
    return rows.length > 0 ? rowToAttribution(rows[0]) : null
  }

  async findByDetectionId(detectionId: string): Promise<Attribution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM revenue.attributions WHERE pql_detection_id = $1 LIMIT 1`,
      [detectionId],
    )
    return rows.length > 0 ? rowToAttribution(rows[0]) : null
  }

  async findByTenantId(
    tenantId: string,
    period?: { start: Date; end: Date },
  ): Promise<Attribution[]> {
    if (period) {
      const { rows } = await this.pool.query(
        `SELECT * FROM revenue.attributions
         WHERE tenant_id = $1 AND closed_at >= $2 AND closed_at <= $3
         ORDER BY closed_at DESC`,
        [tenantId, period.start, period.end],
      )
      return rows.map(rowToAttribution)
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM revenue.attributions
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [tenantId],
    )
    return rows.map(rowToAttribution)
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM revenue.attributions WHERE id = $1`,
      [id],
    )
    return (result.rowCount ?? 0) > 0
  }
}
