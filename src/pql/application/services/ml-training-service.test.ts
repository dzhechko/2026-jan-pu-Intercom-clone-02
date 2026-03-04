/**
 * ML Training Service tests — FR-10: PQL ML v1.
 * Tests feedback submission, training data collection, export, and statistics.
 */
import { MLTrainingService, FeedbackLabel, TrainingDataPoint } from './ml-training-service'
import { Pool } from 'pg'

// ─── Mock Pool ──────────────────────────────────────────────────────────────

function createMockPool(queryResult: { rows: Record<string, unknown>[] } = { rows: [] }): jest.Mocked<Pool> {
  return {
    query: jest.fn().mockResolvedValue(queryResult),
  } as unknown as jest.Mocked<Pool>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001'
const OPERATOR_ID = 'operator-001'
const DETECTION_ID = 'det-001'

function feedbackRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'fb-001',
    detection_id: DETECTION_ID,
    tenant_id: TENANT_ID,
    operator_id: OPERATOR_ID,
    label: 'CORRECT',
    comment: null,
    created_at: '2026-01-15T10:00:00.000Z',
    ...overrides,
  }
}

function detectionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    detection_id: 'det-001',
    pql_score: 0.75,
    signals: [{ ruleId: 'R01', type: 'PRICING', weight: 0.4, matchedText: 'тариф' }],
    created_at: '2026-01-15T10:00:00.000Z',
    feedback_label: 'CORRECT',
    ...overrides,
  }
}

function statsRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    total: 100,
    labeled: 80,
    correct: 60,
    incorrect: 15,
    unsure: 5,
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MLTrainingService', () => {
  let service: MLTrainingService
  let pool: jest.Mocked<Pool>

  beforeEach(() => {
    pool = createMockPool()
    service = new MLTrainingService(pool)
  })

  // ── submitFeedback ──────────────────────────────────────────────────────

  describe('submitFeedback', () => {
    it('should insert feedback and return mapped record', async () => {
      const row = feedbackRow()
      pool.query = jest.fn().mockResolvedValue({ rows: [row] })

      const result = await service.submitFeedback(
        DETECTION_ID,
        TENANT_ID,
        OPERATOR_ID,
        'CORRECT',
        'Good detection',
      )

      expect(pool.query).toHaveBeenCalledTimes(1)
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pql.detection_feedback'),
        [DETECTION_ID, TENANT_ID, OPERATOR_ID, 'CORRECT', 'Good detection'],
      )
      expect(result).toEqual({
        id: 'fb-001',
        detectionId: DETECTION_ID,
        tenantId: TENANT_ID,
        operatorId: OPERATOR_ID,
        label: 'CORRECT',
        comment: null,
        createdAt: expect.any(Date),
      })
    })

    it('should pass null comment when not provided', async () => {
      pool.query = jest.fn().mockResolvedValue({ rows: [feedbackRow()] })

      await service.submitFeedback(DETECTION_ID, TENANT_ID, OPERATOR_ID, 'INCORRECT')

      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [DETECTION_ID, TENANT_ID, OPERATOR_ID, 'INCORRECT', null],
      )
    })

    it('should handle UPSERT (conflict on detection_id + operator_id)', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [feedbackRow({ label: 'INCORRECT', comment: 'Updated' })],
      })

      const result = await service.submitFeedback(
        DETECTION_ID,
        TENANT_ID,
        OPERATOR_ID,
        'INCORRECT',
        'Updated',
      )

      expect(result.label).toBe('INCORRECT')
      // SQL should contain ON CONFLICT ... DO UPDATE
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array),
      )
    })

    it('should propagate database errors', async () => {
      pool.query = jest.fn().mockRejectedValue(new Error('DB connection lost'))

      await expect(
        service.submitFeedback(DETECTION_ID, TENANT_ID, OPERATOR_ID, 'CORRECT'),
      ).rejects.toThrow('DB connection lost')
    })

    it('should accept all valid feedback labels', async () => {
      const labels: FeedbackLabel[] = ['CORRECT', 'INCORRECT', 'UNSURE']

      for (const label of labels) {
        pool.query = jest.fn().mockResolvedValue({
          rows: [feedbackRow({ label })],
        })

        const result = await service.submitFeedback(
          DETECTION_ID,
          TENANT_ID,
          OPERATOR_ID,
          label,
        )
        expect(result.label).toBe(label)
      }
    })
  })

  // ── collectTrainingData ─────────────────────────────────────────────────

  describe('collectTrainingData', () => {
    it('should return mapped training data points', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [
          detectionRow(),
          detectionRow({
            detection_id: 'det-002',
            pql_score: 0.45,
            feedback_label: null,
            signals: [],
          }),
        ],
      })

      const data = await service.collectTrainingData(TENANT_ID)

      expect(data).toHaveLength(2)
      expect(data[0]).toEqual({
        detectionId: 'det-001',
        messageContent: '',
        signals: [{ ruleId: 'R01', type: 'PRICING', weight: 0.4, matchedText: 'тариф' }],
        pqlScore: 0.75,
        operatorFeedback: 'CORRECT',
        actualOutcome: null,
        tenantId: TENANT_ID,
        createdAt: expect.any(Date),
      })

      // Second row: null feedback and empty signals
      expect(data[1].operatorFeedback).toBeNull()
      expect(data[1].signals).toEqual([])
      expect(data[1].pqlScore).toBe(0.45)
    })

    it('should pass tenantId to query', async () => {
      pool.query = jest.fn().mockResolvedValue({ rows: [] })

      await service.collectTrainingData('tenant-xyz')

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE d.tenant_id = $1'),
        ['tenant-xyz'],
      )
    })

    it('should return empty array when no detections exist', async () => {
      pool.query = jest.fn().mockResolvedValue({ rows: [] })

      const data = await service.collectTrainingData(TENANT_ID)
      expect(data).toEqual([])
    })

    it('should handle null signals gracefully', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [detectionRow({ signals: null })],
      })

      const data = await service.collectTrainingData(TENANT_ID)
      expect(data[0].signals).toEqual([])
    })

    it('should set messageContent to empty string for privacy', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [detectionRow()],
      })

      const data = await service.collectTrainingData(TENANT_ID)
      expect(data[0].messageContent).toBe('')
    })

    it('should propagate database errors', async () => {
      pool.query = jest.fn().mockRejectedValue(new Error('timeout'))

      await expect(service.collectTrainingData(TENANT_ID)).rejects.toThrow('timeout')
    })
  })

  // ── exportTrainingSet ───────────────────────────────────────────────────

  describe('exportTrainingSet', () => {
    const mockDetectionRows = [
      detectionRow(),
      detectionRow({
        detection_id: 'det-002',
        pql_score: 0.30,
        signals: [{ ruleId: 'R02', type: 'ENTERPRISE', weight: 0.5, matchedText: 'enterprise' }],
        feedback_label: 'INCORRECT',
      }),
    ]

    beforeEach(() => {
      pool.query = jest.fn().mockResolvedValue({ rows: mockDetectionRows })
    })

    it('should export as JSON by default', async () => {
      const result = await service.exportTrainingSet(TENANT_ID)
      const parsed = JSON.parse(result)

      expect(parsed).toHaveLength(2)
      expect(parsed[0].detectionId).toBe('det-001')
      expect(parsed[1].detectionId).toBe('det-002')
    })

    it('should export as JSON when format is explicitly json', async () => {
      const result = await service.exportTrainingSet(TENANT_ID, 'json')
      const parsed = JSON.parse(result)

      expect(parsed).toHaveLength(2)
    })

    it('should export as CSV with header', async () => {
      const result = await service.exportTrainingSet(TENANT_ID, 'csv')
      const lines = result.split('\n')

      expect(lines[0]).toBe('detectionId,pqlScore,signalCount,feedback,createdAt')
      expect(lines).toHaveLength(3) // header + 2 data rows
    })

    it('should include correct CSV values', async () => {
      const result = await service.exportTrainingSet(TENANT_ID, 'csv')
      const lines = result.split('\n')

      // First data row
      expect(lines[1]).toContain('det-001')
      expect(lines[1]).toContain('0.75')
      expect(lines[1]).toContain('CORRECT')

      // Second data row
      expect(lines[2]).toContain('det-002')
      expect(lines[2]).toContain('0.3')
      expect(lines[2]).toContain('INCORRECT')
    })

    it('should handle empty feedback in CSV export', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [detectionRow({ feedback_label: null })],
      })

      const result = await service.exportTrainingSet(TENANT_ID, 'csv')
      const lines = result.split('\n')

      // Null feedback should render as empty string in CSV
      expect(lines[1]).toMatch(/det-001,0\.75,1,,/)
    })

    it('should return empty JSON array when no data', async () => {
      pool.query = jest.fn().mockResolvedValue({ rows: [] })

      const result = await service.exportTrainingSet(TENANT_ID)
      expect(JSON.parse(result)).toEqual([])
    })

    it('should return CSV with header only when no data', async () => {
      pool.query = jest.fn().mockResolvedValue({ rows: [] })

      const result = await service.exportTrainingSet(TENANT_ID, 'csv')
      const lines = result.split('\n')

      expect(lines).toHaveLength(1)
      expect(lines[0]).toBe('detectionId,pqlScore,signalCount,feedback,createdAt')
    })
  })

  // ── getTrainingStats ────────────────────────────────────────────────────

  describe('getTrainingStats', () => {
    it('should return correctly mapped statistics', async () => {
      pool.query = jest.fn().mockResolvedValue({ rows: [statsRow()] })

      const stats = await service.getTrainingStats(TENANT_ID)

      expect(stats).toEqual({
        totalSamples: 100,
        labeledSamples: 80,
        correctCount: 60,
        incorrectCount: 15,
        unsureCount: 5,
        unlabeledCount: 20,
        readinessScore: 0.08, // 80 / 1000
        isReady: false,
      })
    })

    it('should calculate readinessScore as labeled / 1000', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [statsRow({ labeled: 500 })],
      })

      const stats = await service.getTrainingStats(TENANT_ID)
      expect(stats.readinessScore).toBe(0.5)
    })

    it('should cap readinessScore at 1.0', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [statsRow({ labeled: 2000 })],
      })

      const stats = await service.getTrainingStats(TENANT_ID)
      expect(stats.readinessScore).toBe(1.0)
    })

    it('should set isReady=true when labeled >= 1000', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [statsRow({ total: 1500, labeled: 1000 })],
      })

      const stats = await service.getTrainingStats(TENANT_ID)
      expect(stats.isReady).toBe(true)
    })

    it('should set isReady=false when labeled < 1000', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [statsRow({ labeled: 999 })],
      })

      const stats = await service.getTrainingStats(TENANT_ID)
      expect(stats.isReady).toBe(false)
    })

    it('should calculate unlabeledCount correctly', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [statsRow({ total: 200, labeled: 150 })],
      })

      const stats = await service.getTrainingStats(TENANT_ID)
      expect(stats.unlabeledCount).toBe(50)
    })

    it('should handle zero samples', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [statsRow({ total: 0, labeled: 0, correct: 0, incorrect: 0, unsure: 0 })],
      })

      const stats = await service.getTrainingStats(TENANT_ID)
      expect(stats.totalSamples).toBe(0)
      expect(stats.readinessScore).toBe(0)
      expect(stats.isReady).toBe(false)
      expect(stats.unlabeledCount).toBe(0)
    })

    it('should propagate database errors', async () => {
      pool.query = jest.fn().mockRejectedValue(new Error('relation does not exist'))

      await expect(service.getTrainingStats(TENANT_ID)).rejects.toThrow(
        'relation does not exist',
      )
    })
  })

  // ── getFeedbackStats ────────────────────────────────────────────────────

  describe('getFeedbackStats', () => {
    it('should return feedback statistics', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [{ total: 50, correct: 30, incorrect: 15, unsure: 5 }],
      })

      const stats = await service.getFeedbackStats(TENANT_ID)

      expect(stats).toEqual({
        total: 50,
        correct: 30,
        incorrect: 15,
        unsure: 5,
      })
    })

    it('should pass tenantId to query', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [{ total: 0, correct: 0, incorrect: 0, unsure: 0 }],
      })

      await service.getFeedbackStats('tenant-abc')

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1'),
        ['tenant-abc'],
      )
    })

    it('should handle zero feedback', async () => {
      pool.query = jest.fn().mockResolvedValue({
        rows: [{ total: 0, correct: 0, incorrect: 0, unsure: 0 }],
      })

      const stats = await service.getFeedbackStats(TENANT_ID)

      expect(stats.total).toBe(0)
      expect(stats.correct).toBe(0)
      expect(stats.incorrect).toBe(0)
      expect(stats.unsure).toBe(0)
    })

    it('should propagate database errors', async () => {
      pool.query = jest.fn().mockRejectedValue(new Error('connection refused'))

      await expect(service.getFeedbackStats(TENANT_ID)).rejects.toThrow('connection refused')
    })
  })
})
