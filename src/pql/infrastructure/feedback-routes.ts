/**
 * PQL Feedback Routes — FR-10: operator feedback on PQL detections.
 * Mounts under /api/pql (see server.ts)
 *
 * POST /api/pql/detections/:id/feedback — submit feedback
 * GET  /api/pql/feedback/stats          — feedback statistics
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { MLTrainingService, FeedbackLabel } from '@pql/application/services/ml-training-service'

const FeedbackSchema = z.object({
  label: z.enum(['CORRECT', 'INCORRECT', 'UNSURE']),
  comment: z.string().max(500).optional(),
})

export function createFeedbackRouter(pool: Pool): Router {
  const router = Router()
  const trainingService = new MLTrainingService(pool)

  /**
   * POST /api/pql/detections/:id/feedback
   * Submit operator feedback for a PQL detection.
   */
  const submitFeedback: RequestHandler = async (req, res) => {
    try {
      const { tenantId, operatorId } = req as TenantRequest
      const detectionId = req.params.id

      const parsed = FeedbackSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid feedback', details: parsed.error.flatten() })
      }

      const feedback = await trainingService.submitFeedback(
        detectionId,
        tenantId,
        operatorId,
        parsed.data.label as FeedbackLabel,
        parsed.data.comment,
      )

      return res.status(201).json({ feedback })
    } catch (err) {
      console.error('[feedback-routes] submitFeedback error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/pql/feedback/stats
   * Get feedback statistics for the authenticated tenant.
   */
  const getFeedbackStats: RequestHandler = async (req, res) => {
    try {
      const { tenantId } = req as TenantRequest
      const stats = await trainingService.getFeedbackStats(tenantId)
      return res.json({ stats })
    } catch (err) {
      console.error('[feedback-routes] getFeedbackStats error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.post('/detections/:id/feedback', submitFeedback)
  router.get('/feedback/stats', getFeedbackStats)

  return router
}
