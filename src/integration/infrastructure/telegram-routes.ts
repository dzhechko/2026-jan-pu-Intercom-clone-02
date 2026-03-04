/**
 * Telegram webhook & management routes — FR-05 Telegram Channel
 *
 * Routes:
 *   POST /api/webhooks/telegram      — webhook endpoint (no auth, called by Telegram)
 *   POST /api/telegram/setup         — register webhook URL (requires auth)
 *   GET  /api/telegram/status        — check bot connection (requires auth)
 */
import { Router, Request, Response, RequestHandler } from 'express'
import { Pool } from 'pg'
import { Server as SocketIOServer } from 'socket.io'
import { TelegramBotService } from '@integration/services/telegram-bot-service'
import { TelegramAdapter, TelegramUpdate } from '@integration/adapters/telegram-adapter'
import { TenantRequest } from '@shared/middleware/tenant.middleware'

/**
 * Webhook route — mounted BEFORE auth middleware in server.ts.
 * Telegram sends POST requests here directly; no JWT required.
 */
export function createTelegramWebhookRouter(pool: Pool, io: SocketIOServer): Router {
  const router = Router()

  const handleWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
      const update = req.body as TelegramUpdate

      if (!update || !update.update_id) {
        return res.status(400).json({ error: 'Invalid Telegram update' })
      }

      const botService = TelegramBotService.fromEnv()
      if (!botService) {
        console.error('[telegram-routes] TELEGRAM_BOT_TOKEN not configured')
        return res.status(500).json({ error: 'Telegram bot not configured' })
      }

      // Determine tenant from env or webhook path
      // For multi-tenant: the webhook URL should include tenant ID,
      // e.g., /api/webhooks/telegram?tenantId=xxx
      const tenantId = (req.query.tenantId as string) || process.env.TELEGRAM_DEFAULT_TENANT_ID
      if (!tenantId) {
        console.error('[telegram-routes] No tenantId for webhook')
        return res.status(400).json({ error: 'Missing tenantId' })
      }

      const adapter = new TelegramAdapter(pool, io, botService, tenantId)
      const handled = await adapter.handleUpdate(update)

      // Always respond 200 to Telegram to avoid retries
      return res.json({ ok: true, handled })
    } catch (err) {
      console.error('[telegram-routes] webhook error', err)
      // Still return 200 to Telegram to prevent retries
      return res.json({ ok: true, error: 'internal' })
    }
  }

  router.post('/', handleWebhook)

  return router
}

/**
 * Management routes — mounted under auth middleware.
 * Requires valid JWT (operator/admin).
 */
export function createTelegramManagementRouter(): Router {
  const router = Router()

  /**
   * POST /api/telegram/setup
   * Register the webhook URL with Telegram Bot API.
   */
  const setupWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
      const tenantReq = req as TenantRequest
      const { webhookUrl } = req.body as { webhookUrl?: string }

      if (!webhookUrl) {
        return res.status(400).json({ error: 'webhookUrl is required' })
      }

      const botService = TelegramBotService.fromEnv()
      if (!botService) {
        return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured' })
      }

      // Append tenantId as query param so the webhook knows which tenant this is for
      const url = new URL(webhookUrl)
      url.searchParams.set('tenantId', tenantReq.tenantId)

      const result = await botService.setWebhook(url.toString())
      return res.json({ ok: result.ok, description: result.description })
    } catch (err) {
      console.error('[telegram-routes] setup error', err)
      return res.status(500).json({ error: 'Failed to set webhook' })
    }
  }

  /**
   * GET /api/telegram/status
   * Check bot connection status.
   */
  const getStatus: RequestHandler = async (_req: Request, res: Response) => {
    try {
      const botService = TelegramBotService.fromEnv()
      if (!botService) {
        return res.json({ connected: false, reason: 'TELEGRAM_BOT_TOKEN not configured' })
      }

      const info = await botService.getMe()
      return res.json({
        connected: info.ok,
        bot: info.result
          ? { username: info.result.username, name: info.result.first_name }
          : null,
      })
    } catch (err) {
      console.error('[telegram-routes] status error', err)
      return res.json({ connected: false, reason: 'Failed to connect' })
    }
  }

  router.post('/setup', setupWebhook)
  router.get('/status', getStatus)

  return router
}
