/**
 * IAM HTTP routes — registration, login, profile, operator management.
 * Reference: docs/tactical-design.md — BC-05 IAM
 *
 * Public routes:  POST /api/auth/register, POST /api/auth/login
 * Protected:      GET  /api/auth/me, POST /api/auth/operators (ADMIN only)
 */
import { Router, Request, Response } from 'express'
import { Pool } from 'pg'
import { AuthService, RegisterSchema, LoginSchema, InviteOperatorSchema } from '@iam/application/services/auth-service'
import { OperatorRepository } from '@iam/infrastructure/repositories/operator-repository'
import { createTenantMiddleware, TenantRequest } from '@shared/middleware/tenant.middleware'

export function createAuthRouter(pool: Pool): Router {
  const router = Router()
  const authService = new AuthService(pool)
  const operatorRepo = new OperatorRepository(pool)
  const requireAuth = createTenantMiddleware(pool)

  // ── POST /api/auth/register ────────────────────────────────────────────────
  router.post('/register', async (req: Request, res: Response) => {
    const result = await authService.register(req.body)

    if (!result.ok) {
      const status = result.error.message.includes('duplicate') ? 409 : 400
      return res.status(status).json({ error: result.error.message })
    }

    const { tenant, operator, token } = result.value
    return res.status(201).json({
      token,
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
      operator: {
        id: operator.id,
        email: operator.email,
        name: operator.name,
        role: operator.role,
      },
    })
  })

  // ── POST /api/auth/login ───────────────────────────────────────────────────
  router.post('/login', async (req: Request, res: Response) => {
    const result = await authService.login(req.body)

    if (!result.ok) {
      // Use 401 for auth failures, 400 for validation errors
      const isAuthError = result.error.message === 'Invalid email or password'
      return res.status(isAuthError ? 401 : 400).json({ error: result.error.message })
    }

    const { operator, token } = result.value
    return res.json({
      token,
      operator: {
        id: operator.id,
        email: operator.email,
        name: operator.name,
        role: operator.role,
        tenantId: operator.tenantId,
      },
    })
  })

  // ── GET /api/auth/me ───────────────────────────────────────────────────────
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    const { operatorId } = req as TenantRequest
    const result = await operatorRepo.findById(operatorId)

    if (!result.ok) {
      return res.status(500).json({ error: 'Failed to fetch operator profile' })
    }
    if (!result.value) {
      return res.status(404).json({ error: 'Operator not found' })
    }

    const operator = result.value
    return res.json({
      id: operator.id,
      email: operator.email,
      name: operator.name,
      role: operator.role,
      tenantId: operator.tenantId,
      status: operator.status,
      createdAt: operator.createdAt,
    })
  })

  // ── POST /api/auth/operators — admin only ─────────────────────────────────
  router.post('/operators', requireAuth, async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest

    if (tenantReq.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin role required' })
    }

    const result = await authService.inviteOperator(tenantReq.tenantId, req.body)

    if (!result.ok) {
      const status = result.error.message.includes('already exists') ? 409 : 400
      return res.status(status).json({ error: result.error.message })
    }

    const operator = result.value
    return res.status(201).json({
      id: operator.id,
      email: operator.email,
      name: operator.name,
      role: operator.role,
      status: operator.status,
      tenantId: operator.tenantId,
    })
  })

  return router
}
