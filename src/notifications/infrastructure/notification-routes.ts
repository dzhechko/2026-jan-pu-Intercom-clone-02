/**
 * Notification REST API routes — BC-06 Notification Context.
 * Mounts on /api/notifications (see server.ts).
 *
 * Authentication: Bearer JWT via tenant middleware (ADR-007).
 * Reference: FR-11 PQL Pulse Notifications
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { PgNotificationRepository } from './repositories/notification-repository'

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export function createNotificationRouter(pool: Pool): Router {
  const router = Router()
  const notificationRepo = new PgNotificationRepository(pool)

  /**
   * GET /api/notifications
   * List operator's notifications with pagination.
   */
  const listNotifications: RequestHandler = async (req, res) => {
    try {
      const parsed = PaginationSchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      const notifications = await notificationRepo.findByOperatorId(tenantReq.operatorId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      })
      return res.json({ notifications })
    } catch (err) {
      console.error('[notification-routes] listNotifications error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * PATCH /api/notifications/:id/read
   * Mark a notification as read.
   */
  const markAsRead: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const updated = await notificationRepo.markAsRead(req.params.id, tenantReq.operatorId)

      if (!updated) {
        return res.status(404).json({ error: 'Notification not found' })
      }

      return res.json({ success: true })
    } catch (err) {
      console.error('[notification-routes] markAsRead error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/notifications/unread-count
   * Get the count of unread notifications for the current operator.
   */
  const getUnreadCount: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const count = await notificationRepo.countUnread(tenantReq.operatorId)
      return res.json({ count })
    } catch (err) {
      console.error('[notification-routes] getUnreadCount error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  // Route order matters: specific paths before parameterized ones
  router.get('/unread-count', getUnreadCount)
  router.get('/', listNotifications)
  router.patch('/:id/read', markAsRead)

  return router
}
