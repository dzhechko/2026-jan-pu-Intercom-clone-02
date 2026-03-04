/**
 * Revenue Report Service — FR-06 Revenue Intelligence Report.
 * Reference: docs/pseudocode.md PS-05
 *
 * Orchestrates monthly revenue report generation:
 * 1. Collect PQL detections for the period
 * 2. Cross-reference with CRM deals (mock data for now)
 * 3. Calculate attribution and summary
 * 4. Generate HTML report (PDF via puppeteer when available)
 * 5. Emit ReportGenerated domain event
 */
import { v4 as uuidv4 } from 'uuid'
import {
  RevenueReport,
  ReportPeriod,
  createRevenueReport,
  markReportGenerated,
  markReportSent,
  formatPeriod,
  getPeriodDateRange,
} from '@revenue/domain/aggregates/revenue-report'
import {
  PQLAttribution,
  calculateTimeToClose,
  calculateAttributionConfidence,
} from '@revenue/domain/value-objects/pql-attribution'
import {
  RevenueSummary,
  OperatorPerformance,
  buildRevenueSummary,
} from '@revenue/domain/value-objects/revenue-summary'
import { RevenueReportRepository } from '@revenue/infrastructure/repositories/revenue-report-repository'
import { generateReportHtml } from '@revenue/infrastructure/report-html-generator'

// ─── Ports ─────────────────────────────────────────────────────────────────

/**
 * Minimal PQL detection data needed for attribution.
 */
export interface PQLDetectionForReport {
  id: string
  dialogId: string
  score: number
  tier: 'HOT' | 'WARM' | 'COLD'
  createdAt: Date
}

/**
 * Port for reading PQL detections — implemented by PgPQLDetectionRepository.
 */
export interface PQLDetectionReader {
  findByTenantIdForPeriod(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<PQLDetectionForReport[]>
}

/**
 * Minimal CRM deal data for attribution.
 */
export interface CRMDealForReport {
  id: string
  value: number
  status: 'OPEN' | 'WON' | 'LOST'
  closedAt: Date | null
  contactEmail: string
}

/**
 * Port for CRM deal lookups — can be backed by real adapter or mock.
 */
export interface CRMDealReader {
  findClosedDealsForPeriod(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<CRMDealForReport[]>
}

/**
 * Port for tenant lookup — need billingEmail for sending reports.
 */
export interface TenantReader {
  findAllActive(): Promise<Array<{ id: string; name: string; billingEmail: string }>>
  findById(id: string): Promise<{ id: string; name: string; billingEmail: string } | null>
}

/**
 * Port for dialog lookup — need operatorId for attribution.
 */
export interface DialogReader {
  findOperatorByDialogId(dialogId: string): Promise<string | null>
  countByTenantForPeriod(tenantId: string, start: Date, end: Date): Promise<number>
}

/**
 * Port for email sending.
 */
export interface ReportEmailSender {
  send(payload: { to: string; subject: string; html: string }): Promise<boolean>
}

// ─── Service ───────────────────────────────────────────────────────────────

export interface RevenueReportServiceDeps {
  reportRepo: RevenueReportRepository
  pqlReader: PQLDetectionReader
  crmReader: CRMDealReader
  tenantReader: TenantReader
  dialogReader: DialogReader
  emailSender: ReportEmailSender
}

export class RevenueReportService {
  constructor(private readonly deps: RevenueReportServiceDeps) {}

  /**
   * Generate a revenue report for a specific tenant and period.
   * Idempotent: returns existing report if already generated.
   */
  async generateReportForTenant(
    tenantId: string,
    period: ReportPeriod,
  ): Promise<RevenueReport> {
    // 1. Check if report already exists (idempotency)
    const existing = await this.deps.reportRepo.findByPeriod(tenantId, period)
    if (existing && existing.status !== 'DRAFT') {
      return existing
    }

    // 2. Get period date range
    const { start, end } = getPeriodDateRange(period)

    // 3. Collect PQL detections for the period
    const detections = await this.deps.pqlReader.findByTenantIdForPeriod(
      tenantId,
      start,
      end,
    )

    // 4. Get closed deals from CRM
    const deals = await this.deps.crmReader.findClosedDealsForPeriod(
      tenantId,
      start,
      end,
    )

    // 5. Count total dialogs for the period
    const totalDialogs = await this.deps.dialogReader.countByTenantForPeriod(
      tenantId,
      start,
      end,
    )

    // 6. Build attributions: match PQL detections to closed deals
    const attributions = await this.buildAttributions(detections, deals)

    // 7. Calculate summary
    const summary = this.calculateSummary(
      totalDialogs,
      detections,
      attributions,
    )

    // 8. Create or reuse draft report
    const report = existing ?? createRevenueReport(tenantId, period)

    // 9. Generate HTML content
    const tenant = await this.deps.tenantReader.findById(tenantId)
    const htmlContent = generateReportHtml({
      tenantName: tenant?.name ?? 'Unknown',
      period,
      summary,
      attributions,
    })

    // 10. Mark as GENERATED
    const generated = markReportGenerated(
      report,
      summary,
      attributions,
      htmlContent,
      null, // PDF URL — generated on-demand via /reports/:id/pdf
    )

    // 11. Persist
    if (existing) {
      return this.deps.reportRepo.update(generated)
    }
    return this.deps.reportRepo.save(generated)
  }

  /**
   * Send a generated report via email.
   */
  async sendReport(reportId: string): Promise<RevenueReport> {
    const report = await this.deps.reportRepo.findById(reportId)
    if (!report) {
      throw new Error(`Report ${reportId} not found`)
    }
    if (report.status === 'SENT') {
      return report
    }
    if (report.status !== 'GENERATED') {
      throw new Error(`Report ${reportId} is not yet generated (status: ${report.status})`)
    }

    const tenant = await this.deps.tenantReader.findById(report.tenantId)
    if (!tenant) {
      throw new Error(`Tenant ${report.tenantId} not found`)
    }

    const periodStr = formatPeriod(report.period)
    await this.deps.emailSender.send({
      to: tenant.billingEmail,
      subject: `KommuniQ Revenue Report — ${periodStr}`,
      html: report.htmlContent ?? '<p>Report content unavailable</p>',
    })

    const sent = markReportSent(report)
    return this.deps.reportRepo.update(sent)
  }

  /**
   * Generate monthly reports for all active tenants.
   * Called by cron on the 1st of each month.
   */
  async generateMonthlyReports(): Promise<{ generated: number; errors: string[] }> {
    const now = new Date()
    // Generate for the previous month
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const period: ReportPeriod = { year: prevYear, month: prevMonth }

    const tenants = await this.deps.tenantReader.findAllActive()
    let generated = 0
    const errors: string[] = []

    for (const tenant of tenants) {
      try {
        await this.generateReportForTenant(tenant.id, period)
        generated++
        console.log(`[RevenueReportService] Generated report for tenant ${tenant.id}, period ${formatPeriod(period)}`)
      } catch (error) {
        const msg = `Tenant ${tenant.id}: ${error instanceof Error ? error.message : String(error)}`
        errors.push(msg)
        console.error(`[RevenueReportService] Error generating report:`, msg)
      }
    }

    return { generated, errors }
  }

  /**
   * Match PQL detections to closed deals to build attributions.
   * Simple heuristic: match by dialogId → operatorId → deal.
   * In production, this would use more sophisticated matching.
   */
  private async buildAttributions(
    detections: PQLDetectionForReport[],
    deals: CRMDealForReport[],
  ): Promise<PQLAttribution[]> {
    if (detections.length === 0 || deals.length === 0) {
      return []
    }

    const attributions: PQLAttribution[] = []

    // Simple attribution: assign deals round-robin to HOT/WARM detections
    // In production, this would match via contact email linkage
    const qualifiedDetections = detections.filter(
      (d) => d.tier === 'HOT' || d.tier === 'WARM',
    )
    const wonDeals = deals.filter((d) => d.status === 'WON' && d.closedAt)

    for (let i = 0; i < Math.min(qualifiedDetections.length, wonDeals.length); i++) {
      const detection = qualifiedDetections[i]
      const deal = wonDeals[i]

      const operatorId = await this.deps.dialogReader.findOperatorByDialogId(
        detection.dialogId,
      )
      const timeToClose = calculateTimeToClose(detection.createdAt, deal.closedAt!)
      const confidence = calculateAttributionConfidence(timeToClose, detection.score)

      attributions.push({
        pqlDetectionId: detection.id,
        dialogId: detection.dialogId,
        dealId: deal.id,
        dealValue: deal.value,
        closedAt: deal.closedAt!,
        timeToClose,
        operatorId,
        confidence,
      })
    }

    return attributions
  }

  /**
   * Calculate revenue summary from detections and attributions.
   */
  private calculateSummary(
    totalDialogs: number,
    detections: PQLDetectionForReport[],
    attributions: PQLAttribution[],
  ): RevenueSummary {
    const totalRevenue = attributions.reduce((sum, a) => sum + a.dealValue, 0)
    const avgTimeToClose =
      attributions.length > 0
        ? Math.round(
            attributions.reduce((sum, a) => sum + a.timeToClose, 0) / attributions.length,
          )
        : 0

    // Group by operator for top performers
    const operatorMap = new Map<
      string,
      { dealsWon: number; totalRevenue: number; totalTime: number }
    >()
    for (const attr of attributions) {
      const opId = attr.operatorId ?? 'unassigned'
      const existing = operatorMap.get(opId) ?? {
        dealsWon: 0,
        totalRevenue: 0,
        totalTime: 0,
      }
      operatorMap.set(opId, {
        dealsWon: existing.dealsWon + 1,
        totalRevenue: existing.totalRevenue + attr.dealValue,
        totalTime: existing.totalTime + attr.timeToClose,
      })
    }

    const topOperators: OperatorPerformance[] = Array.from(operatorMap.entries())
      .map(([operatorId, stats]) => ({
        operatorId,
        dealsWon: stats.dealsWon,
        totalRevenue: stats.totalRevenue,
        avgTimeToClose: Math.round(stats.totalTime / stats.dealsWon),
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5)

    return buildRevenueSummary({
      totalDialogs,
      pqlDetected: detections.length,
      pqlConvertedToDeals: attributions.length,
      totalRevenue,
      avgTimeToClose,
      topOperators,
    })
  }
}
