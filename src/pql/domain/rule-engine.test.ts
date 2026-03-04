/**
 * RuleEngine tests — PQL signal detection.
 * Reference: docs/pseudocode.md PS-02, FF-05 (coverage ≥95%)
 */
import { analyzeRules, RuleAnalysisResult } from './rule-engine'
import { DEFAULT_RULES, SignalRule } from './value-objects/rule-set'

describe('RuleEngine', () => {
  describe('analyzeRules', () => {
    it('should detect Enterprise signal', () => {
      const result = analyzeRules(
        'А у вас есть Enterprise-тариф для команды из 50 пользователей?',
        DEFAULT_RULES,
      )
      expect(result.signals.length).toBeGreaterThan(0)
      const types = result.signals.map(s => s.type)
      expect(types).toContain('ENTERPRISE')
      expect(types).toContain('SCALE')
    })

    it('should detect PURCHASE signals', () => {
      const result = analyzeRules(
        'Хотим оформить договор и оплатить счёт',
        DEFAULT_RULES,
      )
      const types = result.signals.map(s => s.type)
      expect(types).toContain('PURCHASE')
    })

    it('should detect multiple weak signals', () => {
      const result = analyzeRules(
        'Хотел бы посмотреть демо, интересует интеграция и SLA',
        DEFAULT_RULES,
      )
      expect(result.signals.length).toBeGreaterThanOrEqual(3)
      const types = result.signals.map(s => s.type)
      expect(types).toContain('DEMO')
      expect(types).toContain('TECHNICAL')
      expect(types).toContain('RELIABILITY')
    })

    it('should return empty result for non-PQL message', () => {
      const result = analyzeRules(
        'Спасибо, всё понятно',
        DEFAULT_RULES,
      )
      expect(result.signals.length).toBe(0)
      expect(result.normalizedScore).toBe(0)
    })

    it('should return empty result for empty content', () => {
      const result = analyzeRules('', DEFAULT_RULES)
      expect(result.signals.length).toBe(0)
    })

    it('should be case insensitive', () => {
      const result = analyzeRules('ENTERPRISE ТАРИФ', DEFAULT_RULES)
      expect(result.signals.length).toBeGreaterThan(0)
    })

    it('should normalize score between 0 and 1', () => {
      const result = analyzeRules(
        'Enterprise тариф для команды 50 человек, нужен договор, демо и интеграция с API',
        DEFAULT_RULES,
      )
      expect(result.normalizedScore).toBeGreaterThan(0)
      expect(result.normalizedScore).toBeLessThanOrEqual(1)
    })

    it('should return top 3 signals sorted by weight', () => {
      const result = analyzeRules(
        'Enterprise тариф для команды, договор и демо',
        DEFAULT_RULES,
      )
      expect(result.topSignals.length).toBeLessThanOrEqual(3)
      for (let i = 1; i < result.topSignals.length; i++) {
        expect(result.topSignals[i - 1].weight).toBeGreaterThanOrEqual(result.topSignals[i].weight)
      }
    })

    it('should handle long messages by truncating to 2000 chars (EC-02)', () => {
      const longMessage = 'Enterprise '.repeat(500) // ~5500 chars
      const result = analyzeRules(longMessage, DEFAULT_RULES)
      expect(result.signals.length).toBeGreaterThan(0)
    })

    it('should handle emoji in messages (EC-03)', () => {
      const result = analyzeRules(
        '🔥 Хотим Enterprise тариф! 🚀',
        DEFAULT_RULES,
      )
      const types = result.signals.map(s => s.type)
      expect(types).toContain('ENTERPRISE')
    })

    it('should work with custom rules', () => {
      const customRules: SignalRule[] = [
        { id: 'C01', pattern: /платн/i, weight: 0.70, type: 'CUSTOM_PURCHASE' },
      ]
      const result = analyzeRules('Хочу попробовать платную версию', customRules)
      expect(result.signals.length).toBe(1)
      expect(result.signals[0].type).toBe('CUSTOM_PURCHASE')
    })
  })
})
