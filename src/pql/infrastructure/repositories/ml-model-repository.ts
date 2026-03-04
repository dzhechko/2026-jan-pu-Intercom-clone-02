/**
 * ML Model Repository — FR-10: PQL ML v1.
 * Stores adaptive rule weights per tenant in pql.ml_training_data.
 *
 * Reference: ADR Progressive AI Enhancement — Phase 2
 */
import { Pool } from 'pg'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ModelWeights {
  tenantId: string
  weights: Record<string, number>       // ruleId -> adjusted weight
  adjustments: Record<string, number>   // ruleId -> adjustment factor
  version: string
  trainedAt: Date
  sampleCount: number
}

export interface MLModelRepository {
  save(model: ModelWeights): Promise<ModelWeights>
  findByTenantId(tenantId: string): Promise<ModelWeights | null>
}

// ─── PostgreSQL Implementation ──────────────────────────────────────────────

export class PgMLModelRepository implements MLModelRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Save (upsert) model weights for a tenant.
   * Uses ON CONFLICT to always keep the latest model.
   */
  async save(model: ModelWeights): Promise<ModelWeights> {
    const { rows } = await this.pool.query(
      `INSERT INTO pql.ml_training_data
         (tenant_id, weights, adjustments, version, trained_at, sample_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         weights = $2,
         adjustments = $3,
         version = $4,
         trained_at = $5,
         sample_count = $6,
         updated_at = NOW()
       RETURNING *`,
      [
        model.tenantId,
        JSON.stringify(model.weights),
        JSON.stringify(model.adjustments),
        model.version,
        model.trainedAt,
        model.sampleCount,
      ],
    )

    return this.rowToModel(rows[0])
  }

  /**
   * Load the latest model weights for a tenant.
   */
  async findByTenantId(tenantId: string): Promise<ModelWeights | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM pql.ml_training_data
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenantId],
    )

    if (rows.length === 0) return null
    return this.rowToModel(rows[0])
  }

  private rowToModel(row: Record<string, unknown>): ModelWeights {
    return {
      tenantId: row.tenant_id as string,
      weights: (typeof row.weights === 'string'
        ? JSON.parse(row.weights)
        : row.weights) as Record<string, number>,
      adjustments: (typeof row.adjustments === 'string'
        ? JSON.parse(row.adjustments)
        : row.adjustments) as Record<string, number>,
      version: row.version as string,
      trainedAt: new Date(row.trained_at as string),
      sampleCount: Number(row.sample_count),
    }
  }
}
