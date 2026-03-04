/**
 * Notification Service — FR-11 PQL Pulse Notifications.
 * Orchestrates push (Socket.io) and email notifications when PQL leads are detected.
 *
 * Tier-based behavior:
 *   HOT  — immediate push notification + email to operator (+ admin)
 *   WARM — push notification only
 *   COLD — logged, no notification sent
 *
 * Duplicate prevention: checks if a push notification was already sent for the same dialog.
 *
 * Reference: FR-11 PQL Pulse Notifications
 */
import { v4 as uuidv4 } from 'uuid'
import { Notification, PQLNotificationPayload } from '@notifications/domain/notification'
import { NotificationRepository } from '@notifications/infrastructure/repositories/notification-repository'
import { EmailService, formatPQLNotificationEmail } from '@notifications/infrastructure/email-service'

export interface PushEmitter {
  /** Emit a notification event to a specific Socket.io room */
  toRoom(room: string): { emit(event: string, payload: unknown): void }
}

export interface NotificationServiceDeps {
  notificationRepo: NotificationRepository
  emailService: EmailService
  pushEmitter: PushEmitter
}

export class NotificationService {
  private readonly repo: NotificationRepository
  private readonly email: EmailService
  private readonly push: PushEmitter

  constructor(deps: NotificationServiceDeps) {
    this.repo = deps.notificationRepo
    this.email = deps.emailService
    this.push = deps.pushEmitter
  }

  /**
   * Process a new PQL detection and send appropriate notifications.
   * Returns the notifications that were created (empty array for COLD tier).
   */
  async processNewPQLDetection(detection: PQLNotificationPayload): Promise<Notification[]> {
    const { tier, dialogId, tenantId } = detection
    const created: Notification[] = []

    // COLD tier: log only, no notifications
    if (tier === 'COLD') {
      console.log(`[notification-service] COLD PQL for dialog ${dialogId} — skipping notifications`)
      return created
    }

    // Duplicate prevention: check if we already notified for this dialog (push channel)
    const existing = await this.repo.findByDialogId(dialogId)
    const alreadyNotifiedPush = existing.some(
      (n) => n.type === 'pql_detected' && n.channel === 'push',
    )

    if (alreadyNotifiedPush) {
      console.log(`[notification-service] Already notified for dialog ${dialogId} — skipping`)
      return created
    }

    // Build notification payload for Socket.io
    const socketPayload = {
      type: 'pql_detected' as const,
      dialogId: detection.dialogId,
      score: detection.score,
      tier: detection.tier,
      topSignals: detection.topSignals.map((s) => ({ type: s.type, weight: s.weight })),
      contactEmail: detection.contactEmail ?? null,
      timestamp: new Date().toISOString(),
    }

    // Determine target room for push
    const operatorRoom = detection.assignedOperatorId
      ? `operator:${detection.assignedOperatorId}`
      : null
    const tenantRoom = `tenant:${tenantId}`

    // Send push notification
    const targetRoom = operatorRoom || tenantRoom
    this.push.toRoom(targetRoom).emit('notification:pql', socketPayload)

    // Persist push notification record
    const pushNotification = buildNotification({
      tenantId,
      operatorId: detection.assignedOperatorId || 'all',
      channel: 'push',
      detection,
    })
    await this.repo.save(pushNotification)
    created.push(pushNotification)

    // HOT tier: also send email
    if (tier === 'HOT') {
      const emailPayload = formatPQLNotificationEmail(
        {
          dialogId: detection.dialogId,
          score: detection.score,
          tier: detection.tier,
          topSignals: detection.topSignals.map((s) => ({ type: s.type, weight: s.weight })),
          contactEmail: detection.contactEmail,
        },
        { name: 'KommuniQ' },
      )

      // Send to operator (if assigned) and admin
      const recipients = [
        detection.contactEmail ? undefined : undefined, // Operator email would come from user service
      ].filter(Boolean) as string[]

      // For now, log the email (stub implementation)
      await this.email.send({
        ...emailPayload,
        to: detection.assignedOperatorId
          ? `operator-${detection.assignedOperatorId}@kommuniq.local`
          : 'admin@kommuniq.local',
      })

      // Persist email notification record
      const emailNotification = buildNotification({
        tenantId,
        operatorId: detection.assignedOperatorId || 'admin',
        channel: 'email',
        detection,
      })
      await this.repo.save(emailNotification)
      created.push(emailNotification)
    }

    console.log(
      `[notification-service] ${tier} PQL for dialog ${dialogId} — sent ${created.length} notification(s)`,
    )

    return created
  }
}

function buildNotification(params: {
  tenantId: string
  operatorId: string
  channel: 'push' | 'email'
  detection: PQLNotificationPayload
}): Notification {
  const { tenantId, operatorId, channel, detection } = params
  const tierLabel = detection.tier === 'HOT' ? 'Hot' : 'Warm'

  return {
    id: uuidv4(),
    tenantId,
    operatorId,
    type: 'pql_detected',
    channel,
    dialogId: detection.dialogId,
    title: `${tierLabel} PQL Lead Detected`,
    body: `Score: ${(detection.score * 100).toFixed(0)}% — ${detection.topSignals.map((s) => s.type).join(', ')}`,
    metadata: {
      score: detection.score,
      tier: detection.tier,
      topSignals: detection.topSignals.map((s) => ({ type: s.type, weight: s.weight })),
      contactEmail: detection.contactEmail,
    },
    read: false,
    createdAt: new Date(),
  }
}
