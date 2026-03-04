/**
 * Tenant Isolation Tests — revenue-routes.ts + attribution-routes.ts
 *
 * Validates that tenant ownership checks prevent cross-tenant access (FF-03).
 * Tests:
 *   GET  /reports/:id     — 404 when report belongs to different tenant
 *   GET  /reports/:id     — 200 when tenant matches
 *   GET  /reports/:id/pdf — 404 when report belongs to different tenant
 *   DELETE /attributions/:id — 404 when attribution belongs to different tenant
 */
import express, { Request, Response, NextFunction } from 'express'
import request from 'supertest'
import { Pool } from 'pg'
import { RevenueReport } from '@revenue/domain/aggregates/revenue-report'

// ─── Mock all heavy dependencies so we only test route-level tenant checks ──

jest.mock('./repositories/revenue-report-repository')
jest.mock('./adapters/pg-pql-detection-reader')
jest.mock('./adapters/mock-crm-deal-reader')
jest.mock('./adapters/pg-dialog-reader')
jest.mock('./adapters/pg-tenant-reader')
jest.mock('@notifications/infrastructure/email-service')
jest.mock('@revenue/application/services/revenue-report-service')

import { PgRevenueReportRepository } from './repositories/revenue-report-repository'
import { createRevenueRouter } from './revenue-routes'
import { createAttributionRouter } from './attribution-routes'
import type { AttributionRepository } from './repositories/attribution-repository'
import type { AutoAttributionService } from '@revenue/application/services/auto-attribution-service'

// ─── Constants ──────────────────────────────────────────────────────────────

const TENANT_A = 'tenant-aaa-1111'
const TENANT_B = 'tenant-bbb-2222'
const OPERATOR_ID = 'operator-001'
const REPORT_ID = 'report-001'
const ATTRIBUTION_ID = 'attr-001'

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<RevenueReport> = {}): RevenueReport {
  return {
    id: REPORT_ID,
    tenantId: TENANT_A,
    period: { year: 2026, month: 1 },
    status: 'GENERATED',
    attributions: [],
    summary: null,
    pdfUrl: null,
    htmlContent: '<h1>Revenue Report</h1>',
    createdAt: new Date('2026-01-15'),
    updatedAt: new Date('2026-01-15'),
    ...overrides,
  }
}

// ─── Mock pool ──────────────────────────────────────────────────────────────

function createMockPool(): Pool {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  } as unknown as Pool
  return pool
}

// ─── Middleware that injects TenantRequest fields ───────────────────────────

function tenantMiddleware(tenantId: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    ;(req as any).tenantId = tenantId
    ;(req as any).operatorId = OPERATOR_ID
    ;(req as any).role = 'OPERATOR'
    ;(req as any).dbClient = { query: jest.fn(), release: jest.fn() }
    next()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Revenue Routes — Tenant Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('Revenue Routes — Tenant Isolation (FF-03)', () => {
  let mockPool: Pool
  let mockFindById: jest.Mock

  function buildApp(requestingTenantId: string) {
    const app = express()
    app.use(express.json())
    app.use(tenantMiddleware(requestingTenantId))
    app.use('/reports', createRevenueRouter(mockPool))
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPool = createMockPool()

    // Access the mocked PgRevenueReportRepository prototype
    mockFindById = jest.fn()
    ;(PgRevenueReportRepository as jest.MockedClass<typeof PgRevenueReportRepository>)
      .prototype.findById = mockFindById
  })

  // ── GET /reports/:id ────────────────────────────────────────────────────

  describe('GET /reports/:id', () => {
    it('returns 404 when report belongs to a different tenant', async () => {
      const report = makeReport({ tenantId: TENANT_A })
      mockFindById.mockResolvedValue(report)

      const app = buildApp(TENANT_B) // requesting as tenant B

      const res = await request(app).get(`/reports/${REPORT_ID}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Report not found')
      expect(mockFindById).toHaveBeenCalledWith(REPORT_ID)
    })

    it('returns report when tenant matches', async () => {
      const report = makeReport({ tenantId: TENANT_A })
      mockFindById.mockResolvedValue(report)

      const app = buildApp(TENANT_A) // requesting as tenant A (owner)

      const res = await request(app).get(`/reports/${REPORT_ID}`)

      expect(res.status).toBe(200)
      expect(res.body.report).toBeDefined()
      expect(res.body.report.id).toBe(REPORT_ID)
      expect(res.body.report.tenantId).toBe(TENANT_A)
    })

    it('returns 404 when report does not exist', async () => {
      mockFindById.mockResolvedValue(null)

      const app = buildApp(TENANT_A)

      const res = await request(app).get('/reports/nonexistent')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Report not found')
    })
  })

  // ── GET /reports/:id/pdf ────────────────────────────────────────────────

  describe('GET /reports/:id/pdf', () => {
    it('returns 404 when report belongs to a different tenant', async () => {
      const report = makeReport({ tenantId: TENANT_A })
      mockFindById.mockResolvedValue(report)

      const app = buildApp(TENANT_B) // requesting as tenant B

      const res = await request(app).get(`/reports/${REPORT_ID}/pdf`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Report not found')
    })

    it('returns HTML preview when tenant matches and puppeteer is unavailable', async () => {
      const report = makeReport({ tenantId: TENANT_A, htmlContent: '<h1>Test</h1>' })
      mockFindById.mockResolvedValue(report)

      const app = buildApp(TENANT_A)

      const res = await request(app).get(`/reports/${REPORT_ID}/pdf`)

      // Puppeteer is not installed in test env, so it falls back to HTML
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.text).toBe('<h1>Test</h1>')
    })

    it('returns 404 when report has no htmlContent', async () => {
      const report = makeReport({ tenantId: TENANT_A, htmlContent: null })
      mockFindById.mockResolvedValue(report)

      const app = buildApp(TENANT_A)

      const res = await request(app).get(`/reports/${REPORT_ID}/pdf`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Report has no content — generate first')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Attribution Routes — Tenant Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('Attribution Routes — Tenant Isolation (FF-03)', () => {
  let mockPool: Pool
  let mockAttributionRepo: jest.Mocked<AttributionRepository>
  let mockAttributionService: jest.Mocked<AutoAttributionService>

  function buildApp(requestingTenantId: string) {
    const app = express()
    app.use(express.json())
    app.use(tenantMiddleware(requestingTenantId))
    app.use(
      '/attributions',
      createAttributionRouter(mockPool, mockAttributionRepo, mockAttributionService),
    )
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPool = createMockPool()

    mockAttributionRepo = {
      save: jest.fn(),
      findByDealId: jest.fn(),
      findByDetectionId: jest.fn(),
      findByTenantId: jest.fn(),
      deleteById: jest.fn(),
    }

    mockAttributionService = {
      linkDetectionToDeal: jest.fn(),
      processNewDetection: jest.fn(),
    } as unknown as jest.Mocked<AutoAttributionService>
  })

  // ── DELETE /attributions/:id ────────────────────────────────────────────

  describe('DELETE /attributions/:id', () => {
    it('returns 404 when attribution belongs to a different tenant', async () => {
      // pool.query returns a row with tenant_id = TENANT_A
      ;(mockPool.query as jest.Mock).mockResolvedValue({
        rows: [{ tenant_id: TENANT_A }],
        rowCount: 1,
      })

      const app = buildApp(TENANT_B) // requesting as tenant B

      const res = await request(app).delete(`/attributions/${ATTRIBUTION_ID}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Attribution not found')
      // deleteById should NOT have been called — ownership check blocks it
      expect(mockAttributionRepo.deleteById).not.toHaveBeenCalled()
    })

    it('returns 204 when tenant matches', async () => {
      ;(mockPool.query as jest.Mock).mockResolvedValue({
        rows: [{ tenant_id: TENANT_A }],
        rowCount: 1,
      })
      mockAttributionRepo.deleteById.mockResolvedValue(true)

      const app = buildApp(TENANT_A)

      const res = await request(app).delete(`/attributions/${ATTRIBUTION_ID}`)

      expect(res.status).toBe(204)
      expect(mockAttributionRepo.deleteById).toHaveBeenCalledWith(ATTRIBUTION_ID)
    })

    it('returns 404 when attribution does not exist', async () => {
      ;(mockPool.query as jest.Mock).mockResolvedValue({
        rows: [],
        rowCount: 0,
      })

      const app = buildApp(TENANT_A)

      const res = await request(app).delete(`/attributions/${ATTRIBUTION_ID}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Attribution not found')
      expect(mockAttributionRepo.deleteById).not.toHaveBeenCalled()
    })
  })

  // ── GET /attributions/:detectionId ──────────────────────────────────────

  describe('GET /attributions/:detectionId', () => {
    it('returns 404 when attribution belongs to a different tenant', async () => {
      mockAttributionRepo.findByDetectionId.mockResolvedValue({
        id: ATTRIBUTION_ID,
        tenantId: TENANT_A,
        pqlDetectionId: 'det-001',
        dialogId: 'dlg-001',
        dealId: 'deal-001',
        dealValue: 50000,
        closedAt: new Date('2026-01-10'),
        timeToClose: 3600,
        operatorId: OPERATOR_ID,
        confidence: 0.85,
        createdAt: new Date('2026-01-10'),
      })

      const app = buildApp(TENANT_B)

      const res = await request(app).get('/attributions/det-001')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Attribution not found')
    })

    it('returns attribution when tenant matches', async () => {
      mockAttributionRepo.findByDetectionId.mockResolvedValue({
        id: ATTRIBUTION_ID,
        tenantId: TENANT_A,
        pqlDetectionId: 'det-001',
        dialogId: 'dlg-001',
        dealId: 'deal-001',
        dealValue: 50000,
        closedAt: new Date('2026-01-10'),
        timeToClose: 3600,
        operatorId: OPERATOR_ID,
        confidence: 0.85,
        createdAt: new Date('2026-01-10'),
      })

      const app = buildApp(TENANT_A)

      const res = await request(app).get('/attributions/det-001')

      expect(res.status).toBe(200)
      expect(res.body.attribution).toBeDefined()
      expect(res.body.attribution.id).toBe(ATTRIBUTION_ID)
    })
  })
})
