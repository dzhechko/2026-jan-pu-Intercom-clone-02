/**
 * Revenue Summary value object — aggregated stats for a reporting period.
 * Reference: docs/pseudocode.md PS-05
 *
 * Computed from PQL detections and CRM deal data during report generation.
 */

export interface OperatorPerformance {
  readonly operatorId: string
  readonly dealsWon: number
  readonly totalRevenue: number
  readonly avgTimeToClose: number
}

export interface RevenueSummary {
  readonly totalDialogs: number
  readonly pqlDetected: number
  readonly pqlConvertedToDeals: number
  readonly pqlConversionRate: number // 0-1
  readonly totalRevenue: number
  readonly avgTimeToClose: number // days
  readonly topOperators: OperatorPerformance[]
}

/**
 * Build a RevenueSummary from raw metrics.
 */
export function buildRevenueSummary(params: {
  totalDialogs: number
  pqlDetected: number
  pqlConvertedToDeals: number
  totalRevenue: number
  avgTimeToClose: number
  topOperators: OperatorPerformance[]
}): RevenueSummary {
  return {
    totalDialogs: params.totalDialogs,
    pqlDetected: params.pqlDetected,
    pqlConvertedToDeals: params.pqlConvertedToDeals,
    pqlConversionRate:
      params.pqlDetected > 0
        ? Math.round((params.pqlConvertedToDeals / params.pqlDetected) * 100) / 100
        : 0,
    totalRevenue: params.totalRevenue,
    avgTimeToClose: params.avgTimeToClose,
    topOperators: params.topOperators,
  }
}
