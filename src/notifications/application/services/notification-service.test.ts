/**
 * Notification Service tests — FR-11 PQL Pulse Notifications.
 * Tests tier-based routing (HOT/WARM/COLD), duplicate prevention,
 * and notification formatting.
 *
 * Reference: FR-11
 */
import { NotificationService, PushEmitter } from './notification-service'
import { Notification, PQLNotificationPayload } from '@notifications/domain/notification'
import { NotificationRepository } from '@notifications/infrastructure/repositories/notification-repository'
import { EmailService, EmailPayload } from '@notifications/infrastructure/email-service'

// ─── Mock factories ──────────────────────────────────────────────────────────

function createMockNotificationRepo(): jest.Mocked<NotificationRepository> {
  return {
    save: jest.fn().mockImplementation(async (n: Notification) => n),
    findByDialogId: jest.fn().mockResolvedValue([]),
    findByOperatorId: jest.fn().mockResolvedValue([]),
    countUnread: jest.fn().mockResolvedValue(0),
    markAsRead: jest.fn().mockResolvedValue(true),
  }
}

function createMockEmailService(): jest.Mocked<EmailService> {
  return {
    send: jest.fn().mockResolvedValue(true),
  }
}

function createMockPushEmitter(): jest.Mocked<PushEmitter> {
  const emitFn = jest.fn()
  return {
    toRoom: jest.fn(() => ({ emit: emitFn })),
    _emitFn: emitFn,
  } as unknown as jest.Mocked<PushEmitter> & { _emitFn: jest.Mock }
}

function createHotDetection(overrides: Partial<PQLNotificationPayload> = {}): PQLNotificationPayload {
  return {
    detectionId: 'det-001',
    dialogId: 'dlg-001',
    tenantId: 'tenant-001',
    score: 0.92,
    tier: 'HOT',
    topSignals: [
      { ruleId: 'r1', type: 'PURCHASE', weight: 0.6, matchedText: 'buy' },
      { ruleId: 'r2', type: 'ENTERPRISE', weight: 0.5, matchedText: 'enterprise' },
    ],
    contactEmail: 'lead@example.com',
    assignedOperatorId: 'op-001',
    ...overrides,
  }
}

function createWarmDetection(overrides: Partial<PQLNotificationPayload> = {}): PQLNotificationPayload {
  return {
    ...createHotDetection(),
    score: 0.72,
    tier: 'WARM',
    ...overrides,
  }
}

function createColdDetection(overrides: Partial<PQLNotificationPayload> = {}): PQLNotificationPayload {
  return {
    ...createHotDetection(),
    score: 0.35,
    tier: 'COLD',
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let service: NotificationService
  let repo: jest.Mocked<NotificationRepository>
  let emailService: jest.Mocked<EmailService>
  let pushEmitter: jest.Mocked<PushEmitter> & { _emitFn: jest.Mock }

  beforeEach(() => {
    repo = createMockNotificationRepo()
    emailService = createMockEmailService()
    pushEmitter = createMockPushEmitter() as jest.Mocked<PushEmitter> & { _emitFn: jest.Mock }
    service = new NotificationService({
      notificationRepo: repo,
      emailService,
      pushEmitter,
    })
  })

  // ── HOT tier ────────────────────────────────────────────────────────────────

  describe('HOT tier detection', () => {
    it('should send push notification + email for HOT tier', async () => {
      const detection = createHotDetection()
      const result = await service.processNewPQLDetection(detection)

      // Should create 2 notifications: push + email
      expect(result).toHaveLength(2)
      expect(result[0].channel).toBe('push')
      expect(result[1].channel).toBe('email')

      // Push emitter should be called
      expect(pushEmitter.toRoom).toHaveBeenCalledWith('operator:op-001')
      expect(pushEmitter._emitFn).toHaveBeenCalledWith(
        'notification:pql',
        expect.objectContaining({
          type: 'pql_detected',
          dialogId: 'dlg-001',
          tier: 'HOT',
        }),
      )

      // Email service should be called
      expect(emailService.send).toHaveBeenCalledTimes(1)
      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('HOT'),
        }),
      )

      // Repo should save 2 notifications
      expect(repo.save).toHaveBeenCalledTimes(2)
    })

    it('should emit to tenant room if no operator assigned', async () => {
      const detection = createHotDetection({ assignedOperatorId: null })
      await service.processNewPQLDetection(detection)

      expect(pushEmitter.toRoom).toHaveBeenCalledWith('tenant:tenant-001')
    })
  })

  // ── WARM tier ───────────────────────────────────────────────────────────────

  describe('WARM tier detection', () => {
    it('should send push notification only for WARM tier (no email)', async () => {
      const detection = createWarmDetection()
      const result = await service.processNewPQLDetection(detection)

      // Should create 1 notification: push only
      expect(result).toHaveLength(1)
      expect(result[0].channel).toBe('push')

      // Push emitter should be called
      expect(pushEmitter.toRoom).toHaveBeenCalled()
      expect(pushEmitter._emitFn).toHaveBeenCalledWith(
        'notification:pql',
        expect.objectContaining({
          type: 'pql_detected',
          tier: 'WARM',
        }),
      )

      // Email should NOT be called
      expect(emailService.send).not.toHaveBeenCalled()

      // Repo should save 1 notification
      expect(repo.save).toHaveBeenCalledTimes(1)
    })
  })

  // ── COLD tier ───────────────────────────────────────────────────────────────

  describe('COLD tier detection', () => {
    it('should not send any notifications for COLD tier', async () => {
      const detection = createColdDetection()
      const result = await service.processNewPQLDetection(detection)

      expect(result).toHaveLength(0)
      expect(pushEmitter.toRoom).not.toHaveBeenCalled()
      expect(emailService.send).not.toHaveBeenCalled()
      expect(repo.save).not.toHaveBeenCalled()
    })
  })

  // ── Duplicate prevention ─────────────────────────────────────────────────────

  describe('duplicate prevention', () => {
    it('should not send duplicate push notifications for the same dialog', async () => {
      // Simulate existing notification for this dialog
      repo.findByDialogId.mockResolvedValueOnce([
        {
          id: 'existing-001',
          tenantId: 'tenant-001',
          operatorId: 'op-001',
          type: 'pql_detected',
          channel: 'push',
          dialogId: 'dlg-001',
          title: 'Hot PQL Lead Detected',
          body: 'Score: 85%',
          metadata: { score: 0.85, tier: 'HOT' },
          read: false,
          createdAt: new Date(),
        },
      ])

      const detection = createHotDetection()
      const result = await service.processNewPQLDetection(detection)

      expect(result).toHaveLength(0)
      expect(pushEmitter.toRoom).not.toHaveBeenCalled()
      expect(emailService.send).not.toHaveBeenCalled()
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('should send notifications for different dialogs', async () => {
      // First detection
      const detection1 = createHotDetection({ dialogId: 'dlg-001' })
      await service.processNewPQLDetection(detection1)

      // Second detection for a different dialog — repo returns empty for new dialog
      repo.findByDialogId.mockResolvedValueOnce([])
      const detection2 = createHotDetection({ dialogId: 'dlg-002' })
      const result = await service.processNewPQLDetection(detection2)

      expect(result).toHaveLength(2) // push + email
    })
  })

  // ── Notification formatting ──────────────────────────────────────────────────

  describe('notification formatting', () => {
    it('should include score, tier, and top signals in notification body', async () => {
      const detection = createHotDetection()
      const result = await service.processNewPQLDetection(detection)

      const pushNotification = result[0]
      expect(pushNotification.title).toContain('Hot')
      expect(pushNotification.body).toContain('92%')
      expect(pushNotification.body).toContain('PURCHASE')
      expect(pushNotification.body).toContain('ENTERPRISE')
      expect(pushNotification.metadata.tier).toBe('HOT')
      expect(pushNotification.metadata.score).toBe(0.92)
    })

    it('should include contact email in metadata when available', async () => {
      const detection = createHotDetection({ contactEmail: 'ceo@bigco.com' })
      const result = await service.processNewPQLDetection(detection)

      expect(result[0].metadata.contactEmail).toBe('ceo@bigco.com')
    })

    it('should handle missing contact email gracefully', async () => {
      const detection = createWarmDetection({ contactEmail: null })
      const result = await service.processNewPQLDetection(detection)

      expect(result[0].metadata.contactEmail).toBeNull()
    })
  })

  // ── Push payload structure ──────────────────────────────────────────────────

  describe('push payload structure', () => {
    it('should emit correct Socket.io payload shape', async () => {
      const detection = createWarmDetection()
      await service.processNewPQLDetection(detection)

      expect(pushEmitter._emitFn).toHaveBeenCalledWith('notification:pql', {
        type: 'pql_detected',
        dialogId: 'dlg-001',
        score: 0.72,
        tier: 'WARM',
        topSignals: [
          { type: 'PURCHASE', weight: 0.6 },
          { type: 'ENTERPRISE', weight: 0.5 },
        ],
        contactEmail: 'lead@example.com',
        timestamp: expect.any(String),
      })
    })
  })
})
