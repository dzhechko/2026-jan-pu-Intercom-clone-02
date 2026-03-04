/**
 * PQL Detection Repository — PostgreSQL implementation.
 * Schema: pql.detections (migration TBD)
 * Reference: docs/tactical-design.md — PQL Bounded Context
 *
 * Stores individual PQL signal detection events per message.
 * IMPORTANT: All queries run under RLS (FF-03).
 */
import { Pool } from 'pg'
import type { PQLDetection, PQLDetectionRepository } from '@pql/application/services/pql-detector-service'

function rowToDetection(row: Record<string, unknown>): PQLDetection {
  return {
    id: row.id as string,
    dialogId: row.dialog_id as string,
    tenantId: row.tenant_id as string,
    messageId: row.message_id as string,
    score: Number(row.score),
    tier: row.tier as PQLDetection['tier'],
    signals: (row.signals as PQLDetection['signals']) ?? [],
    topSignals: (row.top_signals as PQLDetection['topSignals']) ?? [],
    createdAt: new Date(row.created_at as string),
  }
}

export class PgPQLDetectionRepository implements PQLDetectionRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Persist a new PQL detection record.
   */
  async save(detection: PQLDetection): Promise<PQLDetection> {
    const { rows } = await this.pool.query(
      `INSERT INTO pql.detections
         (id, dialog_id, tenant_id, message_id, score, tier, signals, top_signals, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        detection.id,
        detection.dialogId,
        detection.tenantId,
        detection.messageId,
        detection.score,
        detection.tier,
        JSON.stringify(detection.signals),
        JSON.stringify(detection.topSignals),
        detection.createdAt,
      ],
    )
    return rowToDetection(rows[0])
  }

  /**
   * Get all PQL detections for a specific dialog, newest first.
   */
  async findByDialogId(dialogId: string): Promise<PQLDetection[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM pql.detections
       WHERE dialog_id = $1
       ORDER BY created_at DESC`,
      [dialogId],
    )
    return rows.map(rowToDetection)
  }

  /**
   * List PQL detections for a tenant with pagination, newest first.
   */
  async findByTenantId(
    tenantId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<PQLDetection[]> {
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const { rows } = await this.pool.query(
      `SELECT * FROM pql.detections
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset],
    )
    return rows.map(rowToDetection)
  }
}
