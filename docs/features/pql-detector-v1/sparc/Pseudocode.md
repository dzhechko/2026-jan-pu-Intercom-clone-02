# Pseudocode: FR-01 PQL Detector v1 (Rule-Based)

**Feature ID:** FR-01
**Bounded Context:** BC-02 PQL Intelligence
**Reference:** docs/pseudocode.md PS-01, PS-02
**Status:** Implemented
**Version:** 1.0 | **Date:** 2026-03-04

---

## ALG-01: normalizeContent(content)

**Purpose:** Prepare raw message text for regex matching.
**SLA:** < 1 ms
**Implementation:** `src/pql/domain/rule-engine.ts` — `normalizeContent()`

```pseudocode
FUNCTION normalizeContent(content: string) -> string:

  // Step 1: Strip Unicode emoji block (EC-03)
  // Range: U+1F600 to U+1F9FF covers most common emoji
  content = content.replace(/[\u{1F600}-\u{1F9FF}]/gu, '')

  // Step 2: Lowercase (enables case-insensitive matching)
  content = content.toLowerCase()

  // Step 3: Strip leading/trailing whitespace
  content = content.trim()

  // Step 4: Collapse multiple spaces into one
  content = content.replace(/\s+/g, ' ')

  RETURN content

END FUNCTION
```

**Note:** Normalization is applied AFTER truncation to avoid wasted processing on truncated characters.

---

## ALG-02: analyzeRules(content, rules)

**Purpose:** Core rule engine — match signals, accumulate weights, normalize score.
**SLA:** < 50 ms
**Implementation:** `src/pql/domain/rule-engine.ts` — `analyzeRules()`
**Reference:** docs/pseudocode.md PS-02

```pseudocode
FUNCTION analyzeRules(content: string, rules: SignalRule[]) -> RuleAnalysisResult:

  // Step 1: Guard — empty content
  IF content IS NULL OR content.trim().length == 0 THEN
    RETURN { signals: [], rawScore: 0, normalizedScore: 0, topSignals: [] }
  END IF

  // Step 2: Truncate to 2000 chars (EC-02 — long message protection)
  IF content.length > 2000 THEN
    content = content.slice(0, 2000)
  END IF

  // Step 3: Normalize for matching
  normalizedContent = normalizeContent(content)

  // Step 4: Match each rule
  matchedSignals = []
  totalWeight = 0.0

  FOR each rule IN rules:
    match = normalizedContent.match(rule.pattern)
    IF match IS NOT NULL THEN
      matchedSignals.append(SignalMatch {
        ruleId:      rule.id,
        type:        rule.type,
        weight:      rule.weight,
        matchedText: match[0]       // first match occurrence
      })
      totalWeight += rule.weight
    END IF
  END FOR

  // Step 5: Normalize score
  // MAX_POSSIBLE_WEIGHT = sum of top-5 rule weights = 2.25
  // This caps the score at 1.0 even if all 15 rules fire
  normalizedScore = MIN(totalWeight / MAX_POSSIBLE_WEIGHT, 1.0)

  // Step 6: Extract top-3 signals by weight
  topSignals = matchedSignals
    .sortDescendingBy(s => s.weight)
    .take(3)

  RETURN RuleAnalysisResult {
    signals:         matchedSignals,
    rawScore:        totalWeight,
    normalizedScore: normalizedScore,
    topSignals:      topSignals
  }

END FUNCTION
```

**Complexity:** O(R * M) where R = number of rules (15), M = message length (capped at 2,000). Practically O(1).

---

## ALG-03: calculateTier(score)

**Purpose:** Map normalized score to categorical tier.
**SLA:** < 0.1 ms
**Implementation:** `src/pql/domain/value-objects/pql-score.ts` — `calculateTier()`

```pseudocode
FUNCTION calculateTier(score: number) -> PQLTier:

  IF score >= 0.80 THEN
    RETURN 'HOT'    // Strong purchase intent — escalate to sales immediately
  ELSE IF score >= 0.65 THEN
    RETURN 'WARM'   // Moderate intent — flag for operator attention
  ELSE
    RETURN 'COLD'   // Weak signal — log for ML training, no urgent action
  END IF

END FUNCTION
```

**Tier boundary rationale:**
- HOT (>= 0.80): Requires minimum 3–4 strong signals or 2 very strong ones. Example: PURCHASE(0.60) + ENTERPRISE(0.50) + DEMO(0.45) = 1.55 → 0.689 WARM. Adding BUDGET(0.45) = 2.00 → 0.889 HOT.
- WARM (>= 0.65): Meaningful purchase intent, not yet urgent.
- COLD (< 0.65): Informational or single weak signal — recorded for ML training.

---

## ALG-04: PQLDetectorService.analyze(event)

**Purpose:** Orchestrate full detection pipeline for an incoming message.
**SLA:** < 2,000 ms end-to-end
**Implementation:** `src/pql/application/services/pql-detector-service.ts` — `PQLDetectorService.analyze()`
**Reference:** docs/pseudocode.md PS-01 (v1 subset — no CRM context boost in current impl)

```pseudocode
FUNCTION analyze(event: MessageEvent) -> PQLDetection | null:

  // Step 1: Guard — only analyze CLIENT messages
  IF event.senderType != 'CLIENT' THEN
    RETURN null
  END IF

  // Step 2: Choose scoring path (v1 rule-based OR v2 ML if available)
  IF mlModelService IS AVAILABLE THEN
    mlPrediction = await mlModelService.predict(event.tenantId, event.content)
    IF mlPrediction IS NOT NULL THEN
      // v2 ML path
      score     = mlPrediction.score
      tier      = mlPrediction.tier
      signals   = mlPrediction.signals
      topSignals = mlPrediction.topSignals
    ELSE
      // ML not ready — fall back to rule-v1
      GOTO rule_v1_path
    END IF
  ELSE
    rule_v1_path:
    // Step 3: Run rule engine
    result    = analyzeRules(event.content, DEFAULT_RULES)
    score     = result.normalizedScore
    tier      = calculateTier(score)
    signals   = result.signals
    topSignals = result.topSignals
  END IF

  // Step 4: Guard — no signals detected
  IF signals.length == 0 THEN
    RETURN null   // Do not persist zero-signal detections
  END IF

  // Step 5: Build detection record
  detection = PQLDetection {
    id:         UUID.new(),
    dialogId:   event.dialogId,
    tenantId:   event.tenantId,
    messageId:  event.messageId,
    score:      score,
    tier:       tier,
    signals:    signals.map(mapToStorageFormat),
    topSignals: topSignals.map(mapToStorageFormat),
    createdAt:  NOW()
  }

  // Step 6: Persist detection (INSERT pql.detections)
  await detectionRepository.save(detection)

  // Step 7: Update dialog aggregate (denormalized pql_score/pql_tier)
  await dialogUpdater.updatePQLScore(event.dialogId, score, tier)

  RETURN detection

END FUNCTION
```

---

## ALG-05: PQL Message Consumer Pipeline

**Purpose:** Wire Socket.io event to PQL analysis and broadcast result.
**Implementation:** `src/pql/infrastructure/message-consumer.ts`

```pseudocode
ON_EVENT 'pql:analyze' FROM socket IN /chat namespace:

  // Step 1: Validate payload structure
  payload = event.payload as MessageEvent
  IF payload.messageId IS FALSY
  OR payload.dialogId  IS FALSY
  OR payload.tenantId  IS FALSY
  OR payload.content   IS FALSY THEN
    LOG warning: "Invalid pql:analyze payload"
    RETURN  // silent skip — fire-and-forget
  END IF

  // Step 2: Run detection pipeline
  TRY
    detection = await pqlDetector.analyze(payload)

    // Step 3: Broadcast if signals detected
    IF detection IS NOT NULL THEN
      chatNamespace.to('tenant:' + payload.tenantId).emit('pql:detected', {
        detectionId: detection.id,
        dialogId:    detection.dialogId,
        tenantId:    detection.tenantId,
        score:       detection.score,
        tier:        detection.tier,
        topSignals:  detection.topSignals
      })

      // Step 4: Optional — trigger PQL Pulse notification (FR-11)
      IF notificationService IS AVAILABLE THEN
        await notificationService.processNewPQLDetection({
          detectionId:        detection.id,
          dialogId:           detection.dialogId,
          tenantId:           detection.tenantId,
          score:              detection.score,
          tier:               detection.tier,
          topSignals:         detection.topSignals,
          contactEmail:       null,  // enriched from dialog context if available
          assignedOperatorId: null
        })
      END IF
    END IF

  CATCH error:
    LOG error: "[pql-consumer] analysis error"  // non-blocking, never throws
  END TRY

END ON_EVENT
```

---

## ALG-06: Score Normalization — Example Calculations

```
Message: "А у вас есть Enterprise-тариф для команды из 50 пользователей?"

Matched rules:
  R02 ENTERPRISE  weight=0.50  match="enterprise"
  R01 PRICING     weight=0.40  match="тариф"
  R03 SCALE       weight=0.35  match="команды"
  R03 SCALE       weight=0.35  match="пользователей"   ← only first match counted per rule
                                                          (regex returns first match)

totalWeight    = 0.50 + 0.40 + 0.35 = 1.25
normalizedScore = min(1.25 / 2.25, 1.0) = 0.556
tier           = COLD

---

Message: "Хотим оформить договор на enterprise тариф, обсудим бюджет на квартал"

Matched rules:
  R06 PURCHASE    weight=0.60  match="договор"
  R02 ENTERPRISE  weight=0.50  match="enterprise"
  R01 PRICING     weight=0.40  match="тариф"
  R13 BUDGET      weight=0.45  match="бюджет"
  R13 BUDGET      (second match "квартал" — same rule, not double counted)

totalWeight    = 0.60 + 0.50 + 0.40 + 0.45 = 1.95
normalizedScore = min(1.95 / 2.25, 1.0) = 0.867
tier           = HOT

topSignals = [PURCHASE(0.60), ENTERPRISE(0.50), BUDGET(0.45)]
```

**Key insight:** Each rule can only match once per message (regex returns first match). To reach HOT tier (>= 0.80 × 2.25 = 1.80 raw), a message needs multiple strong signals.
