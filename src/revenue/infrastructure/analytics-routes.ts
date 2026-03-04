/**
 * Analytics REST API routes — FR-08 Basic Analytics Dashboard
 * Mounts on /api/analytics (see server.ts)
 *
 * Authentication: Bearer JWT via tenant middleware (ADR-007).
 * All routes require a valid operator session with ADMIN role.
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { AnalyticsService, PeriodFilter } from '@revenue/application/services/analytics-service'

const PeriodSchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
})

const DaysSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
})

/**
 * Middleware: require ADMIN role for analytics endpoints.
 */
const requireAdmin: RequestHandler = (req, res, next) => {
  const tenantReq = req as TenantRequest
  if (tenantReq.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

export function createAnalyticsRouter(pool: Pool): Router {
  const router = Router()
  const analyticsService = new AnalyticsService(pool)

  // All analytics routes require ADMIN role
  router.use(requireAdmin)

  /**
   * GET /api/analytics/dashboard?period=7d|30d|90d
   * Main dashboard metrics — all-in-one endpoint.
   */
  const getDashboard: RequestHandler = async (req, res) => {
    try {
      const parsed = PeriodSchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      const metrics = await analyticsService.getDashboardMetrics(
        tenantReq.tenantId,
        parsed.data.period as PeriodFilter,
      )
      return res.json(metrics)
    } catch (err) {
      console.error('[analytics-routes] getDashboard error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/analytics/dialogs-by-channel
   * Channel distribution (all time).
   */
  const getDialogsByChannel: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const data = await analyticsService.getDialogsByChannel(tenantReq.tenantId)
      return res.json(data)
    } catch (err) {
      console.error('[analytics-routes] getDialogsByChannel error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/analytics/pql-by-tier
   * PQL tier distribution (all time).
   */
  const getPQLByTier: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const data = await analyticsService.getPQLByTier(tenantReq.tenantId)
      return res.json(data)
    } catch (err) {
      console.error('[analytics-routes] getPQLByTier error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/analytics/daily-trend?days=30
   * Daily dialog creation trend.
   */
  const getDailyTrend: RequestHandler = async (req, res) => {
    try {
      const parsed = DaysSchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      const data = await analyticsService.getDailyTrend(tenantReq.tenantId, parsed.data.days)
      return res.json({ dailyTrend: data })
    } catch (err) {
      console.error('[analytics-routes] getDailyTrend error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.get('/dashboard', getDashboard)
  router.get('/dialogs-by-channel', getDialogsByChannel)
  router.get('/pql-by-tier', getPQLByTier)
  router.get('/daily-trend', getDailyTrend)

  return router
}
