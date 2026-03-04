/**
 * RuleEngine — PQL signal detection via regex pattern matching.
 * Reference: docs/pseudocode.md PS-02
 *
 * SLA: <50ms per analysis
 * Coverage requirement: ≥95% (FF-05)
 */
import { SignalRule, SignalMatch, MAX_POSSIBLE_WEIGHT } from './value-objects/rule-set'

export interface RuleAnalysisResult {
  readonly signals: SignalMatch[]
  readonly rawScore: number
  readonly normalizedScore: number
  readonly topSignals: SignalMatch[]
}

/**
 * Normalize message content: strip emoji, trim, normalize whitespace.
 * Reference: docs/refinement.md EC-03
 */
function normalizeContent(content: string): string {
  return content
    .replace(/[\u{1F600}-\u{1F9FF}]/gu, '')  // strip emoji
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function analyzeRules(content: string, rules: SignalRule[]): RuleAnalysisResult {
  if (!content || content.trim().length === 0) {
    return { signals: [], rawScore: 0, normalizedScore: 0, topSignals: [] }
  }

  // Truncate to 2000 chars for performance (EC-02)
  const normalizedContent = normalizeContent(
    content.length > 2000 ? content.slice(0, 2000) : content
  )

  const matchedSignals: SignalMatch[] = []
  let totalWeight = 0

  for (const rule of rules) {
    const match = normalizedContent.match(rule.pattern)
    if (match) {
      matchedSignals.push({
        ruleId: rule.id,
        type: rule.type,
        weight: rule.weight,
        matchedText: match[0],
      })
      totalWeight += rule.weight
    }
  }

  const normalizedScore = Math.min(totalWeight / MAX_POSSIBLE_WEIGHT, 1.0)

  const topSignals = [...matchedSignals]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)

  return {
    signals: matchedSignals,
    rawScore: totalWeight,
    normalizedScore,
    topSignals,
  }
}
