/**
 * Socket.io WebSocket handler — BC-01 Conversation Context
 * Namespace: /chat
 *
 * Room strategy (ADR-005, PO-03):
 *   - Operators join: tenant:{tenantId}
 *   - Clients join:   dialog:{dialogId}
 *
 * Events (client → server):
 *   client:message  — visitor sends a message from the widget
 *   operator:message — operator replies from the workspace
 *   dialog:assign   — operator claims a dialog
 *   typing          — typing indicator (client or operator)
 *
 * Events (server → client):
 *   message:new     — new message broadcast
 *   dialog:created  — new dialog notification for operators
 *   dialog:assigned — assignment notification
 *   typing          — forwarded typing indicator
 *   error           — validation / auth error
 */
import { Server as SocketIOServer, Namespace, Socket } from 'socket.io'
import { z } from 'zod'
import { Pool } from 'pg'
import { DialogRepository } from './repositories/dialog-repository'
import { MessageRepository } from './repositories/message-repository'
import { PQLDetectorService, MessageEvent } from '@pql/application/services/pql-detector-service'
import { analyzePQLInline } from '@pql/infrastructure/message-consumer'
import { NotificationService } from '@notifications/application/services/notification-service'
import { forwardToTelegramIfNeeded } from '@integration/adapters/telegram-outbound'
import { forwardToVKMaxIfNeeded } from '@integration/adapters/vkmax-outbound'

// ─── Zod schemas ────────────────────────────────────────────────────────────

const ClientMessageSchema = z.object({
  tenantId: z.string().uuid(),
  content: z.string().min(1).max(10_000),
  externalChannelId: z.string().min(1),   // widget session id
  contactEmail: z.string().email().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const OperatorMessageSchema = z.object({
  dialogId: z.string().uuid(),
  tenantId: z.string().uuid(),
  content: z.string().min(1).max(10_000),
})

const DialogAssignSchema = z.object({
  dialogId: z.string().uuid(),
  tenantId: z.string().uuid(),
  operatorId: z.string().uuid(),
})

const TypingSchema = z.object({
  dialogId: z.string().uuid(),
  tenantId: z.string().uuid(),
  isTyping: z.boolean(),
  senderType: z.enum(['CLIENT', 'OPERATOR']),
})

// ─── Handler factory ─────────────────────────────────────────────────────────

// Rate limiting map: externalChannelId → { count, resetAt }
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 10  // messages per window (SH-03)
const RATE_LIMIT_WINDOW_MS = 60_000  // 1 minute

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

/**
 * Acquire a dedicated pool client with RLS context set for the given tenant.
 * Caller MUST release the client when done.
 */
async function acquireTenantClient(pool: Pool, tenantId: string) {
  const client = await pool.connect()
  await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId])
  return client
}

export function registerChatNamespace(io: SocketIOServer, pool: Pool, pqlDetector?: PQLDetectorService, notificationService?: NotificationService): Namespace {
  const nsp: Namespace = io.of('/chat')

  nsp.on('connection', (socket: Socket) => {
    const { tenantId, operatorId, dialogId } = socket.handshake.auth as {
      tenantId?: string
      operatorId?: string
      dialogId?: string
    }

    // Operator connection: join the tenant broadcast room
    if (tenantId && operatorId) {
      socket.join(`tenant:${tenantId}`)
      socket.join(`operator:${operatorId}`)
    }

    // Widget connection: join the dialog-specific room (if resuming)
    if (dialogId) {
      socket.join(`dialog:${dialogId}`)
    }

    // ── client:message ───────────────────────────────────────────────────────
    socket.on('client:message', async (payload: unknown) => {
      const parsed = ClientMessageSchema.safeParse(payload)
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', details: parsed.error.flatten() })
        return
      }

      const { tenantId, content, externalChannelId, contactEmail, metadata } = parsed.data

      // SH-03: Rate limit widget messages (10 msg/min per session)
      if (!checkRateLimit(externalChannelId)) {
        socket.emit('error', { code: 'RATE_LIMITED', message: 'Too many messages. Please wait.' })
        return
      }

      const client = await acquireTenantClient(pool, tenantId)
      try {
        const dialogRepo = new DialogRepository(pool)
        const messageRepo = new MessageRepository(pool)

        // Find or create dialog for this widget session
        let dialog = await dialogRepo.findByExternalId(tenantId, externalChannelId)
        if (!dialog) {
          dialog = await dialogRepo.create({
            tenantId,
            channelType: 'WEB_CHAT',
            externalChannelId,
            contactEmail,
            metadata: metadata ?? {},
          })

          // Notify all operators in the tenant
          nsp.to(`tenant:${tenantId}`).emit('dialog:created', { dialog })
        }

        // Save message
        const message = await messageRepo.create({
          dialogId: dialog.id,
          tenantId,
          direction: 'INBOUND',
          senderType: 'CLIENT',
          content,
        })

        // Confirm receipt back to widget
        socket.join(`dialog:${dialog.id}`)
        socket.emit('message:new', { message, dialogId: dialog.id })

        // Broadcast to operators watching this tenant
        nsp.to(`tenant:${tenantId}`).emit('message:new', { message, dialog })

        // BC-02: Trigger PQL analysis on CLIENT messages (non-blocking)
        if (pqlDetector) {
          const pqlEvent: MessageEvent = {
            messageId: message.id,
            dialogId: dialog.id,
            tenantId,
            content,
            senderType: 'CLIENT',
          }
          analyzePQLInline(pqlDetector, nsp, pqlEvent, notificationService).catch((err) =>
            console.error('[ws-handler] PQL analysis error', err),
          )
        }
      } catch (err) {
        console.error('[ws-handler] client:message error', err)
        socket.emit('error', { code: 'INTERNAL_ERROR' })
      } finally {
        client.release()
      }
    })

    // ── operator:message ─────────────────────────────────────────────────────
    socket.on('operator:message', async (payload: unknown) => {
      const parsed = OperatorMessageSchema.safeParse(payload)
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', details: parsed.error.flatten() })
        return
      }

      const { dialogId, tenantId, content } = parsed.data

      const client = await acquireTenantClient(pool, tenantId)
      try {
        const dialogRepo = new DialogRepository(pool)
        const messageRepo = new MessageRepository(pool)

        const dialog = await dialogRepo.findById(dialogId)
        if (!dialog) {
          socket.emit('error', { code: 'DIALOG_NOT_FOUND' })
          return
        }

        const message = await messageRepo.create({
          dialogId,
          tenantId,
          direction: 'OUTBOUND',
          senderType: 'OPERATOR',
          content,
        })

        // Deliver to the widget (client room)
        nsp.to(`dialog:${dialogId}`).emit('message:new', { message })

        // Echo back to other operators watching this tenant
        nsp.to(`tenant:${tenantId}`).emit('message:new', { message })

        // FR-05: Forward to Telegram if this is a TELEGRAM dialog (fire-and-forget)
        forwardToTelegramIfNeeded(pool, dialogId, content).catch((err) => {
          console.error('[ws-handler] telegram forward error', err)
        })

        // FR-09: Forward to VK Max if this is a VK_MAX dialog (fire-and-forget)
        forwardToVKMaxIfNeeded(pool, dialogId, content).catch((err) => {
          console.error('[ws-handler] vkmax forward error', err)
        })
      } catch (err) {
        console.error('[ws-handler] operator:message error', err)
        socket.emit('error', { code: 'INTERNAL_ERROR' })
      } finally {
        client.release()
      }
    })

    // ── dialog:assign ─────────────────────────────────────────────────────────
    socket.on('dialog:assign', async (payload: unknown) => {
      const parsed = DialogAssignSchema.safeParse(payload)
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', details: parsed.error.flatten() })
        return
      }

      const { dialogId, tenantId, operatorId } = parsed.data

      const client = await acquireTenantClient(pool, tenantId)
      try {
        const dialogRepo = new DialogRepository(pool)
        const dialog = await dialogRepo.assignOperator(dialogId, operatorId)
        if (!dialog) {
          socket.emit('error', { code: 'DIALOG_NOT_FOUND' })
          return
        }

        // Notify all parties
        nsp.to(`tenant:${tenantId}`).emit('dialog:assigned', { dialog })
        nsp.to(`dialog:${dialogId}`).emit('dialog:assigned', { dialog })
      } catch (err) {
        console.error('[ws-handler] dialog:assign error', err)
        socket.emit('error', { code: 'INTERNAL_ERROR' })
      } finally {
        client.release()
      }
    })

    // ── typing ────────────────────────────────────────────────────────────────
    socket.on('typing', (payload: unknown) => {
      const parsed = TypingSchema.safeParse(payload)
      if (!parsed.success) return

      const { dialogId, tenantId, isTyping, senderType } = parsed.data

      if (senderType === 'CLIENT') {
        // Forward to operators
        nsp.to(`tenant:${tenantId}`).emit('typing', { dialogId, isTyping, senderType })
      } else {
        // Forward to client widget
        nsp.to(`dialog:${dialogId}`).emit('typing', { dialogId, isTyping, senderType })
      }
    })

    socket.on('disconnect', () => {
      // Socket.io cleans up room memberships automatically on disconnect
    })
  })

  return nsp
}
