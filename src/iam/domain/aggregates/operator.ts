/**
 * Operator aggregate — human actor within a Tenant workspace.
 * Reference: docs/tactical-design.md — BC-05 IAM
 *
 * Operators are scoped to a single Tenant. ADMIN role grants full
 * workspace management; OPERATOR role is restricted to conversation handling.
 */

export interface Operator {
  id: string
  tenantId: string
  email: string
  name: string
  passwordHash: string
  role: 'ADMIN' | 'OPERATOR'
  status: 'ACTIVE' | 'INVITED' | 'DISABLED'
  createdAt: Date
}

/** JWT payload embedded in tokens issued by AuthService */
export interface JwtPayload {
  tenantId: string
  operatorId: string
  role: 'ADMIN' | 'OPERATOR'
  email: string
}
