/**
 * Authentication service — registration, login, JWT issuance.
 * Reference: docs/tactical-design.md — BC-05 IAM
 *
 * register() is a two-phase operation:
 *   1. Create Tenant record
 *   2. Create first ADMIN operator
 * Both wrapped in a DB transaction to ensure atomicity.
 *
 * JWT payload: { tenantId, operatorId, role, email }
 * Tokens expire in 24h. Secret from JWT_SECRET env var.
 */
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Pool } from 'pg'
import { z } from 'zod'
import { TenantRepository } from '@iam/infrastructure/repositories/tenant-repository'
import { OperatorRepository } from '@iam/infrastructure/repositories/operator-repository'
import { Tenant } from '@iam/domain/aggregates/tenant'
import { Operator, JwtPayload } from '@iam/domain/aggregates/operator'
import { Result, ok, err } from '@shared/types/result'

const BCRYPT_ROUNDS = 12
const TOKEN_EXPIRES_IN = '24h'

/** Read JWT_SECRET at call time so tests can set process.env.JWT_SECRET in beforeEach. */
function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? 'dev-secret-change-me'
}

// ── Input validation schemas ──────────────────────────────────────────────────

export const RegisterSchema = z.object({
  tenantName: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(2).max(255),
})

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const InviteOperatorSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(255),
  role: z.enum(['ADMIN', 'OPERATOR']).default('OPERATOR'),
})

// ── Result types ──────────────────────────────────────────────────────────────

export interface RegisterResult {
  tenant: Tenant
  operator: Operator
  token: string
}

export interface LoginResult {
  operator: Operator
  token: string
}

// ── Service ───────────────────────────────────────────────────────────────────

export class AuthService {
  private readonly tenantRepo: TenantRepository
  private readonly operatorRepo: OperatorRepository

  constructor(private readonly pool: Pool) {
    this.tenantRepo = new TenantRepository(pool)
    this.operatorRepo = new OperatorRepository(pool)
  }

  /**
   * Register a new tenant with an initial ADMIN operator.
   * Atomic — rolls back both writes on any failure.
   */
  async register(input: z.infer<typeof RegisterSchema>): Promise<Result<RegisterResult, Error>> {
    const parsed = RegisterSchema.safeParse(input)
    if (!parsed.success) {
      return err(new Error(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const { tenantName, email, password, name } = parsed.data
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      const tenantResult = await this.tenantRepo.create(
        { name: tenantName, billingEmail: email },
        client,
      )
      if (!tenantResult.ok) throw tenantResult.error

      const tenant = tenantResult.value
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      const operatorResult = await this.operatorRepo.create(
        { tenantId: tenant.id, email, name, passwordHash, role: 'ADMIN' },
        client,
      )
      if (!operatorResult.ok) throw operatorResult.error

      await client.query('COMMIT')

      const operator = operatorResult.value
      const token = this.issueToken(operator)

      return ok({ tenant, operator, token })
    } catch (e) {
      await client.query('ROLLBACK')
      return err(e instanceof Error ? e : new Error(String(e)))
    } finally {
      client.release()
    }
  }

  /**
   * Authenticate an operator and issue a JWT token.
   */
  async login(input: z.infer<typeof LoginSchema>): Promise<Result<LoginResult, Error>> {
    const parsed = LoginSchema.safeParse(input)
    if (!parsed.success) {
      return err(new Error(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const { email, password } = parsed.data

    const operatorResult = await this.operatorRepo.findByEmail(email)
    if (!operatorResult.ok) return err(operatorResult.error)

    const operator = operatorResult.value
    if (!operator) {
      return err(new Error('Invalid email or password'))
    }

    const passwordMatch = await bcrypt.compare(password, operator.passwordHash)
    if (!passwordMatch) {
      return err(new Error('Invalid email or password'))
    }

    const token = this.issueToken(operator)
    return ok({ operator, token })
  }

  /**
   * Invite a new operator to an existing tenant (admin-only action).
   * Generates a temporary password — operator must reset on first login.
   */
  async inviteOperator(
    tenantId: string,
    input: z.infer<typeof InviteOperatorSchema>,
  ): Promise<Result<Operator, Error>> {
    const parsed = InviteOperatorSchema.safeParse(input)
    if (!parsed.success) {
      return err(new Error(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const { email, name, role } = parsed.data

    // Check for duplicate email within tenant
    const existingResult = await this.operatorRepo.findByEmail(email)
    if (!existingResult.ok) return err(existingResult.error)
    if (existingResult.value?.tenantId === tenantId) {
      return err(new Error('Operator with this email already exists in this tenant'))
    }

    // Temporary password — in production, send invitation email with reset link
    const tempPassword = `temp-${Math.random().toString(36).slice(2, 10)}`
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    return this.operatorRepo.create(
      { tenantId, email, name, passwordHash, role },
    )
  }

  /**
   * Verify a JWT token and return the decoded payload.
   */
  verifyToken(token: string): Result<JwtPayload, Error> {
    try {
      const payload = jwt.verify(token, getJwtSecret()) as JwtPayload
      return ok(payload)
    } catch (e) {
      return err(e instanceof Error ? e : new Error('Invalid token'))
    }
  }

  private issueToken(operator: Operator): string {
    const payload: JwtPayload = {
      tenantId: operator.tenantId,
      operatorId: operator.id,
      role: operator.role,
      email: operator.email,
    }
    return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRES_IN })
  }
}
