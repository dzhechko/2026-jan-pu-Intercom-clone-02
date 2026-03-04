/**
 * Tenant isolation middleware.
 * Sets PostgreSQL RLS context from JWT tenant_id claim.
 * Reference: ADR-007, FF-03
 *
 * CRITICAL: Every request MUST pass through this middleware before DB access.
 * RLS policies use current_setting('app.tenant_id') for row filtering.
 */
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { Pool } from 'pg'

export interface TenantRequest extends Request {
  tenantId: string
  operatorId: string
  role: 'ADMIN' | 'OPERATOR'
}

export function createTenantMiddleware(pool: Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' })
    }

    const token = authHeader.slice(7)

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
        tenantId: string
        operatorId: string
        role: 'ADMIN' | 'OPERATOR'
      }

      // Set RLS context — CRITICAL for tenant isolation (FF-03)
      const client = await pool.connect()
      try {
        await client.query(`SET app.tenant_id = '${payload.tenantId}'`)
      } finally {
        client.release()
      }

      ;(req as TenantRequest).tenantId = payload.tenantId
      ;(req as TenantRequest).operatorId = payload.operatorId
      ;(req as TenantRequest).role = payload.role

      next()
    } catch {
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
}
