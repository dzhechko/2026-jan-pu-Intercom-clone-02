/**
 * PQL Attribution value object — links a PQL detection to a closed CRM deal.
 * Reference: docs/pseudocode.md PS-05
 *
 * Captures the causal chain: PQL signal → operator engagement → deal closed.
 * Used in revenue reports to attribute revenue back to PQL intelligence.
 */

export interface PQLAttribution {
  readonly pqlDetectionId: string
  readonly dialogId: string
  readonly dealId: string
  readonly dealValue: number
  readonly closedAt: Date
  readonly timeToClose: number // days from PQL detection to deal close
  readonly operatorId: string | null
  readonly confidence: number // 0-1, how confident we are in the attribution
}

/**
 * Calculate time-to-close in days between PQL detection and deal closure.
 */
export function calculateTimeToClose(detectedAt: Date, closedAt: Date): number {
  const diffMs = closedAt.getTime() - detectedAt.getTime()
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)))
}

/**
 * Calculate attribution confidence based on temporal proximity and signal strength.
 * Closer detection-to-close = higher confidence.
 * Max 90 days window; beyond that, confidence drops to 0.
 */
export function calculateAttributionConfidence(
  timeToCloseDays: number,
  pqlScore: number,
): number {
  if (timeToCloseDays > 90) return 0
  const timeFactor = Math.max(0, 1 - timeToCloseDays / 90)
  const scoreFactor = pqlScore
  return Math.round(timeFactor * scoreFactor * 100) / 100
}
