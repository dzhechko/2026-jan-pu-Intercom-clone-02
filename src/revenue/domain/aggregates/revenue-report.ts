/**
 * RevenueReport aggregate root — BC-03 Revenue Intelligence.
 * Reference: docs/pseudocode.md PS-05
 *
 * Lifecycle: DRAFT → GENERATED → SENT
 * A report is created as DRAFT during data collection,
 * transitions to GENERATED once PDF is ready,
 * and to SENT after email delivery.
 */
import { v4 as uuidv4 } from 'uuid'
import { PQLAttribution } from '../value-objects/pql-attribution'
import { RevenueSummary } from '../value-objects/revenue-summary'

export type ReportStatus = 'DRAFT' | 'GENERATED' | 'SENT'

export interface ReportPeriod {
  readonly year: number
  readonly month: number // 1-12
}

export interface RevenueReport {
  readonly id: string
  readonly tenantId: string
  readonly period: ReportPeriod
  readonly status: ReportStatus
  readonly attributions: PQLAttribution[]
  readonly summary: RevenueSummary | null
  readonly pdfUrl: string | null
  readonly htmlContent: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * Create a new DRAFT revenue report.
 */
export function createRevenueReport(
  tenantId: string,
  period: ReportPeriod,
): RevenueReport {
  const now = new Date()
  return {
    id: uuidv4(),
    tenantId,
    period,
    status: 'DRAFT',
    attributions: [],
    summary: null,
    pdfUrl: null,
    htmlContent: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Transition report to GENERATED with summary, attributions, and HTML content.
 */
export function markReportGenerated(
  report: RevenueReport,
  summary: RevenueSummary,
  attributions: PQLAttribution[],
  htmlContent: string,
  pdfUrl: string | null,
): RevenueReport {
  return {
    ...report,
    status: 'GENERATED',
    summary,
    attributions,
    htmlContent,
    pdfUrl,
    updatedAt: new Date(),
  }
}

/**
 * Transition report to SENT after email delivery.
 */
export function markReportSent(report: RevenueReport): RevenueReport {
  return {
    ...report,
    status: 'SENT',
    updatedAt: new Date(),
  }
}

/**
 * Format period as "YYYY-MM" string for storage and display.
 */
export function formatPeriod(period: ReportPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`
}

/**
 * Parse "YYYY-MM" string into ReportPeriod.
 */
export function parsePeriod(periodStr: string): ReportPeriod {
  const [year, month] = periodStr.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Invalid period format: ${periodStr}. Expected YYYY-MM.`)
  }
  return { year, month }
}

/**
 * Get start and end dates for a report period.
 */
export function getPeriodDateRange(period: ReportPeriod): { start: Date; end: Date } {
  const start = new Date(period.year, period.month - 1, 1)
  const end = new Date(period.year, period.month, 1) // first day of next month
  return { start, end }
}
