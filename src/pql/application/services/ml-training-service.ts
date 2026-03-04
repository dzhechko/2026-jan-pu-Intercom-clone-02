/**
 * ML Training Data Service — FR-10: PQL ML v1.
 * Collects labeled data from detections + operator feedback for adaptive rule training.
 *
 * Reference: ADR Progressive AI Enhancement — Phase 2
 */
import { Pool } from 'pg'

// ─── Types ──────────────────────────────────────────────────────────────────

export type FeedbackLabel = 'CORRECT' | 'INCORRECT' | 'UNSURE'

export interface TrainingDataPoint {
  detectionId: string
  messageContent: string
  signals: Array<{ ruleId: string; type: string; weight: number; matchedText: string }>
  pqlScore: number
  operatorFeedback: FeedbackLabel | null
  actualOutcome: 'DEAL' | 'NO_DEAL' | null
  tenantId: string
  createdAt: Date
}

export interface TrainingStats {
  totalSamples: number
  labeledSamples: number
  correctCount: number
  incorrectCount: number
  unsureCount: number
  unlabeledCount: number
  readinessScore: number        // 0.0 - 1.0, based on labeled sample count vs 1K threshold
  isReady: boolean              // true if >= 1K labeled samples
}

export interface FeedbackRecord {
  id: string
  detectionId: string
  tenantId: string
  operatorId: string
  label: FeedbackLabel
  comment: string | null
  createdAt: Date
}

// ─── Service ────────────────────────────────────────────────────────────────

export class MLTrainingService {
  constructor(private readonly pool: Pool) {}

  /**
   * Submit operator feedback for a PQL detection.
   */
  async submitFeedback(
    detectionId: string,
    tenantId: string,
    operatorId: string,
    label: FeedbackLabel,
    comment?: string,
  ): Promise<FeedbackRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO pql.detection_feedback
         (detection_id, tenant_id, operator_id, label, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (detection_id, operator_id)
       DO UPDATE SET label = $4, comment = $5, updated_at = NOW()
       RETURNING id, detection_id, tenant_id, operator_id, label, comment, created_at`,
      [detectionId, tenantId, operatorId, label, comment ?? null],
    )
    const row = rows[0]
    return {
      id: row.id,
      detectionId: row.detection_id,
      tenantId: row.tenant_id,
      operatorId: row.operator_id,
      label: row.label,
      comment: row.comment,
      createdAt: new Date(row.created_at),
    }
  }

  /**
   * Collect training data from detections + operator feedback.
   */
  async collectTrainingData(tenantId: string): Promise<TrainingDataPoint[]> {
    const { rows } = await this.pool.query(
      `SELECT
         d.id AS detection_id,
         d.score AS pql_score,
         d.signals,
         d.created_at,
         f.label AS feedback_label
       FROM pql.detections d
       LEFT JOIN pql.detection_feedback f ON f.detection_id = d.id
       WHERE d.tenant_id = $1
       ORDER BY d.created_at DESC`,
      [tenantId],
    )

    return rows.map((row: Record<string, unknown>) => ({
      detectionId: row.detection_id as string,
      messageContent: '',  // not stored for privacy; signals are sufficient
      signals: (row.signals as TrainingDataPoint['signals']) ?? [],
      pqlScore: Number(row.pql_score),
      operatorFeedback: (row.feedback_label as FeedbackLabel) ?? null,
      actualOutcome: null,
      tenantId,
      createdAt: new Date(row.created_at as string),
    }))
  }

  /**
   * Export training set as JSON array.
   */
  async exportTrainingSet(
    tenantId: string,
    format: 'json' | 'csv' = 'json',
  ): Promise<string> {
    const data = await this.collectTrainingData(tenantId)

    if (format === 'csv') {
      const header = 'detectionId,pqlScore,signalCount,feedback,createdAt'
      const csvRows = data.map(
        (d) =>
          `${d.detectionId},${d.pqlScore},${d.signals.length},${d.operatorFeedback ?? ''},${d.createdAt.toISOString()}`,
      )
      return [header, ...csvRows].join('\n')
    }

    return JSON.stringify(data, null, 2)
  }

  /**
   * Get training data statistics for a tenant.
   */
  async getTrainingStats(tenantId: string): Promise<TrainingStats> {
    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(f.label)::int AS labeled,
         COUNT(*) FILTER (WHERE f.label = 'CORRECT')::int AS correct,
         COUNT(*) FILTER (WHERE f.label = 'INCORRECT')::int AS incorrect,
         COUNT(*) FILTER (WHERE f.label = 'UNSURE')::int AS unsure
       FROM pql.detections d
       LEFT JOIN pql.detection_feedback f ON f.detection_id = d.id
       WHERE d.tenant_id = $1`,
      [tenantId],
    )

    const row = rows[0]
    const total = Number(row.total)
    const labeled = Number(row.labeled)
    const correct = Number(row.correct)
    const incorrect = Number(row.incorrect)
    const unsure = Number(row.unsure)
    const unlabeled = total - labeled

    const READINESS_THRESHOLD = 1000
    const readinessScore = Math.min(labeled / READINESS_THRESHOLD, 1.0)

    return {
      totalSamples: total,
      labeledSamples: labeled,
      correctCount: correct,
      incorrectCount: incorrect,
      unsureCount: unsure,
      unlabeledCount: unlabeled,
      readinessScore,
      isReady: labeled >= READINESS_THRESHOLD,
    }
  }

  /**
   * Get feedback statistics (for the feedback stats endpoint).
   */
  async getFeedbackStats(tenantId: string): Promise<{
    total: number
    correct: number
    incorrect: number
    unsure: number
  }> {
    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE label = 'CORRECT')::int AS correct,
         COUNT(*) FILTER (WHERE label = 'INCORRECT')::int AS incorrect,
         COUNT(*) FILTER (WHERE label = 'UNSURE')::int AS unsure
       FROM pql.detection_feedback
       WHERE tenant_id = $1`,
      [tenantId],
    )

    const row = rows[0]
    return {
      total: Number(row.total),
      correct: Number(row.correct),
      incorrect: Number(row.incorrect),
      unsure: Number(row.unsure),
    }
  }
}
