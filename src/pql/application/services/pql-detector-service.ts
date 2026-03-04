/**
 * PQL Detector Service — PS-01 signal analysis pipeline.
 * Analyzes incoming CLIENT messages for purchase-qualified signals.
 *
 * Flow:
 *   1. Receive message event (content, dialogId, tenantId)
 *   2. Run RuleEngine.analyzeRules() to detect signals
 *   3. Determine tier: >= 0.80 HOT, >= 0.65 WARM, else COLD
 *   4. Persist detection via PQLDetectionRepository
 *   5. Update dialog's pqlScore/pqlTier via DialogRepository
 *   6. Return PQLDetection result for event emission
 *
 * Reference: docs/pseudocode.md PS-01
 */
import { v4 as uuidv4 } from 'uuid'
import { analyzeRules, RuleAnalysisResult } from '@pql/domain/rule-engine'
import { DEFAULT_RULES } from '@pql/domain/value-objects/rule-set'
import { calculateTier, PQLTier } from '@pql/domain/value-objects/pql-score'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PQLDetection {
  id: string
  dialogId: string
  tenantId: string
  messageId: string
  score: number
  tier: PQLTier
  signals: Array<{
    ruleId: string
    type: string
    weight: number
    matchedText: string
  }>
  topSignals: Array<{
    ruleId: string
    type: string
    weight: number
    matchedText: string
  }>
  createdAt: Date
}

export interface MessageEvent {
  messageId: string
  dialogId: string
  tenantId: string
  content: string
  senderType: 'CLIENT' | 'OPERATOR' | 'BOT'
}

export interface PQLDetectionRepository {
  save(detection: PQLDetection): Promise<PQLDetection>
  findByDialogId(dialogId: string): Promise<PQLDetection[]>
  findByTenantId(tenantId: string, options?: { limit?: number; offset?: number }): Promise<PQLDetection[]>
}

export interface DialogPQLUpdater {
  updatePQLScore(dialogId: string, score: number, tier: PQLTier): Promise<unknown>
}

// ─── Service ────────────────────────────────────────────────────────────────

export class PQLDetectorService {
  constructor(
    private readonly detectionRepo: PQLDetectionRepository,
    private readonly dialogUpdater: DialogPQLUpdater,
  ) {}

  /**
   * Analyze a message for PQL signals.
   * Only CLIENT messages are analyzed (OPERATOR/BOT are skipped per PS-01).
   *
   * Returns null if:
   * - senderType is not CLIENT
   * - no signals detected (score === 0)
   */
  async analyze(event: MessageEvent): Promise<PQLDetection | null> {
    // PS-01: Only analyze CLIENT messages
    if (event.senderType !== 'CLIENT') {
      return null
    }

    // Run the rule engine
    const result: RuleAnalysisResult = analyzeRules(event.content, DEFAULT_RULES)

    // Skip if no signals detected
    if (result.signals.length === 0) {
      return null
    }

    // Calculate tier
    const tier = calculateTier(result.normalizedScore)

    // Build detection record
    const detection: PQLDetection = {
      id: uuidv4(),
      dialogId: event.dialogId,
      tenantId: event.tenantId,
      messageId: event.messageId,
      score: result.normalizedScore,
      tier,
      signals: result.signals.map((s) => ({
        ruleId: s.ruleId,
        type: s.type,
        weight: s.weight,
        matchedText: s.matchedText,
      })),
      topSignals: result.topSignals.map((s) => ({
        ruleId: s.ruleId,
        type: s.type,
        weight: s.weight,
        matchedText: s.matchedText,
      })),
      createdAt: new Date(),
    }

    // Persist detection
    await this.detectionRepo.save(detection)

    // Update dialog aggregate with latest PQL score/tier
    await this.dialogUpdater.updatePQLScore(event.dialogId, result.normalizedScore, tier)

    return detection
  }
}
