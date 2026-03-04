/**
 * RuleSet value object — PQL signal detection rules.
 * Reference: docs/tactical-design.md AGG-02, 15 default rules
 */

export interface SignalRule {
  readonly id: string
  readonly pattern: RegExp
  readonly weight: number
  readonly type: string
}

export interface SignalMatch {
  readonly ruleId: string
  readonly type: string
  readonly weight: number
  readonly matchedText: string
}

export const DEFAULT_RULES: SignalRule[] = [
  { id: 'R01', pattern: /тариф|pricing|стоимость/i,       weight: 0.40, type: 'PRICING' },
  { id: 'R02', pattern: /enterprise|корпоратив/i,          weight: 0.50, type: 'ENTERPRISE' },
  { id: 'R03', pattern: /команда|пользователей|seats/i,    weight: 0.35, type: 'SCALE' },
  { id: 'R04', pattern: /интеграц|api|webhook/i,           weight: 0.30, type: 'TECHNICAL' },
  { id: 'R05', pattern: /демо|показать|посмотреть/i,       weight: 0.45, type: 'DEMO' },
  { id: 'R06', pattern: /договор|счёт|оплат/i,             weight: 0.60, type: 'PURCHASE' },
  { id: 'R07', pattern: /руководитель|директор|ceo|cto/i,  weight: 0.40, type: 'DECISION_MAKER' },
  { id: 'R08', pattern: /сравни|vs|альтернатив/i,          weight: 0.35, type: 'EVALUATION' },
  { id: 'R09', pattern: /внедрен|migrate|перейти/i,        weight: 0.45, type: 'MIGRATION' },
  { id: 'R10', pattern: /sla|uptime|гарантия/i,            weight: 0.30, type: 'RELIABILITY' },
  { id: 'R11', pattern: /безопасност|152-фз|gdpr/i,        weight: 0.30, type: 'COMPLIANCE' },
  { id: 'R12', pattern: /пилот|тест|попробова/i,           weight: 0.40, type: 'TRIAL' },
  { id: 'R13', pattern: /бюджет|квартал|план/i,            weight: 0.45, type: 'BUDGET' },
  { id: 'R14', pattern: /партнёр|реселл|агент/i,           weight: 0.35, type: 'PARTNERSHIP' },
  { id: 'R15', pattern: /обучен|onboard|внедр/i,           weight: 0.30, type: 'ONBOARDING' },
]

// Maximum possible weight = sum of top-5 weights ≈ 2.25
export const MAX_POSSIBLE_WEIGHT = DEFAULT_RULES
  .map(r => r.weight)
  .sort((a, b) => b - a)
  .slice(0, 5)
  .reduce((sum, w) => sum + w, 0)
