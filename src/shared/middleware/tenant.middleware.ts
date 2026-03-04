/**
 * Tenant isolation middleware.
 * Sets PostgreSQL RLS context from JWT tenant_id claim.
 * Reference: ADR-007, FF-03
 *
 * CRITICAL: Every request MUST pass through this middleware before DB access.
 * RLS policies use current_setting('app.tenant_id') for row filtering.
 *
 * The middleware acquires a dedicated pool client for the request lifetime,
 * sets the RLS GUC on it, and releases it when the response finishes.
 * Downstream code should use req.dbClient (or pool.query with tenantId param
 * as defense-in-depth).
 */
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { Pool, PoolClient } from 'pg'
import { getJwtSecret } from '@shared/utils/jwt-secret'

export interface TenantRequest extends Request {
  tenantId: string
  operatorId: string
  role: 'ADMIN' | 'OPERATOR'
  dbClient: PoolClient
}

export function createTenantMiddleware(pool: Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' })
    }

    const token = authHeader.slice(7)

    try {
      const payload = jwt.verify(token, getJwtSecret()) as {
        tenantId: string
        operatorId: string
        role: 'ADMIN' | 'OPERATOR'
      }

      // Acquire a dedicated client for this request's lifetime (FF-03)
      const client = await pool.connect()
      // Set RLS context — persists for all queries on THIS client
      // Use set_config() with parameterized value to prevent SQL injection
      await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', payload.tenantId])

      // Release client when response finishes (success or error)
      res.on('close', () => {
        client.release()
      })

      const tenantReq = req as TenantRequest
      tenantReq.tenantId = payload.tenantId
      tenantReq.operatorId = payload.operatorId
      tenantReq.role = payload.role
      tenantReq.dbClient = client

      next()
    } catch {
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
}
