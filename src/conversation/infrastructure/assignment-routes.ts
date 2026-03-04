/**
 * Assignment Routes — FR-13 Multi-operator
 * Mounts on /api (see server.ts) — shares namespace with dialog routes.
 *
 * All routes require authentication via tenant middleware.
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { AssignmentService } from '@conversation/application/services/assignment-service'

const ManualAssignSchema = z.object({
  operatorId: z.string().uuid(),
})

export function createAssignmentRouter(pool: Pool, assignmentService: AssignmentService): Router {
  const router = Router()

  /**
   * POST /api/dialogs/:id/assign — manual assignment to a specific operator.
   */
  const manualAssign: RequestHandler = async (req, res) => {
    try {
      const parsed = ManualAssignSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      const dialog = await assignmentService.reassign(
        req.params.id,
        parsed.data.operatorId,
        tenantReq.tenantId,
      )
      if (!dialog) {
        return res.status(404).json({ error: 'Dialog not found or cannot be assigned' })
      }

      return res.json({ dialog })
    } catch (err) {
      console.error('[assignment-routes] manualAssign error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * POST /api/dialogs/:id/assign-auto — auto-assign via round-robin.
   */
  const autoAssign: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const result = await assignmentService.autoAssign(req.params.id, tenantReq.tenantId)

      if (!result) {
        return res.status(404).json({ error: 'No available operator or dialog not assignable' })
      }

      return res.json({ dialog: result.dialog, operatorId: result.operatorId })
    } catch (err) {
      console.error('[assignment-routes] autoAssign error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * POST /api/dialogs/assign-next — assign next unassigned dialog to the requesting operator.
   */
  const assignNext: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const result = await assignmentService.assignNextDialog(tenantReq.tenantId)

      if (!result) {
        return res.json({ dialog: null, message: 'No unassigned dialogs in queue' })
      }

      return res.json({ dialog: result.dialog, operatorId: result.operatorId })
    } catch (err) {
      console.error('[assignment-routes] assignNext error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/assignment/queue — get unassigned dialog count.
   */
  const getQueueSize: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const count = await assignmentService.getQueueSize(tenantReq.tenantId)

      return res.json({ queueSize: count })
    } catch (err) {
      console.error('[assignment-routes] getQueueSize error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  // Dialog-scoped assignment routes
  router.post('/dialogs/:id/assign', manualAssign)
  router.post('/dialogs/:id/assign-auto', autoAssign)
  router.post('/dialogs/assign-next', assignNext)

  // Queue routes
  router.get('/assignment/queue', getQueueSize)

  return router
}
