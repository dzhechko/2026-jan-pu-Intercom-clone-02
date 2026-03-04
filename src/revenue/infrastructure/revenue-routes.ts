/**
 * Revenue Report REST API routes — BC-03 Revenue Intelligence.
 * Mounts on /api/reports (see server.ts)
 *
 * Authentication: Bearer JWT via tenant middleware (ADR-007).
 * All routes require a valid operator session.
 *
 * Endpoints:
 *   GET  /api/reports         — list reports for tenant
 *   GET  /api/reports/:id     — get specific report
 *   POST /api/reports/generate — trigger report generation
 *   GET  /api/reports/:id/pdf — download PDF (or HTML preview)
 */
import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { RevenueReportService } from '@revenue/application/services/revenue-report-service'
import { PgRevenueReportRepository } from './repositories/revenue-report-repository'
import { PgPQLDetectionReader } from './adapters/pg-pql-detection-reader'
import { MockCRMDealReader } from './adapters/mock-crm-deal-reader'
import { PgDialogReader } from './adapters/pg-dialog-reader'
import { PgTenantReader } from './adapters/pg-tenant-reader'
import { StubEmailService } from '@notifications/infrastructure/email-service'
import { parsePeriod } from '@revenue/domain/aggregates/revenue-report'

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const GenerateSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Period must be YYYY-MM format')
    .optional(),
})

export function createRevenueRouter(pool: Pool): Router {
  const router = Router()

  // Wire dependencies
  const reportRepo = new PgRevenueReportRepository(pool)
  const pqlReader = new PgPQLDetectionReader(pool)
  const crmReader = new MockCRMDealReader()
  const dialogReader = new PgDialogReader(pool)
  const tenantReader = new PgTenantReader(pool)
  const emailSender = new StubEmailService()

  const service = new RevenueReportService({
    reportRepo,
    pqlReader,
    crmReader,
    tenantReader,
    dialogReader,
    emailSender,
  })

  /**
   * GET /api/reports — list reports for authenticated tenant.
   */
  const listReports: RequestHandler = async (req, res) => {
    try {
      const parsed = PaginationSchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      const reports = await reportRepo.findByTenantId(tenantReq.tenantId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      })

      // Strip htmlContent from list response (can be large)
      const stripped = reports.map(({ htmlContent, ...rest }) => rest)
      return res.json({ reports: stripped })
    } catch (err) {
      console.error('[revenue-routes] listReports error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/reports/:id — get specific report.
   */
  const getReport: RequestHandler = async (req, res) => {
    try {
      const report = await reportRepo.findById(req.params.id)
      if (!report) {
        return res.status(404).json({ error: 'Report not found' })
      }
      const tenantReq = req as TenantRequest
      if (report.tenantId !== tenantReq.tenantId) {
        return res.status(404).json({ error: 'Report not found' })
      }
      return res.json({ report })
    } catch (err) {
      console.error('[revenue-routes] getReport error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * POST /api/reports/generate — trigger report generation.
   * Body: { period?: "YYYY-MM" } — defaults to previous month.
   */
  const generateReport: RequestHandler = async (req, res) => {
    try {
      const parsed = GenerateSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      }

      const tenantReq = req as TenantRequest
      let period
      if (parsed.data.period) {
        period = parsePeriod(parsed.data.period)
      } else {
        // Default to previous month
        const now = new Date()
        const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
        const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
        period = { year: prevYear, month: prevMonth }
      }

      const report = await service.generateReportForTenant(tenantReq.tenantId, period)
      return res.status(201).json({ report: { ...report, htmlContent: undefined } })
    } catch (err) {
      console.error('[revenue-routes] generateReport error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/reports/:id/pdf — download PDF or HTML preview.
   * If puppeteer is available, generates PDF on-the-fly from stored HTML.
   * Falls back to HTML content-type.
   */
  const downloadPdf: RequestHandler = async (req, res) => {
    try {
      const report = await reportRepo.findById(req.params.id)
      if (!report) {
        return res.status(404).json({ error: 'Report not found' })
      }
      const tenantReq = req as TenantRequest
      if (report.tenantId !== tenantReq.tenantId) {
        return res.status(404).json({ error: 'Report not found' })
      }
      if (!report.htmlContent) {
        return res.status(404).json({ error: 'Report has no content — generate first' })
      }

      // Try puppeteer for real PDF
      try {
        const puppeteer = await import('puppeteer')
        const browser = await puppeteer.default.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
        const page = await browser.newPage()
        await page.setContent(report.htmlContent, { waitUntil: 'networkidle0' })
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        })
        await browser.close()

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="revenue-report-${report.period.year}-${String(report.period.month).padStart(2, '0')}.pdf"`,
        )
        return res.send(Buffer.from(pdfBuffer))
      } catch {
        // Puppeteer not available — serve HTML preview
        console.log('[revenue-routes] Puppeteer unavailable, serving HTML preview')
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.send(report.htmlContent)
      }
    } catch (err) {
      console.error('[revenue-routes] downloadPdf error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  // Mount routes — order matters: /generate before /:id
  router.get('/', listReports)
  router.post('/generate', generateReport)
  router.get('/:id', getReport)
  router.get('/:id/pdf', downloadPdf)

  return router
}

/**
 * Create a RevenueReportService instance for use outside routes (e.g., worker cron).
 */
export function createRevenueReportService(pool: Pool): RevenueReportService {
  return new RevenueReportService({
    reportRepo: new PgRevenueReportRepository(pool),
    pqlReader: new PgPQLDetectionReader(pool),
    crmReader: new MockCRMDealReader(),
    tenantReader: new PgTenantReader(pool),
    dialogReader: new PgDialogReader(pool),
    emailSender: new StubEmailService(),
  })
}
