/**
 * Revenue Report HTML Generator — FR-06.
 * Generates a styled HTML report suitable for email and PDF conversion.
 *
 * The HTML is self-contained (inline styles) so it renders correctly
 * both in email clients and in puppeteer PDF generation.
 */
import { ReportPeriod, formatPeriod } from '@revenue/domain/aggregates/revenue-report'
import { RevenueSummary } from '@revenue/domain/value-objects/revenue-summary'
import { PQLAttribution } from '@revenue/domain/value-objects/pql-attribution'

interface ReportHtmlParams {
  tenantName: string
  period: ReportPeriod
  summary: RevenueSummary
  attributions: PQLAttribution[]
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function generateReportHtml(params: ReportHtmlParams): string {
  const { tenantName, period, summary, attributions } = params
  const periodLabel = `${MONTH_NAMES[period.month - 1]} ${period.year}`
  const periodStr = formatPeriod(period)

  const conversionPct = (summary.pqlConversionRate * 100).toFixed(1)
  const revenueFormatted = summary.totalRevenue.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })

  const attributionRows = attributions
    .map(
      (a) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${a.dealId}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">$${a.dealValue.toLocaleString()}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${a.timeToClose}d</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${(a.confidence * 100).toFixed(0)}%</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${a.operatorId ?? 'N/A'}</td>
      </tr>`,
    )
    .join('')

  const operatorRows = summary.topOperators
    .map(
      (op) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${op.operatorId}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${op.dealsWon}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">$${op.totalRevenue.toLocaleString()}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${op.avgTimeToClose}d</td>
      </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Revenue Intelligence Report — ${periodLabel}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 32px; color: #1a1a2e; background: #ffffff;">

  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 24px; margin: 0 0 8px 0; color: #1a1a2e;">Revenue Intelligence Report</h1>
    <p style="font-size: 16px; color: #6b7280; margin: 0;">${tenantName} &mdash; ${periodLabel}</p>
  </div>

  <!-- KPI Summary Cards -->
  <div style="display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap;">
    <div style="flex: 1; min-width: 140px; background: #f0f9ff; border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #1d4ed8;">${summary.totalDialogs}</div>
      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">Total Dialogs</div>
    </div>
    <div style="flex: 1; min-width: 140px; background: #fef3c7; border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #d97706;">${summary.pqlDetected}</div>
      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">PQL Detected</div>
    </div>
    <div style="flex: 1; min-width: 140px; background: #d1fae5; border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #059669;">${conversionPct}%</div>
      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">PQL Conversion</div>
    </div>
    <div style="flex: 1; min-width: 140px; background: #ede9fe; border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 28px; font-weight: 700; color: #7c3aed;">${revenueFormatted}</div>
      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">Total Revenue</div>
    </div>
  </div>

  <!-- Additional Metrics -->
  <div style="display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap;">
    <div style="flex: 1; min-width: 180px; background: #f9fafb; border-radius: 8px; padding: 16px;">
      <div style="font-size: 14px; color: #6b7280;">PQL Converted to Deals</div>
      <div style="font-size: 22px; font-weight: 600; color: #1a1a2e;">${summary.pqlConvertedToDeals}</div>
    </div>
    <div style="flex: 1; min-width: 180px; background: #f9fafb; border-radius: 8px; padding: 16px;">
      <div style="font-size: 14px; color: #6b7280;">Avg. Time to Close</div>
      <div style="font-size: 22px; font-weight: 600; color: #1a1a2e;">${summary.avgTimeToClose} days</div>
    </div>
  </div>

  ${
    attributions.length > 0
      ? `
  <!-- Revenue Attribution Table -->
  <h2 style="font-size: 18px; margin-bottom: 12px;">Revenue Attribution</h2>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 32px;">
    <thead>
      <tr style="background: #f9fafb;">
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Deal ID</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Value</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Time to Close</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Confidence</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Operator</th>
      </tr>
    </thead>
    <tbody>
      ${attributionRows}
    </tbody>
  </table>`
      : `<p style="color: #6b7280; text-align: center; padding: 24px;">No revenue attributions for this period.</p>`
  }

  ${
    summary.topOperators.length > 0
      ? `
  <!-- Top Operators Table -->
  <h2 style="font-size: 18px; margin-bottom: 12px;">Top Operators</h2>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 32px;">
    <thead>
      <tr style="background: #f9fafb;">
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Operator</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Deals Won</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Revenue</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Avg. Time to Close</th>
      </tr>
    </thead>
    <tbody>
      ${operatorRows}
    </tbody>
  </table>`
      : ''
  }

  <div style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
    KommuniQ Revenue Intelligence &mdash; Report generated ${new Date().toISOString().split('T')[0]}
  </div>

</body>
</html>`
}
