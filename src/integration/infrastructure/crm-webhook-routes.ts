/**
 * CRM Webhook Routes — FR-12: amoCRM Auto-Update.
 * POST /api/webhooks/amocrm — receives deal status change webhooks from amoCRM.
 *
 * IMPORTANT: This endpoint does NOT require JWT auth.
 * amoCRM sends webhooks directly; authentication is via the webhook secret
 * or IP allowlist (configured at infrastructure level).
 *
 * Flow: amoCRM webhook → ACL translation → AutoAttributionService → Revenue Report update.
 */
import { Router, Request, Response, RequestHandler } from 'express'
import { Pool } from 'pg'
import {
  AmoCRMWebhookPayload,
  isDealClosedWebhook,
  translateToDealClosedEvents,
} from './crm-webhook-types'
import { AutoAttributionService } from '@revenue/application/services/auto-attribution-service'

export function createCRMWebhookRouter(
  pool: Pool,
  attributionService: AutoAttributionService,
): Router {
  const router = Router()

  /**
   * POST /api/webhooks/amocrm
   * Receives amoCRM webhook events for deal status changes.
   * No JWT auth required — amoCRM sends directly.
   */
  const handleWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
      const payload = req.body as AmoCRMWebhookPayload

      // Validate payload structure
      if (!payload || (!payload.leads && !payload.contacts)) {
        return res.status(400).json({ error: 'Invalid webhook payload' })
      }

      // Only process deal closed/won events
      if (!isDealClosedWebhook(payload)) {
        // Acknowledge non-deal-closed events without processing
        return res.status(200).json({ status: 'ignored', reason: 'not a deal closed event' })
      }

      // ACL: Translate amoCRM types → domain events
      const dealClosedEvents = translateToDealClosedEvents(payload)

      // Process each deal closed event
      const results = await Promise.allSettled(
        dealClosedEvents.map((event) =>
          attributionService.processDealClosed(event),
        ),
      )

      const processed = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      if (failed > 0) {
        console.error(
          '[crm-webhook] Some deal attributions failed:',
          results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map((r) => r.reason),
        )
      }

      return res.status(200).json({
        status: 'ok',
        processed,
        failed,
      })
    } catch (error) {
      console.error('[crm-webhook] Webhook processing error:', error)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.post('/', handleWebhook)

  return router
}
