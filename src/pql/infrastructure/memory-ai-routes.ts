/**
 * Memory AI Routes — FR-03: CRM context endpoints for operator sidebar.
 * Reference: docs/pseudocode.md PS-06
 *
 * GET /api/memory/:dialogId — returns CRM context for the dialog's contact
 * GET /api/memory/contact/:email — returns CRM context by email directly
 */
import { Router } from 'express'
import { Pool } from 'pg'
import { MemoryAIService } from '@pql/application/services/memory-ai-service'
import { TenantRequest } from '@shared/middleware/tenant.middleware'

export function createMemoryAIRouter(pool: Pool, memoryAIService: MemoryAIService): Router {
  const router = Router()

  /**
   * GET /api/memory/contact/:email
   * Returns CRM context for a specific email address.
   */
  router.get('/contact/:email', async (req, res) => {
    const { email } = req.params
    const { tenantId } = req as unknown as TenantRequest

    if (!email || !tenantId) {
      return res.status(400).json({ error: 'Missing email or tenant context' })
    }

    try {
      const result = await memoryAIService.fetchContext(email, tenantId)

      if (result.status === 'not_configured') {
        return res.json({ status: 'not_configured', data: null })
      }

      if (result.status === 'error') {
        return res.json({ status: 'error', error: result.error, data: null })
      }

      return res.json({ status: 'ok', data: result.data })
    } catch (error) {
      console.error('[MemoryAI] Error fetching context by email:', error)
      return res.status(500).json({ error: 'Internal server error' })
    }
  })

  /**
   * GET /api/memory/:dialogId
   * Looks up the dialog's contactEmail, then fetches CRM context.
   */
  router.get('/:dialogId', async (req, res) => {
    const { dialogId } = req.params
    const { tenantId } = req as unknown as TenantRequest

    if (!dialogId || !tenantId) {
      return res.status(400).json({ error: 'Missing dialogId or tenant context' })
    }

    try {
      // Look up dialog to get contactEmail — use tenant-scoped client for RLS (ADR-007)
      const tenantReq = req as unknown as TenantRequest
      const { rows } = await tenantReq.dbClient.query(
        'SELECT contact_email FROM conversations.dialogs WHERE id = $1',
        [dialogId],
      )

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Dialog not found' })
      }

      const contactEmail = rows[0].contact_email
      if (!contactEmail) {
        return res.json({
          status: 'ok',
          data: {
            contactEmail: null,
            deals: [],
            previousDialogCount: 0,
            tags: [],
            enrichmentScore: 0,
          },
        })
      }

      const result = await memoryAIService.fetchContext(contactEmail, tenantId)

      if (result.status === 'not_configured') {
        return res.json({ status: 'not_configured', data: null })
      }

      if (result.status === 'error') {
        return res.json({ status: 'error', error: result.error, data: null })
      }

      return res.json({ status: 'ok', data: result.data })
    } catch (error) {
      console.error('[MemoryAI] Error fetching context by dialogId:', error)
      return res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
