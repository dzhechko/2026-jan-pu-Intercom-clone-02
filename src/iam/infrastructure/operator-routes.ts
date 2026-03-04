/**
 * Operator Management Routes — FR-13 Multi-operator
 * Mounts on /api/operators (see server.ts)
 *
 * All routes require authentication via tenant middleware.
 * Role changes and deactivation require ADMIN role.
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { OperatorRepository } from './repositories/operator-repository'
import { PresenceService } from '@iam/application/services/presence-service'
import Redis from 'ioredis'

const UpdateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'OPERATOR']),
})

export function createOperatorRouter(pool: Pool, redis: Redis): Router {
  const router = Router()
  const operatorRepo = new OperatorRepository(pool)
  const presenceService = new PresenceService(redis)

  /**
   * GET /api/operators — list all operators for the authenticated tenant.
   */
  const listOperators: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const result = await operatorRepo.findByTenantId(tenantReq.tenantId, tenantReq.dbClient)

      if (!result.ok) {
        return res.status(500).json({ error: 'Failed to fetch operators' })
      }

      const operators = result.value.map((op) => ({
        id: op.id,
        email: op.email,
        name: op.name,
        role: op.role,
        status: op.status,
        createdAt: op.createdAt,
      }))

      return res.json({ operators })
    } catch (err) {
      console.error('[operator-routes] listOperators error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/operators/online — list online operators for the tenant.
   */
  const listOnlineOperators: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest
      const onlineIds = await presenceService.getOnlineOperators(tenantReq.tenantId)

      // Fetch full operator details for online operators
      const result = await operatorRepo.findByTenantId(tenantReq.tenantId, tenantReq.dbClient)
      if (!result.ok) {
        return res.status(500).json({ error: 'Failed to fetch operators' })
      }

      const onlineSet = new Set(onlineIds)
      const online = result.value
        .filter((op) => onlineSet.has(op.id))
        .map((op) => ({
          id: op.id,
          email: op.email,
          name: op.name,
          role: op.role,
          status: op.status,
        }))

      return res.json({ operators: online })
    } catch (err) {
      console.error('[operator-routes] listOnlineOperators error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * PATCH /api/operators/:id/role — change operator role (admin only).
   */
  const updateRole: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest

      if (tenantReq.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin role required' })
      }

      const parsed = UpdateRoleSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
      }

      const operatorResult = await operatorRepo.findById(req.params.id, tenantReq.dbClient)
      if (!operatorResult.ok) {
        return res.status(500).json({ error: 'Failed to fetch operator' })
      }
      if (!operatorResult.value) {
        return res.status(404).json({ error: 'Operator not found' })
      }

      // Ensure operator belongs to the same tenant
      if (operatorResult.value.tenantId !== tenantReq.tenantId) {
        return res.status(404).json({ error: 'Operator not found' })
      }

      // Prevent self-demotion from ADMIN
      if (req.params.id === tenantReq.operatorId && parsed.data.role !== 'ADMIN') {
        return res.status(400).json({ error: 'Cannot change your own role' })
      }

      await tenantReq.dbClient.query(
        'UPDATE iam.operators SET role = $1 WHERE id = $2',
        [parsed.data.role, req.params.id],
      )

      return res.json({
        id: operatorResult.value.id,
        role: parsed.data.role,
      })
    } catch (err) {
      console.error('[operator-routes] updateRole error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * DELETE /api/operators/:id — deactivate operator (admin only).
   * Soft-delete: sets status to DISABLED.
   */
  const deactivateOperator: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest

      if (tenantReq.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin role required' })
      }

      // Prevent self-deactivation
      if (req.params.id === tenantReq.operatorId) {
        return res.status(400).json({ error: 'Cannot deactivate yourself' })
      }

      const operatorResult = await operatorRepo.findById(req.params.id, tenantReq.dbClient)
      if (!operatorResult.ok) {
        return res.status(500).json({ error: 'Failed to fetch operator' })
      }
      if (!operatorResult.value) {
        return res.status(404).json({ error: 'Operator not found' })
      }

      // Ensure operator belongs to the same tenant
      if (operatorResult.value.tenantId !== tenantReq.tenantId) {
        return res.status(404).json({ error: 'Operator not found' })
      }

      const result = await operatorRepo.updateStatus(req.params.id, 'DISABLED', tenantReq.dbClient)
      if (!result.ok) {
        return res.status(500).json({ error: 'Failed to deactivate operator' })
      }

      // Remove from presence
      await presenceService.setOffline(req.params.id, tenantReq.tenantId)

      return res.json({ id: req.params.id, status: 'DISABLED' })
    } catch (err) {
      console.error('[operator-routes] deactivateOperator error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/operators/:id/stats — operator stats.
   * Returns: activeDialogs, closedToday, avgResponseTime placeholder.
   */
  const getOperatorStats: RequestHandler = async (req, res) => {
    try {
      const tenantReq = req as TenantRequest

      const operatorResult = await operatorRepo.findById(req.params.id, tenantReq.dbClient)
      if (!operatorResult.ok || !operatorResult.value) {
        return res.status(404).json({ error: 'Operator not found' })
      }
      if (operatorResult.value.tenantId !== tenantReq.tenantId) {
        return res.status(404).json({ error: 'Operator not found' })
      }

      // Active dialogs (ASSIGNED to this operator) — use tenant-scoped client for RLS
      const activeResult = await tenantReq.dbClient.query(
        `SELECT COUNT(*)::int AS count FROM conversations.dialogs
         WHERE operator_id = $1 AND status = 'ASSIGNED'`,
        [req.params.id],
      )

      // Closed today — use tenant-scoped client for RLS
      const closedResult = await tenantReq.dbClient.query(
        `SELECT COUNT(*)::int AS count FROM conversations.dialogs
         WHERE operator_id = $1 AND status = 'CLOSED'
           AND updated_at >= CURRENT_DATE`,
        [req.params.id],
      )

      const isOnline = await presenceService.isOnline(req.params.id, tenantReq.tenantId)

      return res.json({
        operatorId: req.params.id,
        activeDialogs: activeResult.rows[0]?.count ?? 0,
        closedToday: closedResult.rows[0]?.count ?? 0,
        avgResponseTime: null, // Future implementation
        isOnline,
      })
    } catch (err) {
      console.error('[operator-routes] getOperatorStats error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  // Register routes — order matters: /online before /:id
  router.get('/', listOperators)
  router.get('/online', listOnlineOperators)
  router.get('/:id/stats', getOperatorStats)
  router.patch('/:id/role', updateRole)
  router.delete('/:id', deactivateOperator)

  return router
}
