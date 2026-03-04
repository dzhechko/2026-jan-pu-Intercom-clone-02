/**
 * PQL REST API routes — BC-02 PQL Detection Context
 * Mounts on /api/pql (see server.ts)
 *
 * Authentication: Bearer JWT via tenant middleware (ADR-007).
 * All routes require a valid operator session.
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { PgPQLDetectionRepository } from './repositories/pql-detection-repository'

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export function createPQLRouter(pool: Pool): Router {
  const router = Router()
  const detectionRepo = new PgPQLDetectionRepository(pool)

  /**
   * GET /api/pql/detections/:dialogId
   * Get all PQL detections for a specific dialog.
   */
  const getDetectionsByDialog: RequestHandler = async (req, res) => {
    try {
      const detections = await detectionRepo.findByDialogId(req.params.dialogId)
      return res.json({ detections })
    } catch (err) {
      console.error('[pql-routes] getDetectionsByDialog error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/pql/detections
   * List recent PQL detections for the authenticated tenant.
   */
  const listDetections: RequestHandler = async (req, res) => {
    try {
      const parsed = PaginationSchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      const detections = await detectionRepo.findByTenantId(tenantReq.tenantId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      })
      return res.json({ detections })
    } catch (err) {
      console.error('[pql-routes] listDetections error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.get('/detections/:dialogId', getDetectionsByDialog)
  router.get('/detections', listDetections)

  return router
}
