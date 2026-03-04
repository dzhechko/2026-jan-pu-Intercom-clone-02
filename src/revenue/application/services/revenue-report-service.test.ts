/**
 * Revenue Report Service tests — FR-06 Revenue Intelligence Report.
 * Tests the report generation pipeline: collect → attribute → summarize → HTML.
 *
 * Reference: docs/pseudocode.md PS-05
 */
import {
  RevenueReportService,
  RevenueReportServiceDeps,
  PQLDetectionReader,
  PQLDetectionForReport,
  CRMDealReader,
  CRMDealForReport,
  TenantReader,
  DialogReader,
  ReportEmailSender,
} from './revenue-report-service'
import { RevenueReportRepository } from '@revenue/infrastructure/repositories/revenue-report-repository'
import { RevenueReport, ReportPeriod } from '@revenue/domain/aggregates/revenue-report'

// ─── Mock factories ──────────────────────────────────────────────────────────

function createMockReportRepo(): jest.Mocked<RevenueReportRepository> {
  return {
    save: jest.fn(async (r: RevenueReport) => r),
    update: jest.fn(async (r: RevenueReport) => r),
    findById: jest.fn(async () => null),
    findByPeriod: jest.fn(async () => null),
    findByTenantId: jest.fn(async () => []),
  }
}

function createMockPQLReader(detections: PQLDetectionForReport[] = []): jest.Mocked<PQLDetectionReader> {
  return {
    findByTenantIdForPeriod: jest.fn(async () => detections),
  }
}

function createMockCRMReader(deals: CRMDealForReport[] = []): jest.Mocked<CRMDealReader> {
  return {
    findClosedDealsForPeriod: jest.fn(async () => deals),
  }
}

function createMockTenantReader(): jest.Mocked<TenantReader> {
  return {
    findAllActive: jest.fn(async () => [
      { id: 'tenant-001', name: 'Acme Corp', billingEmail: 'billing@acme.com' },
    ]),
    findById: jest.fn(async () => ({
      id: 'tenant-001',
      name: 'Acme Corp',
      billingEmail: 'billing@acme.com',
    })),
  }
}

function createMockDialogReader(): jest.Mocked<DialogReader> {
  return {
    findOperatorByDialogId: jest.fn(async () => 'operator-001'),
    countByTenantForPeriod: jest.fn(async () => 150),
  }
}

function createMockEmailSender(): jest.Mocked<ReportEmailSender> {
  return {
    send: jest.fn(async () => true),
  }
}

function createDefaultDetections(): PQLDetectionForReport[] {
  return [
    { id: 'det-1', dialogId: 'dlg-1', score: 0.85, tier: 'HOT', createdAt: new Date('2026-01-10') },
    { id: 'det-2', dialogId: 'dlg-2', score: 0.72, tier: 'WARM', createdAt: new Date('2026-01-15') },
    { id: 'det-3', dialogId: 'dlg-3', score: 0.45, tier: 'COLD', createdAt: new Date('2026-01-20') },
  ]
}

function createDefaultDeals(): CRMDealForReport[] {
  return [
    { id: 'deal-1', value: 12000, status: 'WON', closedAt: new Date('2026-01-25'), contactEmail: 'a@example.com' },
    { id: 'deal-2', value: 4800, status: 'WON', closedAt: new Date('2026-01-28'), contactEmail: 'b@example.com' },
  ]
}

const DEFAULT_PERIOD: ReportPeriod = { year: 2026, month: 1 }

function buildService(overrides: Partial<RevenueReportServiceDeps> = {}): {
  service: RevenueReportService
  deps: RevenueReportServiceDeps
} {
  const deps: RevenueReportServiceDeps = {
    reportRepo: createMockReportRepo(),
    pqlReader: createMockPQLReader(createDefaultDetections()),
    crmReader: createMockCRMReader(createDefaultDeals()),
    tenantReader: createMockTenantReader(),
    dialogReader: createMockDialogReader(),
    emailSender: createMockEmailSender(),
    ...overrides,
  }
  return { service: new RevenueReportService(deps), deps }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RevenueReportService', () => {
  describe('generateReportForTenant', () => {
    it('should generate a report with correct summary from detections and deals', async () => {
      const { service, deps } = buildService()

      const report = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(report).toBeDefined()
      expect(report.tenantId).toBe('tenant-001')
      expect(report.period).toEqual(DEFAULT_PERIOD)
      expect(report.status).toBe('GENERATED')
      expect(report.summary).toBeDefined()
      expect(report.summary!.totalDialogs).toBe(150)
      expect(report.summary!.pqlDetected).toBe(3)
      // Only HOT and WARM get attributed (2 detections matched to 2 deals)
      expect(report.summary!.pqlConvertedToDeals).toBe(2)
      expect(report.summary!.totalRevenue).toBe(16800) // 12000 + 4800
      expect(report.htmlContent).toBeDefined()
      expect(report.htmlContent).toContain('Revenue Intelligence Report')

      // Should persist
      const repo = deps.reportRepo as jest.Mocked<RevenueReportRepository>
      expect(repo.save).toHaveBeenCalledTimes(1)
    })

    it('should calculate conversion rate correctly', async () => {
      const { service } = buildService()

      const report = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      // 2 converted / 3 detected = 0.67
      expect(report.summary!.pqlConversionRate).toBeCloseTo(0.67, 1)
    })

    it('should not regenerate an existing GENERATED report (idempotency)', async () => {
      const existingReport: RevenueReport = {
        id: 'existing-001',
        tenantId: 'tenant-001',
        period: DEFAULT_PERIOD,
        status: 'GENERATED',
        attributions: [],
        summary: {
          totalDialogs: 100,
          pqlDetected: 5,
          pqlConvertedToDeals: 2,
          pqlConversionRate: 0.4,
          totalRevenue: 5000,
          avgTimeToClose: 10,
          topOperators: [],
        },
        pdfUrl: null,
        htmlContent: '<html>existing</html>',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const reportRepo = createMockReportRepo()
      reportRepo.findByPeriod.mockResolvedValue(existingReport)
      const { service } = buildService({ reportRepo })

      const result = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(result.id).toBe('existing-001')
      expect(result.status).toBe('GENERATED')
      expect(reportRepo.save).not.toHaveBeenCalled()
      expect(reportRepo.update).not.toHaveBeenCalled()
    })

    it('should handle empty period with no detections', async () => {
      const { service } = buildService({
        pqlReader: createMockPQLReader([]),
        crmReader: createMockCRMReader([]),
        dialogReader: (() => {
          const reader = createMockDialogReader()
          reader.countByTenantForPeriod.mockResolvedValue(0)
          return reader
        })(),
      })

      const report = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(report.status).toBe('GENERATED')
      expect(report.summary!.totalDialogs).toBe(0)
      expect(report.summary!.pqlDetected).toBe(0)
      expect(report.summary!.pqlConvertedToDeals).toBe(0)
      expect(report.summary!.pqlConversionRate).toBe(0)
      expect(report.summary!.totalRevenue).toBe(0)
      expect(report.summary!.avgTimeToClose).toBe(0)
      expect(report.summary!.topOperators).toEqual([])
      expect(report.attributions).toEqual([])
    })

    it('should handle detections with no matching deals', async () => {
      const { service } = buildService({
        crmReader: createMockCRMReader([]),
      })

      const report = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(report.summary!.pqlDetected).toBe(3)
      expect(report.summary!.pqlConvertedToDeals).toBe(0)
      expect(report.summary!.totalRevenue).toBe(0)
      expect(report.attributions).toEqual([])
    })

    it('should calculate revenue attribution with correct time-to-close and confidence', async () => {
      const { service } = buildService()

      const report = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(report.attributions.length).toBe(2)

      // First attribution: det-1 (HOT, 2026-01-10) → deal-1 (closed 2026-01-25) = 15 days
      const attr1 = report.attributions[0]
      expect(attr1.pqlDetectionId).toBe('det-1')
      expect(attr1.dealId).toBe('deal-1')
      expect(attr1.dealValue).toBe(12000)
      expect(attr1.timeToClose).toBe(15)
      expect(attr1.operatorId).toBe('operator-001')
      expect(attr1.confidence).toBeGreaterThan(0)
      expect(attr1.confidence).toBeLessThanOrEqual(1)

      // Second attribution: det-2 (WARM, 2026-01-15) → deal-2 (closed 2026-01-28) = 13 days
      const attr2 = report.attributions[1]
      expect(attr2.pqlDetectionId).toBe('det-2')
      expect(attr2.dealId).toBe('deal-2')
      expect(attr2.dealValue).toBe(4800)
      expect(attr2.timeToClose).toBe(13)
    })

    it('should not attribute COLD tier detections to deals', async () => {
      const coldOnlyDetections: PQLDetectionForReport[] = [
        { id: 'det-cold', dialogId: 'dlg-c', score: 0.3, tier: 'COLD', createdAt: new Date('2026-01-10') },
      ]
      const deals: CRMDealForReport[] = [
        { id: 'deal-1', value: 5000, status: 'WON', closedAt: new Date('2026-01-20'), contactEmail: 'c@ex.com' },
      ]

      const { service } = buildService({
        pqlReader: createMockPQLReader(coldOnlyDetections),
        crmReader: createMockCRMReader(deals),
      })

      const report = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(report.attributions).toEqual([])
      expect(report.summary!.pqlConvertedToDeals).toBe(0)
    })

    it('should include top operators in summary', async () => {
      const { service } = buildService()

      const report = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(report.summary!.topOperators.length).toBeGreaterThan(0)
      const topOp = report.summary!.topOperators[0]
      expect(topOp.operatorId).toBe('operator-001')
      expect(topOp.dealsWon).toBe(2)
      expect(topOp.totalRevenue).toBe(16800)
    })

    it('should re-generate a DRAFT report that was left incomplete', async () => {
      const draftReport: RevenueReport = {
        id: 'draft-001',
        tenantId: 'tenant-001',
        period: DEFAULT_PERIOD,
        status: 'DRAFT',
        attributions: [],
        summary: null,
        pdfUrl: null,
        htmlContent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const reportRepo = createMockReportRepo()
      reportRepo.findByPeriod.mockResolvedValue(draftReport)
      const { service } = buildService({ reportRepo })

      const result = await service.generateReportForTenant('tenant-001', DEFAULT_PERIOD)

      expect(result.id).toBe('draft-001')
      expect(result.status).toBe('GENERATED')
      expect(reportRepo.update).toHaveBeenCalledTimes(1)
      expect(reportRepo.save).not.toHaveBeenCalled()
    })
  })

  describe('generateMonthlyReports', () => {
    it('should generate reports for all active tenants', async () => {
      const tenantReader = createMockTenantReader()
      tenantReader.findAllActive.mockResolvedValue([
        { id: 'tenant-001', name: 'Acme', billingEmail: 'a@a.com' },
        { id: 'tenant-002', name: 'Beta', billingEmail: 'b@b.com' },
      ])

      const { service } = buildService({ tenantReader })

      const result = await service.generateMonthlyReports()

      expect(result.generated).toBe(2)
      expect(result.errors).toEqual([])
    })

    it('should collect errors without stopping other tenants', async () => {
      const tenantReader = createMockTenantReader()
      tenantReader.findAllActive.mockResolvedValue([
        { id: 'tenant-001', name: 'Acme', billingEmail: 'a@a.com' },
        { id: 'tenant-fail', name: 'Fail Co', billingEmail: 'f@f.com' },
      ])

      const reportRepo = createMockReportRepo()
      let callCount = 0
      reportRepo.save.mockImplementation(async (r: RevenueReport) => {
        callCount++
        if (callCount === 2) throw new Error('DB connection lost')
        return r
      })

      const { service } = buildService({ reportRepo, tenantReader })

      const result = await service.generateMonthlyReports()

      expect(result.generated).toBe(1)
      expect(result.errors.length).toBe(1)
      expect(result.errors[0]).toContain('tenant-fail')
    })
  })

  describe('sendReport', () => {
    it('should send a GENERATED report via email', async () => {
      const generatedReport: RevenueReport = {
        id: 'report-001',
        tenantId: 'tenant-001',
        period: DEFAULT_PERIOD,
        status: 'GENERATED',
        attributions: [],
        summary: {
          totalDialogs: 100,
          pqlDetected: 5,
          pqlConvertedToDeals: 2,
          pqlConversionRate: 0.4,
          totalRevenue: 5000,
          avgTimeToClose: 10,
          topOperators: [],
        },
        pdfUrl: null,
        htmlContent: '<html>Report</html>',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const reportRepo = createMockReportRepo()
      reportRepo.findById.mockResolvedValue(generatedReport)
      const emailSender = createMockEmailSender()
      const { service } = buildService({ reportRepo, emailSender })

      const result = await service.sendReport('report-001')

      expect(result.status).toBe('SENT')
      expect(emailSender.send).toHaveBeenCalledTimes(1)
      expect(emailSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'billing@acme.com',
          subject: expect.stringContaining('2026-01'),
          html: '<html>Report</html>',
        }),
      )
    })

    it('should throw if report not found', async () => {
      const { service } = buildService()

      await expect(service.sendReport('nonexistent')).rejects.toThrow('not found')
    })

    it('should throw if report is still DRAFT', async () => {
      const draftReport: RevenueReport = {
        id: 'draft-001',
        tenantId: 'tenant-001',
        period: DEFAULT_PERIOD,
        status: 'DRAFT',
        attributions: [],
        summary: null,
        pdfUrl: null,
        htmlContent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const reportRepo = createMockReportRepo()
      reportRepo.findById.mockResolvedValue(draftReport)
      const { service } = buildService({ reportRepo })

      await expect(service.sendReport('draft-001')).rejects.toThrow('not yet generated')
    })
  })
})
