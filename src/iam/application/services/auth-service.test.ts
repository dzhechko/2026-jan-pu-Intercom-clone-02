/**
 * Unit tests for AuthService.
 * Uses mocked Pool — no real DB connection required.
 */
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Pool, PoolClient } from 'pg'
import { AuthService } from './auth-service'
import { JwtPayload } from '@iam/domain/aggregates/operator'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234'
const OPERATOR_ID = 'operator-uuid-5678'
const TEST_EMAIL = 'admin@acme.com'
const TEST_PASSWORD = 'SecurePass123!'
const TEST_NAME = 'Alice Admin'
const TENANT_NAME = 'Acme Corp'

async function makeFakePasswordHash(password: string) {
  return bcrypt.hash(password, 10)
}

function makeFakeTenantRow() {
  return {
    id: TENANT_ID,
    name: TENANT_NAME,
    plan: 'TRIAL',
    status: 'ACTIVE',
    billing_email: TEST_EMAIL,
    settings: { pqlThreshold: 0.65, notifyChannels: ['EMAIL'] },
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  }
}

async function makeFakeOperatorRow(passwordHash?: string) {
  return {
    id: OPERATOR_ID,
    tenant_id: TENANT_ID,
    email: TEST_EMAIL,
    name: TEST_NAME,
    role: 'ADMIN',
    status: 'ACTIVE',
    password_hash: passwordHash ?? (await makeFakePasswordHash(TEST_PASSWORD)),
    created_at: new Date('2026-01-01'),
  }
}

// ── Mock pool factory ─────────────────────────────────────────────────────────

function createMockPool(overrides?: {
  tenantRow?: Record<string, unknown> | null
  operatorRow?: Record<string, unknown> | null
  createTenantRows?: Record<string, unknown>[]
  createOperatorRows?: Record<string, unknown>[]
}): Pool {
  // Track query call order for transaction-based operations
  let callCount = 0

  const mockClient: Partial<PoolClient> = {
    query: jest.fn().mockImplementation(async (sql: string) => {
      const q = typeof sql === 'string' ? sql.trim() : ''

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rows: [] }
      }

      callCount++

      // First INSERT → tenant creation
      if (q.includes('INSERT INTO iam.tenants') || (callCount === 1 && q.includes('INSERT'))) {
        const rows = overrides?.createTenantRows ?? [makeFakeTenantRow()]
        return { rows }
      }

      // Second INSERT → operator creation
      if (q.includes('INSERT INTO iam.operators') || (callCount === 2 && q.includes('INSERT'))) {
        const rows = overrides?.createOperatorRows ?? []
        return { rows: await Promise.all(rows.length ? rows : [makeFakeOperatorRow()]) }
      }

      return { rows: [] }
    }),
    release: jest.fn(),
  }

  const mockPool: Partial<Pool> = {
    connect: jest.fn().mockResolvedValue(mockClient as PoolClient),
    query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      const q = typeof sql === 'string' ? sql.trim() : ''

      // findByEmail query
      if (q.includes('FROM iam.operators WHERE email')) {
        const row = overrides?.operatorRow
        // row === undefined means use default; null means "not found"
        if (row === null) return { rows: [] }
        return { rows: [row ?? (await makeFakeOperatorRow())] }
      }

      // findById query
      if (q.includes('FROM iam.operators WHERE id')) {
        const row = overrides?.operatorRow
        if (row === null) return { rows: [] }
        return { rows: [row ?? (await makeFakeOperatorRow())] }
      }

      return { rows: [] }
    }),
  }

  return mockPool as Pool
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.JWT_SECRET = 'test-secret-key-for-unit-tests'
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  // ── register ────────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('creates a tenant and admin operator, returns token', async () => {
      const pool = createMockPool()
      const service = new AuthService(pool)

      const result = await service.register({
        tenantName: TENANT_NAME,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      expect(result.value.tenant.id).toBe(TENANT_ID)
      expect(result.value.tenant.name).toBe(TENANT_NAME)
      expect(result.value.operator.role).toBe('ADMIN')
      expect(result.value.operator.email).toBe(TEST_EMAIL)
      expect(typeof result.value.token).toBe('string')
      expect(result.value.token.split('.').length).toBe(3) // valid JWT structure
    })

    it('begins and commits a transaction', async () => {
      const pool = createMockPool()
      const service = new AuthService(pool)

      await service.register({
        tenantName: TENANT_NAME,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      })

      const client = await pool.connect()
      expect(client.query).toHaveBeenCalledWith('BEGIN')
      expect(client.query).toHaveBeenCalledWith('COMMIT')
    })

    it('rolls back transaction on error', async () => {
      const pool = createMockPool({ createTenantRows: [] }) // empty rows triggers throw

      // Patch tenant repo to simulate failure
      const mockClient: Partial<PoolClient> = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.trim() === 'BEGIN' || sql.trim() === 'ROLLBACK') return { rows: [] }
          if (sql.includes('INSERT INTO iam.tenants')) {
            throw new Error('DB connection lost')
          }
          return { rows: [] }
        }),
        release: jest.fn(),
      }
      ;(pool.connect as jest.Mock).mockResolvedValue(mockClient)

      const service = new AuthService(pool)
      const result = await service.register({
        tenantName: TENANT_NAME,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      })

      expect(result.ok).toBe(false)
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects invalid input — password too short', async () => {
      const pool = createMockPool()
      const service = new AuthService(pool)

      const result = await service.register({
        tenantName: TENANT_NAME,
        email: TEST_EMAIL,
        password: 'short',
        name: TEST_NAME,
      })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected failure')
      expect(result.error.message).toMatch(/password|String must contain at least 8/i)
    })

    it('rejects invalid email format', async () => {
      const pool = createMockPool()
      const service = new AuthService(pool)

      const result = await service.register({
        tenantName: TENANT_NAME,
        email: 'not-an-email',
        password: TEST_PASSWORD,
        name: TEST_NAME,
      })

      expect(result.ok).toBe(false)
    })
  })

  // ── login ───────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('returns a valid JWT token on correct credentials', async () => {
      const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10)
      const pool = createMockPool({
        operatorRow: {
          id: OPERATOR_ID,
          tenant_id: TENANT_ID,
          email: TEST_EMAIL,
          name: TEST_NAME,
          role: 'ADMIN',
          status: 'ACTIVE',
          password_hash: passwordHash,
          created_at: new Date('2026-01-01'),
        },
      })
      const service = new AuthService(pool)

      const result = await service.login({ email: TEST_EMAIL, password: TEST_PASSWORD })

      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(typeof result.value.token).toBe('string')
      expect(result.value.token.split('.').length).toBe(3)
    })

    it('fails with wrong password', async () => {
      const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10)
      const pool = createMockPool({
        operatorRow: {
          id: OPERATOR_ID,
          tenant_id: TENANT_ID,
          email: TEST_EMAIL,
          name: TEST_NAME,
          role: 'ADMIN',
          status: 'ACTIVE',
          password_hash: passwordHash,
          created_at: new Date('2026-01-01'),
        },
      })
      const service = new AuthService(pool)

      const result = await service.login({ email: TEST_EMAIL, password: 'WrongPassword!' })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected failure')
      expect(result.error.message).toBe('Invalid email or password')
    })

    it('fails when operator not found', async () => {
      const pool = createMockPool({ operatorRow: null })
      const service = new AuthService(pool)

      const result = await service.login({ email: 'unknown@example.com', password: TEST_PASSWORD })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected failure')
      expect(result.error.message).toBe('Invalid email or password')
    })
  })

  // ── JWT claims ──────────────────────────────────────────────────────────────

  describe('JWT payload', () => {
    it('contains correct claims: tenantId, operatorId, role, email', async () => {
      const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10)
      const pool = createMockPool({
        operatorRow: {
          id: OPERATOR_ID,
          tenant_id: TENANT_ID,
          email: TEST_EMAIL,
          name: TEST_NAME,
          role: 'ADMIN',
          status: 'ACTIVE',
          password_hash: passwordHash,
          created_at: new Date('2026-01-01'),
        },
      })
      const service = new AuthService(pool)

      const result = await service.login({ email: TEST_EMAIL, password: TEST_PASSWORD })
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      const payload = jwt.verify(
        result.value.token,
        process.env.JWT_SECRET ?? 'test-secret-key-for-unit-tests',
      ) as JwtPayload

      expect(payload.tenantId).toBe(TENANT_ID)
      expect(payload.operatorId).toBe(OPERATOR_ID)
      expect(payload.role).toBe('ADMIN')
      expect(payload.email).toBe(TEST_EMAIL)
    })

    it('token expires — has exp claim set to ~24h from now', async () => {
      const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10)
      const pool = createMockPool({
        operatorRow: {
          id: OPERATOR_ID,
          tenant_id: TENANT_ID,
          email: TEST_EMAIL,
          name: TEST_NAME,
          role: 'ADMIN',
          status: 'ACTIVE',
          password_hash: passwordHash,
          created_at: new Date('2026-01-01'),
        },
      })
      const service = new AuthService(pool)

      const result = await service.login({ email: TEST_EMAIL, password: TEST_PASSWORD })
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      const payload = jwt.decode(result.value.token) as JwtPayload & { exp: number; iat: number }

      expect(payload.exp).toBeDefined()
      expect(payload.iat).toBeDefined()

      const durationSeconds = payload.exp - payload.iat
      // Should be approximately 24 hours (86400 seconds), allow ±60s variance
      expect(durationSeconds).toBeGreaterThanOrEqual(86340)
      expect(durationSeconds).toBeLessThanOrEqual(86460)
    })

    it('verifyToken() returns the payload for a valid token', async () => {
      const pool = createMockPool()
      const service = new AuthService(pool)

      const token = jwt.sign(
        { tenantId: TENANT_ID, operatorId: OPERATOR_ID, role: 'ADMIN', email: TEST_EMAIL },
        process.env.JWT_SECRET ?? 'test-secret-key-for-unit-tests',
        { expiresIn: '24h' },
      )

      const result = service.verifyToken(token)
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.value.tenantId).toBe(TENANT_ID)
    })

    it('verifyToken() returns error for tampered token', async () => {
      const pool = createMockPool()
      const service = new AuthService(pool)

      const result = service.verifyToken('invalid.token.here')
      expect(result.ok).toBe(false)
    })
  })

  // ── register produces correct token claims ──────────────────────────────────

  describe('register() → token claims', () => {
    it('token from register() contains correct tenantId and ADMIN role', async () => {
      const pool = createMockPool()
      const service = new AuthService(pool)

      const result = await service.register({
        tenantName: TENANT_NAME,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      const payload = jwt.decode(result.value.token) as JwtPayload
      expect(payload.tenantId).toBe(TENANT_ID)
      expect(payload.role).toBe('ADMIN')
      expect(payload.email).toBe(TEST_EMAIL)
    })
  })
})
