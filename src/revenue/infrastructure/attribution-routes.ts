/**
 * Attribution REST API routes — FR-12: Manual Attribution Management.
 * Mounts on /api/attributions (see server.ts)
 *
 * Authentication: Bearer JWT via tenant middleware (ADR-007).
 * All routes require a valid operator session.
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { AutoAttributionService } from '@revenue/application/services/auto-attribution-service'
import type { AttributionRepository } from './repositories/attribution-repository'

// ─── Validation Schemas ─────────────────────────────────────────────────────

const CreateAttributionSchema = z.object({
  detectionId: z.string().min(1, 'detectionId is required'),
  dealId: z.string().min(1, 'dealId is required'),
  dealValue: z.number().min(0, 'dealValue must be non-negative'),
})

const PeriodFilterSchema = z.object({
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
})

// ─── Router Factory ─────────────────────────────────────────────────────────

export function createAttributionRouter(
  pool: Pool,
  attributionRepo: AttributionRepository,
  attributionService: AutoAttributionService,
): Router {
  const router = Router()

  /**
   * POST /api/attributions
   * Manually create an attribution linking a PQL detection to a deal.
   */
  const createAttribution: RequestHandler = async (req, res) => {
    try {
      const parsed = CreateAttributionSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation error',
          details: parsed.error.flatten(),
        })
      }

      const tenantReq = req as TenantRequest
      const { detectionId, dealId, dealValue } = parsed.data

      const attribution = await attributionService.linkDetectionToDeal(
        detectionId,
        dealId,
        dealValue,
        tenantReq.operatorId,
      )

      if (!attribution) {
        return res.status(404).json({ error: 'PQL detection not found' })
      }

      return res.status(201).json({ attribution })
    } catch (err) {
      console.error('[attribution-routes] createAttribution error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/attributions
   * List attributions for the authenticated tenant, with optional period filter.
   */
  const listAttributions: RequestHandler = async (req, res) => {
    try {
      const parsed = PeriodFilterSchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid query params',
          details: parsed.error.flatten(),
        })
      }

      const tenantReq = req as TenantRequest
      const period =
        parsed.data.start && parsed.data.end
          ? { start: parsed.data.start, end: parsed.data.end }
          : undefined

      const attributions = await attributionRepo.findByTenantId(
        tenantReq.tenantId,
        period,
      )

      return res.json({ attributions })
    } catch (err) {
      console.error('[attribution-routes] listAttributions error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/attributions/:detectionId
   * Get attribution for a specific PQL detection.
   */
  const getByDetection: RequestHandler = async (req, res) => {
    try {
      const attribution = await attributionRepo.findByDetectionId(
        req.params.detectionId,
      )

      if (!attribution) {
        return res.status(404).json({ error: 'Attribution not found' })
      }

      return res.json({ attribution })
    } catch (err) {
      console.error('[attribution-routes] getByDetection error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * DELETE /api/attributions/:id
   * Remove an attribution record.
   */
  const deleteAttribution: RequestHandler = async (req, res) => {
    try {
      const deleted = await attributionRepo.deleteById(req.params.id)

      if (!deleted) {
        return res.status(404).json({ error: 'Attribution not found' })
      }

      return res.status(204).send()
    } catch (err) {
      console.error('[attribution-routes] deleteAttribution error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.post('/', createAttribution)
  router.get('/', listAttributions)
  router.get('/:detectionId', getByDetection)
  router.delete('/:id', deleteAttribution)

  return router
}
