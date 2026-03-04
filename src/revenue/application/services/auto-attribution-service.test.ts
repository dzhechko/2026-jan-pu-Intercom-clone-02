/**
 * Auto-Attribution Service tests — FR-12: amoCRM Auto-Update.
 * Tests the attribution pipeline: deal closed → find PQL → create attribution → emit event.
 *
 * Reference: docs/pseudocode.md PS-05
 */
import {
  AutoAttributionService,
  PQLDetectionRecord,
  PQLDetectionLookup,
  TenantLookup,
} from './auto-attribution-service'
import type {
  Attribution,
  AttributionRepository,
  CreateAttributionInput,
} from '@revenue/infrastructure/repositories/attribution-repository'
import type { DealClosedEvent } from '@integration/infrastructure/crm-webhook-types'

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockAttributionRepo(): jest.Mocked<AttributionRepository> {
  return {
    save: jest.fn(async (input: CreateAttributionInput): Promise<Attribution> => ({
      ...input,
      createdAt: new Date(),
    })),
    findByDealId: jest.fn(async () => null),
    findByDetectionId: jest.fn(async () => null),
    findByTenantId: jest.fn(async () => []),
    deleteById: jest.fn(async () => true),
  }
}

function createMockPQLDetectionLookup(): jest.Mocked<PQLDetectionLookup> {
  return {
    findByContactEmail: jest.fn(async () => null),
    findById: jest.fn(async () => null),
  }
}

function createMockTenantLookup(): jest.Mocked<TenantLookup> {
  return {
    findByAmoCRMAccountId: jest.fn(async () => 'tenant-001'),
  }
}

function createDealClosedEvent(overrides: Partial<DealClosedEvent> = {}): DealClosedEvent {
  return {
    dealId: 'deal-123',
    accountId: 'account-456',
    dealValue: 12000,
    closedAt: new Date('2026-02-15'),
    pipelineId: 'pipeline-1',
    responsibleUserId: 'user-789',
    contactEmail: 'customer@example.com',
    ...overrides,
  }
}

function createPQLDetectionRecord(overrides: Partial<PQLDetectionRecord> = {}): PQLDetectionRecord {
  return {
    id: 'detection-001',
    dialogId: 'dialog-001',
    tenantId: 'tenant-001',
    score: 0.85,
    createdAt: new Date('2026-01-15'),
    contactEmail: 'customer@example.com',
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AutoAttributionService', () => {
  let service: AutoAttributionService
  let attributionRepo: jest.Mocked<AttributionRepository>
  let pqlLookup: jest.Mocked<PQLDetectionLookup>
  let tenantLookup: jest.Mocked<TenantLookup>
  let onDealAttributed: jest.Mock

  beforeEach(() => {
    attributionRepo = createMockAttributionRepo()
    pqlLookup = createMockPQLDetectionLookup()
    tenantLookup = createMockTenantLookup()
    onDealAttributed = jest.fn()
    service = new AutoAttributionService(
      attributionRepo,
      pqlLookup,
      tenantLookup,
      onDealAttributed,
    )
  })

  // ── Deal closed triggers attribution ────────────────────────────────────

  describe('processDealClosed', () => {
    it('should create attribution when PQL detection exists for contact', async () => {
      const event = createDealClosedEvent()
      const detection = createPQLDetectionRecord()
      pqlLookup.findByContactEmail.mockResolvedValue(detection)

      const result = await service.processDealClosed(event)

      expect(result).not.toBeNull()
      expect(result!.dealId).toBe('deal-123')
      expect(result!.dealValue).toBe(12000)
      expect(result!.pqlDetectionId).toBe('detection-001')
      expect(attributionRepo.save).toHaveBeenCalledTimes(1)
    })

    it('should emit DealAttributed event on successful attribution', async () => {
      const event = createDealClosedEvent()
      pqlLookup.findByContactEmail.mockResolvedValue(createPQLDetectionRecord())

      await service.processDealClosed(event)

      expect(onDealAttributed).toHaveBeenCalledTimes(1)
      const emitted = onDealAttributed.mock.calls[0][0]
      expect(emitted.dealId).toBe('deal-123')
      expect(emitted.dealValue).toBe(12000)
    })

    it('should calculate time-to-close in days', async () => {
      const event = createDealClosedEvent({ closedAt: new Date('2026-02-15') })
      const detection = createPQLDetectionRecord({ createdAt: new Date('2026-01-15') })
      pqlLookup.findByContactEmail.mockResolvedValue(detection)

      const result = await service.processDealClosed(event)

      expect(result).not.toBeNull()
      // Jan 15 to Feb 15 = 31 days
      expect(result!.timeToClose).toBe(31)
    })

    it('should calculate attribution confidence based on time and score', async () => {
      const event = createDealClosedEvent({ closedAt: new Date('2026-02-15') })
      const detection = createPQLDetectionRecord({
        createdAt: new Date('2026-01-15'),
        score: 0.85,
      })
      pqlLookup.findByContactEmail.mockResolvedValue(detection)

      const result = await service.processDealClosed(event)

      expect(result).not.toBeNull()
      expect(result!.confidence).toBeGreaterThan(0)
      expect(result!.confidence).toBeLessThanOrEqual(1)
    })

    // ── Duplicate prevention ──────────────────────────────────────────────

    it('should return existing attribution when deal is already attributed', async () => {
      const existingAttribution: Attribution = {
        id: 'attr-existing',
        tenantId: 'tenant-001',
        pqlDetectionId: 'detection-001',
        dialogId: 'dialog-001',
        dealId: 'deal-123',
        dealValue: 12000,
        closedAt: new Date('2026-02-15'),
        timeToClose: 31,
        operatorId: 'user-789',
        confidence: 0.55,
        createdAt: new Date(),
      }
      attributionRepo.findByDealId.mockResolvedValue(existingAttribution)

      const event = createDealClosedEvent()
      const result = await service.processDealClosed(event)

      expect(result).toBe(existingAttribution)
      expect(attributionRepo.save).not.toHaveBeenCalled()
      expect(onDealAttributed).not.toHaveBeenCalled()
    })

    // ── No matching PQL detection ─────────────────────────────────────────

    it('should return null when no PQL detection found for contact', async () => {
      const event = createDealClosedEvent()
      pqlLookup.findByContactEmail.mockResolvedValue(null)

      const result = await service.processDealClosed(event)

      expect(result).toBeNull()
      expect(attributionRepo.save).not.toHaveBeenCalled()
      expect(onDealAttributed).not.toHaveBeenCalled()
    })

    it('should return null when deal has no contact email', async () => {
      const event = createDealClosedEvent({ contactEmail: null })

      const result = await service.processDealClosed(event)

      expect(result).toBeNull()
      expect(pqlLookup.findByContactEmail).not.toHaveBeenCalled()
      expect(attributionRepo.save).not.toHaveBeenCalled()
    })

    it('should return null when tenant not found for amoCRM account', async () => {
      tenantLookup.findByAmoCRMAccountId.mockResolvedValue(null)

      const event = createDealClosedEvent()
      const result = await service.processDealClosed(event)

      expect(result).toBeNull()
      expect(attributionRepo.save).not.toHaveBeenCalled()
    })

    // ── Attribution value calculation ─────────────────────────────────────

    it('should preserve deal value in attribution record', async () => {
      const event = createDealClosedEvent({ dealValue: 50000 })
      pqlLookup.findByContactEmail.mockResolvedValue(createPQLDetectionRecord())

      const result = await service.processDealClosed(event)

      expect(result).not.toBeNull()
      const savedInput = attributionRepo.save.mock.calls[0][0]
      expect(savedInput.dealValue).toBe(50000)
    })

    it('should set operator from responsible user', async () => {
      const event = createDealClosedEvent({ responsibleUserId: 'operator-abc' })
      pqlLookup.findByContactEmail.mockResolvedValue(createPQLDetectionRecord())

      const result = await service.processDealClosed(event)

      expect(result).not.toBeNull()
      const savedInput = attributionRepo.save.mock.calls[0][0]
      expect(savedInput.operatorId).toBe('operator-abc')
    })
  })

  // ── Manual link creation ────────────────────────────────────────────────

  describe('linkDetectionToDeal', () => {
    it('should create manual attribution when detection exists', async () => {
      const detection = createPQLDetectionRecord()
      pqlLookup.findById.mockResolvedValue(detection)

      const result = await service.linkDetectionToDeal(
        'detection-001',
        'deal-manual-1',
        8000,
        'operator-1',
      )

      expect(result).not.toBeNull()
      expect(result!.dealId).toBe('deal-manual-1')
      expect(result!.dealValue).toBe(8000)
      expect(result!.operatorId).toBe('operator-1')
      expect(attributionRepo.save).toHaveBeenCalledTimes(1)
    })

    it('should return null when detection not found', async () => {
      pqlLookup.findById.mockResolvedValue(null)

      const result = await service.linkDetectionToDeal(
        'nonexistent',
        'deal-1',
        5000,
        'operator-1',
      )

      expect(result).toBeNull()
      expect(attributionRepo.save).not.toHaveBeenCalled()
    })

    it('should prevent duplicate manual attribution for same deal', async () => {
      const existingAttribution: Attribution = {
        id: 'attr-existing',
        tenantId: 'tenant-001',
        pqlDetectionId: 'detection-001',
        dialogId: 'dialog-001',
        dealId: 'deal-1',
        dealValue: 5000,
        closedAt: new Date(),
        timeToClose: 10,
        operatorId: 'operator-1',
        confidence: 0.7,
        createdAt: new Date(),
      }
      attributionRepo.findByDealId.mockResolvedValue(existingAttribution)

      const result = await service.linkDetectionToDeal(
        'detection-001',
        'deal-1',
        5000,
        'operator-1',
      )

      expect(result).toBe(existingAttribution)
      expect(attributionRepo.save).not.toHaveBeenCalled()
    })

    it('should emit DealAttributed event on manual link', async () => {
      pqlLookup.findById.mockResolvedValue(createPQLDetectionRecord())

      await service.linkDetectionToDeal(
        'detection-001',
        'deal-manual-1',
        8000,
        'operator-1',
      )

      expect(onDealAttributed).toHaveBeenCalledTimes(1)
    })
  })
})
