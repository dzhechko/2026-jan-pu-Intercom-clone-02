/**
 * PQL Detector Service tests — FR-02 PQL Flag in Dialog.
 * Tests the analyze() pipeline: message -> RuleEngine -> tier -> persist -> emit.
 *
 * Reference: docs/pseudocode.md PS-01
 */
import { PQLDetectorService, PQLDetection, PQLDetectionRepository, DialogPQLUpdater, MessageEvent } from './pql-detector-service'

// ─── Mock repositories ──────────────────────────────────────────────────────

function createMockDetectionRepo(): jest.Mocked<PQLDetectionRepository> {
  return {
    save: jest.fn().mockImplementation(async (d: PQLDetection) => d),
    findByDialogId: jest.fn().mockResolvedValue([]),
    findByTenantId: jest.fn().mockResolvedValue([]),
  }
}

function createMockDialogUpdater(): jest.Mocked<DialogPQLUpdater> {
  return {
    updatePQLScore: jest.fn().mockResolvedValue(null),
  }
}

function createMessageEvent(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    messageId: 'msg-001',
    dialogId: 'dlg-001',
    tenantId: 'tenant-001',
    content: 'Hello, just browsing',
    senderType: 'CLIENT',
    ...overrides,
  }
}

describe('PQLDetectorService', () => {
  let service: PQLDetectorService
  let detectionRepo: jest.Mocked<PQLDetectionRepository>
  let dialogUpdater: jest.Mocked<DialogPQLUpdater>

  beforeEach(() => {
    detectionRepo = createMockDetectionRepo()
    dialogUpdater = createMockDialogUpdater()
    service = new PQLDetectorService(detectionRepo, dialogUpdater)
  })

  // ── Sender type filtering ──────────────────────────────────────────────────

  it('should return null for OPERATOR messages', async () => {
    const event = createMessageEvent({ senderType: 'OPERATOR' })
    const result = await service.analyze(event)
    expect(result).toBeNull()
    expect(detectionRepo.save).not.toHaveBeenCalled()
    expect(dialogUpdater.updatePQLScore).not.toHaveBeenCalled()
  })

  it('should return null for BOT messages', async () => {
    const event = createMessageEvent({ senderType: 'BOT' })
    const result = await service.analyze(event)
    expect(result).toBeNull()
  })

  // ── No signals ────────────────────────────────────────────────────────────

  it('should return null when no PQL signals are detected', async () => {
    const event = createMessageEvent({ content: 'Hello, just browsing' })
    const result = await service.analyze(event)
    expect(result).toBeNull()
    expect(detectionRepo.save).not.toHaveBeenCalled()
  })

  // ── Signal detection ──────────────────────────────────────────────────────

  it('should detect PQL signals in a purchase-intent message', async () => {
    const event = createMessageEvent({
      content: 'Хотим оформить договор и оплатить счёт за enterprise тариф',
    })
    const result = await service.analyze(event)

    expect(result).not.toBeNull()
    expect(result!.signals.length).toBeGreaterThan(0)
    expect(result!.score).toBeGreaterThan(0)
    expect(result!.dialogId).toBe('dlg-001')
    expect(result!.tenantId).toBe('tenant-001')
    expect(result!.messageId).toBe('msg-001')
  })

  it('should persist detection to repository', async () => {
    const event = createMessageEvent({
      content: 'Нужен enterprise тариф для команды из 50 пользователей',
    })
    await service.analyze(event)

    expect(detectionRepo.save).toHaveBeenCalledTimes(1)
    const saved = detectionRepo.save.mock.calls[0][0]
    expect(saved.dialogId).toBe('dlg-001')
    expect(saved.signals.length).toBeGreaterThan(0)
  })

  it('should update dialog PQL score via DialogPQLUpdater', async () => {
    const event = createMessageEvent({
      content: 'Интересует enterprise тариф и интеграция с API',
    })
    await service.analyze(event)

    expect(dialogUpdater.updatePQLScore).toHaveBeenCalledTimes(1)
    const [dialogId, score, tier] = dialogUpdater.updatePQLScore.mock.calls[0]
    expect(dialogId).toBe('dlg-001')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
    expect(['HOT', 'WARM', 'COLD']).toContain(tier)
  })

  // ── Tier classification ───────────────────────────────────────────────────

  it('should classify HOT tier for high-intent messages (score >= 0.80)', async () => {
    // Trigger many signals: PURCHASE(0.60) + ENTERPRISE(0.50) + PRICING(0.40) + DEMO(0.45) + BUDGET(0.45) + MIGRATION(0.45)
    const event = createMessageEvent({
      content: 'Хотим оформить договор на enterprise тариф, нужно демо, обсудить бюджет на квартал и перейти с другой системы',
    })
    const result = await service.analyze(event)

    expect(result).not.toBeNull()
    expect(result!.score).toBeGreaterThanOrEqual(0.80)
    expect(result!.tier).toBe('HOT')
  })

  it('should classify COLD tier for low-intent messages', async () => {
    // Single weak signal
    const event = createMessageEvent({
      content: 'Расскажите про SLA',
    })
    const result = await service.analyze(event)

    expect(result).not.toBeNull()
    expect(result!.tier).toBe('COLD')
  })

  // ── Top signals extraction ────────────────────────────────────────────────

  it('should extract top 3 signals sorted by weight', async () => {
    const event = createMessageEvent({
      content: 'Enterprise тариф, нужен договор, демо, интеграция и SLA',
    })
    const result = await service.analyze(event)

    expect(result).not.toBeNull()
    expect(result!.topSignals.length).toBeLessThanOrEqual(3)

    for (let i = 1; i < result!.topSignals.length; i++) {
      expect(result!.topSignals[i - 1].weight).toBeGreaterThanOrEqual(
        result!.topSignals[i].weight,
      )
    }
  })

  // ── Detection record structure ────────────────────────────────────────────

  it('should generate a unique detection ID', async () => {
    const event1 = createMessageEvent({
      messageId: 'msg-001',
      content: 'Enterprise тариф',
    })
    const event2 = createMessageEvent({
      messageId: 'msg-002',
      content: 'Нужна интеграция с API',
    })

    const result1 = await service.analyze(event1)
    const result2 = await service.analyze(event2)

    expect(result1).not.toBeNull()
    expect(result2).not.toBeNull()
    expect(result1!.id).not.toBe(result2!.id)
  })

  it('should include createdAt timestamp in detection', async () => {
    const event = createMessageEvent({
      content: 'Enterprise тариф',
    })
    const before = new Date()
    const result = await service.analyze(event)
    const after = new Date()

    expect(result).not.toBeNull()
    expect(result!.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(result!.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('should handle empty content gracefully', async () => {
    const event = createMessageEvent({ content: '' })
    const result = await service.analyze(event)
    expect(result).toBeNull()
  })

  it('should handle emoji in content', async () => {
    const event = createMessageEvent({
      content: '🔥 Нужен Enterprise тариф! 🚀',
    })
    const result = await service.analyze(event)
    expect(result).not.toBeNull()
    expect(result!.signals.some((s) => s.type === 'ENTERPRISE')).toBe(true)
  })
})
