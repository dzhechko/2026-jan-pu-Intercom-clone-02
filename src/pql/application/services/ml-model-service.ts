/**
 * ML Model Service — FR-10: PQL ML v1.
 * Adaptive rule weight adjustment based on operator feedback.
 *
 * This is NOT a real ML model — it's weighted rule adjustment (Phase 2 of Progressive LLM Enhancement).
 * After 1K labeled dialogs, adjusts rule weights to achieve >= 75% accuracy.
 *
 * Strategy:
 * - Rules frequently marked INCORRECT get their weight reduced
 * - Rules frequently marked CORRECT get their weight boosted
 * - Weight adjustment = base_weight * (1 + adjustment_factor)
 * - adjustment_factor = (correct_rate - incorrect_rate) * LEARNING_RATE
 */
import { DEFAULT_RULES, SignalRule } from '@pql/domain/value-objects/rule-set'
import { analyzeRules, RuleAnalysisResult } from '@pql/domain/rule-engine'
import { calculateTier } from '@pql/domain/value-objects/pql-score'
import type { MLModelRepository, ModelWeights } from '@pql/infrastructure/repositories/ml-model-repository'
import type { FeedbackLabel } from './ml-training-service'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ModelMetrics {
  accuracy: number
  precision: number
  recall: number
  totalEvaluated: number
  ruleAdjustments: Array<{
    ruleId: string
    type: string
    defaultWeight: number
    adjustedWeight: number
    adjustmentFactor: number
  }>
}

export interface MLPrediction {
  score: number
  tier: 'HOT' | 'WARM' | 'COLD'
  signals: RuleAnalysisResult['signals']
  topSignals: RuleAnalysisResult['topSignals']
  modelVersion: string
  ruleV1Score: number   // original score for comparison logging
}

interface FeedbackDataPoint {
  detectionId: string
  signals: Array<{ ruleId: string; type: string; weight: number; matchedText: string }>
  pqlScore: number
  feedback: FeedbackLabel
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LEARNING_RATE = 0.3
const MIN_WEIGHT_FACTOR = 0.2   // weight can't go below 20% of original
const MAX_WEIGHT_FACTOR = 2.0   // weight can't exceed 200% of original
const MIN_TRAINING_SAMPLES = 1000

// ─── Service ────────────────────────────────────────────────────────────────

export class MLModelService {
  constructor(private readonly modelRepo: MLModelRepository) {}

  /**
   * Train the model: adjust rule weights based on feedback data.
   * Returns the updated model weights.
   */
  async trainModel(
    tenantId: string,
    feedbackData: FeedbackDataPoint[],
  ): Promise<ModelWeights> {
    // Count feedback per rule
    const ruleStats = new Map<string, { correct: number; incorrect: number; total: number }>()

    // Initialize with all default rules
    for (const rule of DEFAULT_RULES) {
      ruleStats.set(rule.id, { correct: 0, incorrect: 0, total: 0 })
    }

    // Aggregate feedback per rule
    for (const dp of feedbackData) {
      if (dp.feedback === 'UNSURE') continue

      for (const signal of dp.signals) {
        const stats = ruleStats.get(signal.ruleId)
        if (!stats) continue

        stats.total++
        if (dp.feedback === 'CORRECT') {
          stats.correct++
        } else if (dp.feedback === 'INCORRECT') {
          stats.incorrect++
        }
      }
    }

    // Calculate adjusted weights
    const weights: Record<string, number> = {}
    const adjustments: Record<string, number> = {}

    for (const rule of DEFAULT_RULES) {
      const stats = ruleStats.get(rule.id)!

      if (stats.total === 0) {
        // No feedback for this rule — keep default weight
        weights[rule.id] = rule.weight
        adjustments[rule.id] = 0
        continue
      }

      const correctRate = stats.correct / stats.total
      const incorrectRate = stats.incorrect / stats.total

      // Adjustment factor: positive boosts, negative reduces
      const adjustmentFactor = (correctRate - incorrectRate) * LEARNING_RATE
      adjustments[rule.id] = adjustmentFactor

      // Apply adjustment with clamping
      const factor = Math.max(
        MIN_WEIGHT_FACTOR,
        Math.min(MAX_WEIGHT_FACTOR, 1 + adjustmentFactor),
      )
      weights[rule.id] = Number((rule.weight * factor).toFixed(4))
    }

    const modelWeights: ModelWeights = {
      tenantId,
      weights,
      adjustments,
      version: `ml-v1-${Date.now()}`,
      trainedAt: new Date(),
      sampleCount: feedbackData.length,
    }

    await this.modelRepo.save(modelWeights)
    return modelWeights
  }

  /**
   * Predict PQL score using adjusted weights (if model exists).
   * Falls back to default rule engine if no model available.
   */
  async predict(tenantId: string, messageContent: string): Promise<MLPrediction | null> {
    const model = await this.modelRepo.findByTenantId(tenantId)

    // Get rule-v1 baseline score
    const ruleV1Result = analyzeRules(messageContent, DEFAULT_RULES)

    if (!model || model.sampleCount < MIN_TRAINING_SAMPLES) {
      // No trained model or insufficient data — return null (use rule-v1 fallback)
      return null
    }

    // Create adjusted rules with ML weights
    const adjustedRules: SignalRule[] = DEFAULT_RULES.map((rule) => ({
      ...rule,
      weight: model.weights[rule.id] ?? rule.weight,
    }))

    const mlResult = analyzeRules(messageContent, adjustedRules)

    return {
      score: mlResult.normalizedScore,
      tier: calculateTier(mlResult.normalizedScore),
      signals: mlResult.signals,
      topSignals: mlResult.topSignals,
      modelVersion: model.version,
      ruleV1Score: ruleV1Result.normalizedScore,
    }
  }

  /**
   * Calculate model accuracy metrics from feedback data.
   */
  async getModelMetrics(
    tenantId: string,
    feedbackData: FeedbackDataPoint[],
  ): Promise<ModelMetrics> {
    const model = await this.modelRepo.findByTenantId(tenantId)

    // Calculate accuracy: % of CORRECT feedback out of labeled (non-UNSURE) samples
    const labeled = feedbackData.filter((d) => d.feedback !== 'UNSURE')
    const correct = labeled.filter((d) => d.feedback === 'CORRECT')
    const accuracy = labeled.length > 0 ? correct.length / labeled.length : 0

    // Precision: of all detections marked with signals, how many were correct
    const withSignals = labeled.filter((d) => d.signals.length > 0)
    const correctWithSignals = withSignals.filter((d) => d.feedback === 'CORRECT')
    const precision = withSignals.length > 0
      ? correctWithSignals.length / withSignals.length
      : 0

    // Recall: of all CORRECT feedback, how many had signals
    const recall = correct.length > 0
      ? correctWithSignals.length / correct.length
      : 0

    // Build rule adjustment report
    const ruleAdjustments = DEFAULT_RULES.map((rule) => ({
      ruleId: rule.id,
      type: rule.type,
      defaultWeight: rule.weight,
      adjustedWeight: model?.weights[rule.id] ?? rule.weight,
      adjustmentFactor: model?.adjustments[rule.id] ?? 0,
    }))

    return {
      accuracy,
      precision,
      recall,
      totalEvaluated: labeled.length,
      ruleAdjustments,
    }
  }

  /**
   * Check if a trained model is available and ready for a tenant.
   */
  async hasTrainedModel(tenantId: string): Promise<boolean> {
    const model = await this.modelRepo.findByTenantId(tenantId)
    return model !== null && model.sampleCount >= MIN_TRAINING_SAMPLES
  }
}
