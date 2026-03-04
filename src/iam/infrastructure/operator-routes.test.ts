/**
 * Unit tests for operator-routes.ts — FR-13 Multi-operator
 *
 * Uses supertest + mocked OperatorRepository and PresenceService.
 * Routes are mounted on an express app with middleware that injects
 * TenantRequest fields (tenantId, operatorId, role, dbClient).
 */
import express, { Request, Response, NextFunction } from 'express'
import request from 'supertest'
import { createOperatorRouter } from './operator-routes'

// ── Mock modules before imports ──────────────────────────────────────────────

const mockFindByTenantId = jest.fn()
const mockFindById = jest.fn()
const mockUpdateStatus = jest.fn()

jest.mock('./repositories/operator-repository', () => ({
  OperatorRepository: jest.fn().mockImplementation(() => ({
    findByTenantId: mockFindByTenantId,
    findById: mockFindById,
    updateStatus: mockUpdateStatus,
  })),
}))

const mockGetOnlineOperators = jest.fn()
const mockIsOnline = jest.fn()
const mockSetOffline = jest.fn()

jest.mock('@iam/application/services/presence-service', () => ({
  PresenceService: jest.fn().mockImplementation(() => ({
    getOnlineOperators: mockGetOnlineOperators,
    isOnline: mockIsOnline,
    setOnline: jest.fn(),
    setOffline: mockSetOffline,
  })),
}))

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234'
const OPERATOR_ID = 'op-self-uuid'
const OTHER_OPERATOR_ID = 'op-other-uuid'

function makeOperator(overrides: Record<string, unknown> = {}) {
  return {
    id: OTHER_OPERATOR_ID,
    tenantId: TENANT_ID,
    email: 'bob@acme.com',
    name: 'Bob Operator',
    role: 'OPERATOR',
    status: 'ACTIVE',
    passwordHash: 'hashed',
    createdAt: new Date('2026-01-15'),
    ...overrides,
  }
}

// ── App setup ────────────────────────────────────────────────────────────────

const mockDbClient = {
  query: jest.fn(),
}

const mockPool = {} as any
const mockRedis = {} as any

function createTestApp(role: 'ADMIN' | 'OPERATOR' = 'ADMIN') {
  const app = express()
  app.use(express.json())

  // Inject TenantRequest fields
  app.use((req: Request, _res: Response, next: NextFunction) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).operatorId = OPERATOR_ID
    ;(req as any).role = role
    ;(req as any).dbClient = mockDbClient
    next()
  })

  const router = createOperatorRouter(mockPool, mockRedis)
  app.use('/api/operators', router)
  return app
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/operators', () => {
  it('returns list of operators', async () => {
    const operators = [
      makeOperator({ id: 'op-1', name: 'Alice' }),
      makeOperator({ id: 'op-2', name: 'Bob' }),
    ]
    mockFindByTenantId.mockResolvedValue({ ok: true, value: operators })

    const app = createTestApp()
    const res = await request(app).get('/api/operators')

    expect(res.status).toBe(200)
    expect(res.body.operators).toHaveLength(2)
    expect(res.body.operators[0]).toEqual(
      expect.objectContaining({ id: 'op-1', name: 'Alice' }),
    )
    expect(res.body.operators[1]).toEqual(
      expect.objectContaining({ id: 'op-2', name: 'Bob' }),
    )
    // Should not leak passwordHash
    expect(res.body.operators[0].passwordHash).toBeUndefined()
    expect(mockFindByTenantId).toHaveBeenCalledWith(TENANT_ID, mockDbClient)
  })

  it('returns 500 when repository fails', async () => {
    mockFindByTenantId.mockResolvedValue({ ok: false, error: new Error('DB down') })

    const app = createTestApp()
    const res = await request(app).get('/api/operators')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to fetch operators')
  })
})

describe('GET /api/operators/online', () => {
  it('returns online operators', async () => {
    const op1 = makeOperator({ id: 'op-1', name: 'Alice' })
    const op2 = makeOperator({ id: 'op-2', name: 'Bob' })
    mockGetOnlineOperators.mockResolvedValue(['op-1'])
    mockFindByTenantId.mockResolvedValue({ ok: true, value: [op1, op2] })

    const app = createTestApp()
    const res = await request(app).get('/api/operators/online')

    expect(res.status).toBe(200)
    expect(res.body.operators).toHaveLength(1)
    expect(res.body.operators[0].id).toBe('op-1')
    expect(mockGetOnlineOperators).toHaveBeenCalledWith(TENANT_ID)
  })

  it('returns 500 when repository fails', async () => {
    mockGetOnlineOperators.mockResolvedValue([])
    mockFindByTenantId.mockResolvedValue({ ok: false, error: new Error('DB down') })

    const app = createTestApp()
    const res = await request(app).get('/api/operators/online')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to fetch operators')
  })
})

describe('PATCH /api/operators/:id/role', () => {
  it('returns 403 for non-admin', async () => {
    const app = createTestApp('OPERATOR')
    const res = await request(app)
      .patch(`/api/operators/${OTHER_OPERATOR_ID}/role`)
      .send({ role: 'ADMIN' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Admin role required')
  })

  it('returns 400 for invalid body', async () => {
    const app = createTestApp('ADMIN')
    const res = await request(app)
      .patch(`/api/operators/${OTHER_OPERATOR_ID}/role`)
      .send({ role: 'SUPER_ADMIN' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid body')
    expect(res.body.details).toBeDefined()
  })

  it('prevents self-demotion', async () => {
    const operator = makeOperator({ id: OPERATOR_ID, role: 'ADMIN', tenantId: TENANT_ID })
    mockFindById.mockResolvedValue({ ok: true, value: operator })

    const app = createTestApp('ADMIN')
    const res = await request(app)
      .patch(`/api/operators/${OPERATOR_ID}/role`)
      .send({ role: 'OPERATOR' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Cannot change your own role')
  })

  it('updates role successfully', async () => {
    const operator = makeOperator({ id: OTHER_OPERATOR_ID, tenantId: TENANT_ID })
    mockFindById.mockResolvedValue({ ok: true, value: operator })
    mockDbClient.query.mockResolvedValue({ rows: [] })

    const app = createTestApp('ADMIN')
    const res = await request(app)
      .patch(`/api/operators/${OTHER_OPERATOR_ID}/role`)
      .send({ role: 'ADMIN' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: OTHER_OPERATOR_ID, role: 'ADMIN' })
    expect(mockDbClient.query).toHaveBeenCalledWith(
      'UPDATE iam.operators SET role = $1 WHERE id = $2',
      ['ADMIN', OTHER_OPERATOR_ID],
    )
  })

  it('returns 404 when operator not found', async () => {
    mockFindById.mockResolvedValue({ ok: true, value: null })

    const app = createTestApp('ADMIN')
    const res = await request(app)
      .patch(`/api/operators/${OTHER_OPERATOR_ID}/role`)
      .send({ role: 'ADMIN' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Operator not found')
  })

  it('returns 404 when operator belongs to different tenant', async () => {
    const operator = makeOperator({ id: OTHER_OPERATOR_ID, tenantId: 'other-tenant' })
    mockFindById.mockResolvedValue({ ok: true, value: operator })

    const app = createTestApp('ADMIN')
    const res = await request(app)
      .patch(`/api/operators/${OTHER_OPERATOR_ID}/role`)
      .send({ role: 'ADMIN' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Operator not found')
  })
})

describe('DELETE /api/operators/:id', () => {
  it('returns 403 for non-admin', async () => {
    const app = createTestApp('OPERATOR')
    const res = await request(app).delete(`/api/operators/${OTHER_OPERATOR_ID}`)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Admin role required')
  })

  it('prevents self-deactivation', async () => {
    const app = createTestApp('ADMIN')
    const res = await request(app).delete(`/api/operators/${OPERATOR_ID}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Cannot deactivate yourself')
  })

  it('deactivates operator successfully', async () => {
    const operator = makeOperator({ id: OTHER_OPERATOR_ID, tenantId: TENANT_ID })
    mockFindById.mockResolvedValue({ ok: true, value: operator })
    mockUpdateStatus.mockResolvedValue({ ok: true, value: undefined })
    mockSetOffline.mockResolvedValue(undefined)

    const app = createTestApp('ADMIN')
    const res = await request(app).delete(`/api/operators/${OTHER_OPERATOR_ID}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: OTHER_OPERATOR_ID, status: 'DISABLED' })
    expect(mockUpdateStatus).toHaveBeenCalledWith(OTHER_OPERATOR_ID, 'DISABLED', mockDbClient)
    expect(mockSetOffline).toHaveBeenCalledWith(OTHER_OPERATOR_ID, TENANT_ID)
  })

  it('returns 404 when operator not found', async () => {
    mockFindById.mockResolvedValue({ ok: true, value: null })

    const app = createTestApp('ADMIN')
    const res = await request(app).delete(`/api/operators/${OTHER_OPERATOR_ID}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Operator not found')
  })

  it('returns 404 when operator belongs to different tenant', async () => {
    const operator = makeOperator({ id: OTHER_OPERATOR_ID, tenantId: 'other-tenant' })
    mockFindById.mockResolvedValue({ ok: true, value: operator })

    const app = createTestApp('ADMIN')
    const res = await request(app).delete(`/api/operators/${OTHER_OPERATOR_ID}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Operator not found')
  })

  it('returns 500 when updateStatus fails', async () => {
    const operator = makeOperator({ id: OTHER_OPERATOR_ID, tenantId: TENANT_ID })
    mockFindById.mockResolvedValue({ ok: true, value: operator })
    mockUpdateStatus.mockResolvedValue({ ok: false, error: new Error('DB error') })

    const app = createTestApp('ADMIN')
    const res = await request(app).delete(`/api/operators/${OTHER_OPERATOR_ID}`)

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to deactivate operator')
  })
})

describe('GET /api/operators/:id/stats', () => {
  it('returns stats for operator', async () => {
    const operator = makeOperator({ id: OTHER_OPERATOR_ID, tenantId: TENANT_ID })
    mockFindById.mockResolvedValue({ ok: true, value: operator })
    mockIsOnline.mockResolvedValue(true)

    // First call: active dialogs count, Second call: closed today count
    mockDbClient.query
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ count: 7 }] })

    const app = createTestApp()
    const res = await request(app).get(`/api/operators/${OTHER_OPERATOR_ID}/stats`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      operatorId: OTHER_OPERATOR_ID,
      activeDialogs: 3,
      closedToday: 7,
      avgResponseTime: null,
      isOnline: true,
    })
    expect(mockIsOnline).toHaveBeenCalledWith(OTHER_OPERATOR_ID, TENANT_ID)
  })

  it('returns 404 when operator not found', async () => {
    mockFindById.mockResolvedValue({ ok: true, value: null })

    const app = createTestApp()
    const res = await request(app).get(`/api/operators/${OTHER_OPERATOR_ID}/stats`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Operator not found')
  })

  it('returns 404 when operator belongs to different tenant', async () => {
    const operator = makeOperator({ id: OTHER_OPERATOR_ID, tenantId: 'other-tenant' })
    mockFindById.mockResolvedValue({ ok: true, value: operator })

    const app = createTestApp()
    const res = await request(app).get(`/api/operators/${OTHER_OPERATOR_ID}/stats`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Operator not found')
  })

  it('returns 404 when findById fails', async () => {
    mockFindById.mockResolvedValue({ ok: false, error: new Error('DB error') })

    const app = createTestApp()
    const res = await request(app).get(`/api/operators/${OTHER_OPERATOR_ID}/stats`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Operator not found')
  })
})
