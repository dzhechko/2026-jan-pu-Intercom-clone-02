/**
 * PQLScore value object.
 * Reference: docs/tactical-design.md AGG-01
 */

export type PQLTier = 'HOT' | 'WARM' | 'COLD'

export interface PQLScore {
  readonly value: number       // 0.0 – 1.0
  readonly tier: PQLTier
  readonly topSignals: Array<{ type: string; weight: number }>
}

export function calculateTier(score: number): PQLTier {
  if (score >= 0.80) return 'HOT'
  if (score >= 0.65) return 'WARM'
  return 'COLD'
}
