/**
 * VK Max webhook & management routes — FR-09 VK Max Channel
 *
 * Routes:
 *   POST /api/webhooks/vkmax      — webhook endpoint (no auth, called by VK Max)
 *   POST /api/vkmax/setup         — register webhook URL (requires auth)
 *   GET  /api/vkmax/status        — check connection status (requires auth)
 */
import { Router, Request, Response, RequestHandler } from 'express'
import { Pool } from 'pg'
import { Server as SocketIOServer } from 'socket.io'
import { VKMaxMCPService } from '@integration/services/vkmax-mcp-service'
import { VKMaxAdapter, VKMaxUpdate } from '@integration/adapters/vkmax-adapter'
import { TenantRequest } from '@shared/middleware/tenant.middleware'

/**
 * Webhook route — mounted BEFORE auth middleware in server.ts.
 * VK Max sends POST requests here directly; no JWT required.
 */
export function createVKMaxWebhookRouter(pool: Pool, io: SocketIOServer): Router {
  const router = Router()

  const handleWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
      const update = req.body as VKMaxUpdate

      if (!update || !update.type) {
        return res.status(400).json({ error: 'Invalid VK Max update' })
      }

      // VK Max confirmation callback — respond with configured string
      if (update.type === 'confirmation') {
        const confirmationToken = process.env.VKMAX_CONFIRMATION_TOKEN || 'ok'
        return res.send(confirmationToken)
      }

      const mcpService = VKMaxMCPService.fromEnv()
      if (!mcpService) {
        console.error('[vkmax-routes] VKMAX_MCP_URL or VKMAX_ACCESS_TOKEN not configured')
        return res.status(500).json({ error: 'VK Max MCP not configured' })
      }

      // Determine tenant from query param or env default
      const tenantId = (req.query.tenantId as string) || process.env.VKMAX_DEFAULT_TENANT_ID
      if (!tenantId) {
        console.error('[vkmax-routes] No tenantId for webhook')
        return res.status(400).json({ error: 'Missing tenantId' })
      }

      const adapter = new VKMaxAdapter(pool, io, mcpService, tenantId)
      const handled = await adapter.handleUpdate(update)

      // Always respond 'ok' to VK Max to avoid retries
      return res.send('ok')
    } catch (err) {
      console.error('[vkmax-routes] webhook error', err)
      // Still return 'ok' to VK Max to prevent retries
      return res.send('ok')
    }
  }

  router.post('/', handleWebhook)

  return router
}

/**
 * Management routes — mounted under auth middleware.
 * Requires valid JWT (operator/admin).
 */
export function createVKMaxManagementRouter(): Router {
  const router = Router()

  /**
   * POST /api/vkmax/setup
   * Register the webhook URL with VK Max callback server.
   */
  const setupWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
      const tenantReq = req as TenantRequest
      const { webhookUrl } = req.body as { webhookUrl?: string }

      if (!webhookUrl) {
        return res.status(400).json({ error: 'webhookUrl is required' })
      }

      const mcpService = VKMaxMCPService.fromEnv()
      if (!mcpService) {
        return res.status(500).json({ error: 'VKMAX_MCP_URL or VKMAX_ACCESS_TOKEN not configured' })
      }

      // Append tenantId as query param so the webhook knows which tenant this is for
      const url = new URL(webhookUrl)
      url.searchParams.set('tenantId', tenantReq.tenantId)

      const result = await mcpService.setWebhook(url.toString())
      return res.json({ ok: result.ok, description: result.description })
    } catch (err) {
      console.error('[vkmax-routes] setup error', err)
      return res.status(500).json({ error: 'Failed to set webhook' })
    }
  }

  /**
   * GET /api/vkmax/status
   * Check VK Max MCP connection status.
   */
  const getStatus: RequestHandler = async (_req: Request, res: Response) => {
    try {
      const mcpService = VKMaxMCPService.fromEnv()
      if (!mcpService) {
        return res.json({ connected: false, reason: 'VKMAX_MCP_URL or VKMAX_ACCESS_TOKEN not configured' })
      }

      const info = await mcpService.getStatus()
      return res.json({
        connected: info.ok,
        circuitBreakerOpen: mcpService.isCircuitOpen(),
        bot: info.result
          ? { name: info.result.name, groupId: info.result.groupId }
          : null,
      })
    } catch (err) {
      console.error('[vkmax-routes] status error', err)
      return res.json({ connected: false, reason: 'Failed to connect' })
    }
  }

  router.post('/setup', setupWebhook)
  router.get('/status', getStatus)

  return router
}
