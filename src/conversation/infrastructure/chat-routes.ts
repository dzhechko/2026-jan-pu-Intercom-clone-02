/**
 * Chat REST API routes — BC-01 Conversation Context
 * Mounts on /api/dialogs (see server.ts)
 *
 * Authentication: Bearer JWT via tenant middleware (ADR-007).
 * All routes require a valid operator session.
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { DialogRepository } from './repositories/dialog-repository'
import { MessageRepository } from './repositories/message-repository'
import { forwardToTelegramIfNeeded } from '@integration/adapters/telegram-outbound'

const SendMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
  senderType: z.enum(['OPERATOR', 'BOT']).default('OPERATOR'),
})

const ListDialogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const MessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export function createChatRouter(pool: Pool): Router {
  const router = Router()
  const dialogRepo = new DialogRepository(pool)
  const messageRepo = new MessageRepository(pool)

  /**
   * GET /api/dialogs
   * List open dialogs for the authenticated operator's tenant.
   */
  const listDialogs: RequestHandler = async (req, res) => {
    try {
      const parsed = ListDialogsQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      const dialogs = await dialogRepo.findOpenByTenant(
        tenantReq.tenantId,
        parsed.data.limit,
        parsed.data.offset,
      )
      return res.json({ dialogs })
    } catch (err) {
      console.error('[chat-routes] listDialogs error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/dialogs/:id/messages
   * Paginated message history for a dialog.
   */
  const getMessages: RequestHandler = async (req, res) => {
    try {
      const parsed = MessagesQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() })
      }

      const dialog = await dialogRepo.findById(req.params.id)
      if (!dialog) {
        return res.status(404).json({ error: 'Dialog not found' })
      }

      const page = await messageRepo.findByDialogId(
        req.params.id,
        parsed.data.limit,
        parsed.data.offset,
      )
      return res.json(page)
    } catch (err) {
      console.error('[chat-routes] getMessages error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * POST /api/dialogs/:id/messages
   * Operator sends a message into a dialog.
   */
  const sendMessage: RequestHandler = async (req, res) => {
    try {
      const parsed = SendMessageSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest

      const dialog = await dialogRepo.findById(req.params.id)
      if (!dialog) {
        return res.status(404).json({ error: 'Dialog not found' })
      }

      const message = await messageRepo.create({
        dialogId: req.params.id,
        tenantId: tenantReq.tenantId,
        direction: 'OUTBOUND',
        senderType: parsed.data.senderType,
        content: parsed.data.content,
      })

      // FR-05: Forward to Telegram if this is a TELEGRAM dialog (fire-and-forget)
      forwardToTelegramIfNeeded(pool, req.params.id, parsed.data.content).catch((err) => {
        console.error('[chat-routes] telegram forward error', err)
      })

      return res.status(201).json({ message })
    } catch (err) {
      console.error('[chat-routes] sendMessage error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * PATCH /api/dialogs/:id/status
   * Update dialog status (e.g. close or archive).
   */
  const updateStatus: RequestHandler = async (req, res) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['OPEN', 'ASSIGNED', 'CLOSED', 'ARCHIVED']),
      })
      const parsed = statusSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
      }

      const dialog = await dialogRepo.updateStatus(req.params.id, parsed.data.status)
      if (!dialog) {
        return res.status(404).json({ error: 'Dialog not found' })
      }

      return res.json({ dialog })
    } catch (err) {
      console.error('[chat-routes] updateStatus error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.get('/', listDialogs)
  router.get('/:id/messages', getMessages)
  router.post('/:id/messages', sendMessage)
  router.patch('/:id/status', updateStatus)

  return router
}
