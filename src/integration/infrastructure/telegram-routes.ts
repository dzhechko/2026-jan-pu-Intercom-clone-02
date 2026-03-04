/**
 * Telegram webhook & management routes — FR-05 Telegram Channel
 *
 * Routes:
 *   POST /api/webhooks/telegram      — webhook endpoint (no auth, called by Telegram)
 *   POST /api/telegram/setup         — register webhook URL (requires auth)
 *   GET  /api/telegram/status        — check bot connection (requires auth)
 */
import { Router, Request, Response, RequestHandler } from 'express'
import { Pool, PoolClient } from 'pg'
import { Server as SocketIOServer } from 'socket.io'
import { TelegramBotService } from '@integration/services/telegram-bot-service'
import { TelegramAdapter, TelegramUpdate } from '@integration/adapters/telegram-adapter'
import { TenantRequest } from '@shared/middleware/tenant.middleware'

/** UUID v4 format validation (FF-03: never trust external tenant input) */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Webhook route — mounted BEFORE auth middleware in server.ts.
 * Telegram sends POST requests here directly; no JWT required.
 */
export function createTelegramWebhookRouter(
  pool: Pool,
  io: SocketIOServer,
  botService?: TelegramBotService | null,
): Router {
  const router = Router()

  const handleWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
      const update = req.body as TelegramUpdate

      if (!update || !update.update_id) {
        return res.status(400).json({ error: 'Invalid Telegram update' })
      }

      if (!botService) {
        console.error('[telegram-routes] TelegramBotService not configured')
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

      // Validate tenantId is a proper UUID to prevent injection (FF-03)
      if (!UUID_REGEX.test(tenantId)) {
        console.error('[telegram-routes] Invalid tenantId format:', tenantId)
        return res.status(400).json({ error: 'Invalid tenantId format' })
      }

      // Acquire a tenant-scoped DB client with RLS context (FF-03, ADR-007)
      let client: PoolClient | null = null
      try {
        client = await pool.connect()
        await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId])

        // Pass tenant-scoped client as pool — PoolClient.query() is compatible with Pool.query()
        const adapter = new TelegramAdapter(client as unknown as Pool, io, botService, tenantId)
        const handled = await adapter.handleUpdate(update)

        // Always respond 200 to Telegram to avoid retries
        return res.json({ ok: true, handled })
      } finally {
        if (client) client.release()
      }
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
export function createTelegramManagementRouter(
  botService?: TelegramBotService | null,
): Router {
  const router = Router()

  const setupWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
      const tenantReq = req as TenantRequest
      const { webhookUrl } = req.body as { webhookUrl?: string }

      if (!webhookUrl) {
        return res.status(400).json({ error: 'webhookUrl is required' })
      }

      if (!botService) {
        return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured' })
      }

      const url = new URL(webhookUrl)
      url.searchParams.set('tenantId', tenantReq.tenantId)

      const result = await botService.setWebhook(url.toString())
      return res.json({ ok: result.ok, description: result.description })
    } catch (err) {
      console.error('[telegram-routes] setup error', err)
      return res.status(500).json({ error: 'Failed to set webhook' })
    }
  }

  const getStatus: RequestHandler = async (_req: Request, res: Response) => {
    try {
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
