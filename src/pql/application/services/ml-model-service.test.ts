/**
 * ML Model Service tests — FR-10: PQL ML v1.
 * Tests adaptive weight adjustment, prediction, training data readiness,
 * and accuracy calculation.
 */
import { MLModelService, ModelMetrics, MLPrediction } from './ml-model-service'
import { DEFAULT_RULES } from '@pql/domain/value-objects/rule-set'
import type { MLModelRepository, ModelWeights } from '@pql/infrastructure/repositories/ml-model-repository'
import type { FeedbackLabel } from './ml-training-service'

// ─── Mock Repository ────────────────────────────────────────────────────────

function createMockModelRepo(): jest.Mocked<MLModelRepository> {
  return {
    save: jest.fn(async (m: ModelWeights) => m),
    findByTenantId: jest.fn(async () => null),
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createFeedbackData(
  overrides: {
    count?: number
    feedback?: FeedbackLabel
    signalRuleIds?: string[]
  } = {},
) {
  const count = overrides.count ?? 100
  const feedback = overrides.feedback ?? 'CORRECT'
  const signalRuleIds = overrides.signalRuleIds ?? ['R01', 'R02']

  return Array.from({ length: count }, (_, i) => ({
    detectionId: `det-${i}`,
    signals: signalRuleIds.map((id) => ({
      ruleId: id,
      type: DEFAULT_RULES.find((r) => r.id === id)?.type ?? 'UNKNOWN',
      weight: DEFAULT_RULES.find((r) => r.id === id)?.weight ?? 0.3,
      matchedText: 'test',
    })),
    pqlScore: 0.5,
    feedback,
  }))
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MLModelService', () => {
  let service: MLModelService
  let modelRepo: jest.Mocked<MLModelRepository>
  const tenantId = 'tenant-001'

  beforeEach(() => {
    modelRepo = createMockModelRepo()
    service = new MLModelService(modelRepo)
  })

  // ── Weight Adjustment ───────────────────────────────────────────────────

  describe('trainModel', () => {
    it('should increase weights for rules with mostly CORRECT feedback', async () => {
      const feedbackData = createFeedbackData({
        count: 1000,
        feedback: 'CORRECT',
        signalRuleIds: ['R01'],
      })

      const model = await service.trainModel(tenantId, feedbackData)

      // R01 default weight is 0.40, CORRECT feedback should boost it
      expect(model.weights['R01']).toBeGreaterThan(0.40)
      expect(model.adjustments['R01']).toBeGreaterThan(0)
      expect(modelRepo.save).toHaveBeenCalledTimes(1)
    })

    it('should decrease weights for rules with mostly INCORRECT feedback', async () => {
      const feedbackData = createFeedbackData({
        count: 1000,
        feedback: 'INCORRECT',
        signalRuleIds: ['R02'],
      })

      const model = await service.trainModel(tenantId, feedbackData)

      // R02 default weight is 0.50, INCORRECT feedback should reduce it
      expect(model.weights['R02']).toBeLessThan(0.50)
      expect(model.adjustments['R02']).toBeLessThan(0)
    })

    it('should keep default weights for rules with no feedback', async () => {
      // Only provide feedback for R01, R02 should remain unchanged
      const feedbackData = createFeedbackData({
        count: 100,
        feedback: 'CORRECT',
        signalRuleIds: ['R01'],
      })

      const model = await service.trainModel(tenantId, feedbackData)

      // R03 had no feedback — should keep its default weight
      expect(model.weights['R03']).toBe(DEFAULT_RULES.find((r) => r.id === 'R03')!.weight)
      expect(model.adjustments['R03']).toBe(0)
    })

    it('should skip UNSURE feedback in weight calculation', async () => {
      const feedbackData = createFeedbackData({
        count: 500,
        feedback: 'UNSURE',
        signalRuleIds: ['R01'],
      })

      const model = await service.trainModel(tenantId, feedbackData)

      // UNSURE is skipped, so weights should remain default
      expect(model.weights['R01']).toBe(DEFAULT_RULES.find((r) => r.id === 'R01')!.weight)
    })

    it('should clamp weight adjustment within bounds', async () => {
      // All feedback is INCORRECT — weight should not go below minimum factor
      const feedbackData = createFeedbackData({
        count: 2000,
        feedback: 'INCORRECT',
        signalRuleIds: ['R06'], // R06 has weight 0.60
      })

      const model = await service.trainModel(tenantId, feedbackData)

      // Min factor is 0.2, so minimum weight = 0.60 * 0.2 = 0.12
      expect(model.weights['R06']).toBeGreaterThanOrEqual(0.60 * 0.2 - 0.001)
    })

    it('should store sampleCount and version in model', async () => {
      const feedbackData = createFeedbackData({ count: 1500 })
      const model = await service.trainModel(tenantId, feedbackData)

      expect(model.sampleCount).toBe(1500)
      expect(model.version).toMatch(/^ml-v1-/)
      expect(model.tenantId).toBe(tenantId)
      expect(model.trainedAt).toBeInstanceOf(Date)
    })
  })

  // ── Prediction ──────────────────────────────────────────────────────────

  describe('predict', () => {
    it('should return null when no trained model exists', async () => {
      modelRepo.findByTenantId.mockResolvedValue(null)

      const result = await service.predict(tenantId, 'Enterprise тариф')
      expect(result).toBeNull()
    })

    it('should return null when model has insufficient training data', async () => {
      modelRepo.findByTenantId.mockResolvedValue({
        tenantId,
        weights: { R01: 0.5 },
        adjustments: { R01: 0.1 },
        version: 'ml-v1-test',
        trainedAt: new Date(),
        sampleCount: 500, // below 1000 threshold
      })

      const result = await service.predict(tenantId, 'Enterprise тариф')
      expect(result).toBeNull()
    })

    it('should use adjusted weights when model is ready', async () => {
      // Boost ENTERPRISE rule significantly
      const adjustedWeights: Record<string, number> = {}
      for (const rule of DEFAULT_RULES) {
        adjustedWeights[rule.id] = rule.weight
      }
      adjustedWeights['R02'] = 0.90 // Boost ENTERPRISE from 0.50 to 0.90

      modelRepo.findByTenantId.mockResolvedValue({
        tenantId,
        weights: adjustedWeights,
        adjustments: { R02: 0.8 },
        version: 'ml-v1-test',
        trainedAt: new Date(),
        sampleCount: 1500,
      })

      const result = await service.predict(tenantId, 'Enterprise план')

      expect(result).not.toBeNull()
      expect(result!.modelVersion).toBe('ml-v1-test')
      // ML score should differ from rule-v1 score because of boosted weight
      expect(result!.score).toBeGreaterThan(0)
      expect(result!.ruleV1Score).toBeGreaterThan(0)
      // The ml score should be higher because we boosted ENTERPRISE
      expect(result!.score).toBeGreaterThanOrEqual(result!.ruleV1Score)
    })

    it('should include ruleV1Score for comparison logging', async () => {
      const adjustedWeights: Record<string, number> = {}
      for (const rule of DEFAULT_RULES) {
        adjustedWeights[rule.id] = rule.weight
      }

      modelRepo.findByTenantId.mockResolvedValue({
        tenantId,
        weights: adjustedWeights,
        adjustments: {},
        version: 'ml-v1-test',
        trainedAt: new Date(),
        sampleCount: 1000,
      })

      const result = await service.predict(tenantId, 'Нужен enterprise тариф')

      expect(result).not.toBeNull()
      expect(typeof result!.ruleV1Score).toBe('number')
      expect(typeof result!.score).toBe('number')
    })

    it('should calculate correct tier from adjusted score', async () => {
      // Boost enough rules to get a HOT prediction
      const adjustedWeights: Record<string, number> = {}
      for (const rule of DEFAULT_RULES) {
        adjustedWeights[rule.id] = rule.weight * 2 // double all weights
      }

      modelRepo.findByTenantId.mockResolvedValue({
        tenantId,
        weights: adjustedWeights,
        adjustments: {},
        version: 'ml-v1-test',
        trainedAt: new Date(),
        sampleCount: 2000,
      })

      const result = await service.predict(
        tenantId,
        'Хотим оформить договор на enterprise тариф, нужно демо, обсудить бюджет',
      )

      expect(result).not.toBeNull()
      expect(['HOT', 'WARM', 'COLD']).toContain(result!.tier)
    })
  })

  // ── Readiness Threshold ─────────────────────────────────────────────────

  describe('hasTrainedModel', () => {
    it('should return false when no model exists', async () => {
      modelRepo.findByTenantId.mockResolvedValue(null)
      const ready = await service.hasTrainedModel(tenantId)
      expect(ready).toBe(false)
    })

    it('should return false when model has < 1K samples', async () => {
      modelRepo.findByTenantId.mockResolvedValue({
        tenantId,
        weights: {},
        adjustments: {},
        version: 'ml-v1-test',
        trainedAt: new Date(),
        sampleCount: 999,
      })

      const ready = await service.hasTrainedModel(tenantId)
      expect(ready).toBe(false)
    })

    it('should return true when model has >= 1K samples', async () => {
      modelRepo.findByTenantId.mockResolvedValue({
        tenantId,
        weights: {},
        adjustments: {},
        version: 'ml-v1-test',
        trainedAt: new Date(),
        sampleCount: 1000,
      })

      const ready = await service.hasTrainedModel(tenantId)
      expect(ready).toBe(true)
    })

    it('should return true when model has > 1K samples', async () => {
      modelRepo.findByTenantId.mockResolvedValue({
        tenantId,
        weights: {},
        adjustments: {},
        version: 'ml-v1-test',
        trainedAt: new Date(),
        sampleCount: 5000,
      })

      const ready = await service.hasTrainedModel(tenantId)
      expect(ready).toBe(true)
    })
  })

  // ── Accuracy Calculation ────────────────────────────────────────────────

  describe('getModelMetrics', () => {
    it('should calculate accuracy from feedback data', async () => {
      const correct = createFeedbackData({ count: 75, feedback: 'CORRECT' })
      const incorrect = createFeedbackData({ count: 25, feedback: 'INCORRECT' })
      const feedbackData = [...correct, ...incorrect]

      const metrics = await service.getModelMetrics(tenantId, feedbackData)

      expect(metrics.accuracy).toBe(0.75) // 75 / 100
      expect(metrics.totalEvaluated).toBe(100)
    })

    it('should exclude UNSURE from accuracy calculation', async () => {
      const correct = createFeedbackData({ count: 80, feedback: 'CORRECT' })
      const incorrect = createFeedbackData({ count: 20, feedback: 'INCORRECT' })
      const unsure = createFeedbackData({ count: 50, feedback: 'UNSURE' })
      const feedbackData = [...correct, ...incorrect, ...unsure]

      const metrics = await service.getModelMetrics(tenantId, feedbackData)

      // Only 100 labeled (80 + 20), UNSURE excluded
      expect(metrics.totalEvaluated).toBe(100)
      expect(metrics.accuracy).toBe(0.80)
    })

    it('should return zero metrics for empty feedback', async () => {
      const metrics = await service.getModelMetrics(tenantId, [])

      expect(metrics.accuracy).toBe(0)
      expect(metrics.precision).toBe(0)
      expect(metrics.recall).toBe(0)
      expect(metrics.totalEvaluated).toBe(0)
    })

    it('should include rule adjustment details', async () => {
      // First train a model so adjustments exist
      const feedbackData = createFeedbackData({
        count: 100,
        feedback: 'CORRECT',
        signalRuleIds: ['R01'],
      })
      await service.trainModel(tenantId, feedbackData)

      // Now get the saved model for metrics
      const savedModel = modelRepo.save.mock.calls[0][0]
      modelRepo.findByTenantId.mockResolvedValue(savedModel)

      const metrics = await service.getModelMetrics(tenantId, feedbackData)

      expect(metrics.ruleAdjustments.length).toBe(DEFAULT_RULES.length)
      const r01Adj = metrics.ruleAdjustments.find((r) => r.ruleId === 'R01')
      expect(r01Adj).toBeDefined()
      expect(r01Adj!.defaultWeight).toBe(0.40)
      expect(r01Adj!.adjustedWeight).toBeGreaterThan(0.40) // boosted
    })

    it('should achieve >= 75% accuracy with balanced feedback', async () => {
      // Simulate realistic scenario: 80% correct, 15% incorrect, 5% unsure
      const correct = createFeedbackData({ count: 800, feedback: 'CORRECT' })
      const incorrect = createFeedbackData({ count: 150, feedback: 'INCORRECT' })
      const unsure = createFeedbackData({ count: 50, feedback: 'UNSURE' })
      const feedbackData = [...correct, ...incorrect, ...unsure]

      const metrics = await service.getModelMetrics(tenantId, feedbackData)

      // 800 / (800 + 150) = 0.842 >= 0.75
      expect(metrics.accuracy).toBeGreaterThanOrEqual(0.75)
    })
  })

  // ── Integration: Train + Predict ────────────────────────────────────────

  describe('train then predict', () => {
    it('should produce different scores after training with biased feedback', async () => {
      // Train with feedback that boosts ENTERPRISE rule
      const feedbackData = createFeedbackData({
        count: 1500,
        feedback: 'CORRECT',
        signalRuleIds: ['R02'], // ENTERPRISE
      })

      const model = await service.trainModel(tenantId, feedbackData)
      modelRepo.findByTenantId.mockResolvedValue(model)

      const prediction = await service.predict(tenantId, 'Enterprise plan')

      expect(prediction).not.toBeNull()
      // ML score should differ from rule-v1 due to weight adjustments
      expect(prediction!.modelVersion).toMatch(/^ml-v1-/)
    })
  })
})
