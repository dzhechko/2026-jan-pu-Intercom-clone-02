# FR-10: PQL ML v1 -- Pseudocode

## Algorithm 1: Weight Adjustment (trainModel)

This is the core learning algorithm. It adjusts rule weights based on aggregated operator feedback.

```
FUNCTION trainModel(tenantId, feedbackData[]):
  // Phase 1: Initialize statistics per rule
  ruleStats = MAP<ruleId, {correct: 0, incorrect: 0, total: 0}>
  FOR EACH rule IN DEFAULT_RULES:
    ruleStats[rule.id] = {correct: 0, incorrect: 0, total: 0}

  // Phase 2: Aggregate feedback per rule
  FOR EACH dataPoint IN feedbackData:
    IF dataPoint.feedback == 'UNSURE':
      CONTINUE  // Skip uncertain labels

    FOR EACH signal IN dataPoint.signals:
      stats = ruleStats[signal.ruleId]
      IF stats IS NULL:
        CONTINUE  // Unknown rule, skip

      stats.total++
      IF dataPoint.feedback == 'CORRECT':
        stats.correct++
      ELSE IF dataPoint.feedback == 'INCORRECT':
        stats.incorrect++

  // Phase 3: Calculate adjusted weights
  weights = {}
  adjustments = {}
  LEARNING_RATE = 0.3
  MIN_WEIGHT_FACTOR = 0.2
  MAX_WEIGHT_FACTOR = 2.0

  FOR EACH rule IN DEFAULT_RULES:
    stats = ruleStats[rule.id]

    IF stats.total == 0:
      // No feedback -> keep default
      weights[rule.id] = rule.weight
      adjustments[rule.id] = 0
      CONTINUE

    correctRate = stats.correct / stats.total
    incorrectRate = stats.incorrect / stats.total

    // Core formula: adjustment is proportional to feedback balance
    adjustmentFactor = (correctRate - incorrectRate) * LEARNING_RATE
    adjustments[rule.id] = adjustmentFactor

    // Clamp to safe range
    factor = CLAMP(1 + adjustmentFactor, MIN_WEIGHT_FACTOR, MAX_WEIGHT_FACTOR)
    weights[rule.id] = ROUND(rule.weight * factor, 4)

  // Phase 4: Persist
  model = {
    tenantId,
    weights,
    adjustments,
    version: "ml-v1-" + TIMESTAMP,
    trainedAt: NOW(),
    sampleCount: LENGTH(feedbackData)
  }
  SAVE(model)
  RETURN model
```

**Complexity:** O(F * S) where F = feedback data points, S = signals per detection.

**Weight adjustment examples:**

| Scenario | correctRate | incorrectRate | adjustmentFactor | factor | Result |
|----------|-------------|---------------|-------------------|--------|--------|
| All CORRECT | 1.0 | 0.0 | +0.30 | 1.30 | weight * 1.30 |
| All INCORRECT | 0.0 | 1.0 | -0.30 | 0.70 | weight * 0.70 |
| 50/50 split | 0.5 | 0.5 | 0.00 | 1.00 | weight * 1.00 (unchanged) |
| 80% correct | 0.8 | 0.2 | +0.18 | 1.18 | weight * 1.18 |
| 20% correct | 0.2 | 0.8 | -0.18 | 0.82 | weight * 0.82 |

## Algorithm 2: ML Prediction (predict)

Applies trained model weights to the existing rule engine for adjusted scoring.

```
FUNCTION predict(tenantId, messageContent):
  // Step 1: Load model
  model = LOAD_MODEL(tenantId)

  // Step 2: Always compute rule-v1 baseline
  ruleV1Result = analyzeRules(messageContent, DEFAULT_RULES)

  // Step 3: Check readiness
  IF model IS NULL OR model.sampleCount < 1000:
    RETURN NULL  // Caller uses rule-v1 fallback

  // Step 4: Create adjusted rules
  adjustedRules = []
  FOR EACH rule IN DEFAULT_RULES:
    adjustedRule = COPY(rule)
    adjustedRule.weight = model.weights[rule.id] ?? rule.weight
    adjustedRules.APPEND(adjustedRule)

  // Step 5: Score with adjusted weights
  mlResult = analyzeRules(messageContent, adjustedRules)

  // Step 6: Return dual scores
  RETURN {
    score: mlResult.normalizedScore,
    tier: calculateTier(mlResult.normalizedScore),
    signals: mlResult.signals,
    topSignals: mlResult.topSignals,
    modelVersion: model.version,
    ruleV1Score: ruleV1Result.normalizedScore
  }
```

**Complexity:** O(R) where R = number of rules (15).

## Algorithm 3: Accuracy Metrics (getModelMetrics)

Calculates model quality from feedback data.

```
FUNCTION getModelMetrics(tenantId, feedbackData[]):
  model = LOAD_MODEL(tenantId)

  // Filter out UNSURE
  labeled = feedbackData.FILTER(d => d.feedback != 'UNSURE')
  correct = labeled.FILTER(d => d.feedback == 'CORRECT')

  // Accuracy: correct / labeled
  accuracy = IF labeled.LENGTH > 0 THEN correct.LENGTH / labeled.LENGTH ELSE 0

  // Precision: of detections with signals, how many correct
  withSignals = labeled.FILTER(d => d.signals.LENGTH > 0)
  correctWithSignals = withSignals.FILTER(d => d.feedback == 'CORRECT')
  precision = IF withSignals.LENGTH > 0 THEN correctWithSignals.LENGTH / withSignals.LENGTH ELSE 0

  // Recall: of correct feedback, how many had signals
  recall = IF correct.LENGTH > 0 THEN correctWithSignals.LENGTH / correct.LENGTH ELSE 0

  // Per-rule adjustment report
  ruleAdjustments = DEFAULT_RULES.MAP(rule => {
    ruleId: rule.id,
    type: rule.type,
    defaultWeight: rule.weight,
    adjustedWeight: model?.weights[rule.id] ?? rule.weight,
    adjustmentFactor: model?.adjustments[rule.id] ?? 0
  })

  RETURN { accuracy, precision, recall, totalEvaluated: labeled.LENGTH, ruleAdjustments }
```

## Algorithm 4: Training Data Collection (collectTrainingData)

SQL-based aggregation of detections and their feedback.

```
FUNCTION collectTrainingData(tenantId):
  QUERY:
    SELECT d.id, d.score, d.signals, d.created_at, f.label
    FROM pql.detections d
    LEFT JOIN pql.detection_feedback f ON f.detection_id = d.id
    WHERE d.tenant_id = $tenantId
    ORDER BY d.created_at DESC

  // Note: messageContent is empty for privacy (PII protection per SH-02)
  // Only signal metadata (ruleId, type, weight, matchedText) is used for training
  RETURN mapped results
```

## Algorithm 5: Feedback Submission (submitFeedback)

Upsert pattern to handle duplicate feedback from the same operator.

```
FUNCTION submitFeedback(detectionId, tenantId, operatorId, label, comment):
  QUERY:
    INSERT INTO pql.detection_feedback
      (detection_id, tenant_id, operator_id, label, comment)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (detection_id, operator_id)
    DO UPDATE SET label = $4, comment = $5, updated_at = NOW()
    RETURNING *

  RETURN mapped row
```

## Algorithm 6: Training Readiness Check

```
FUNCTION getTrainingStats(tenantId):
  QUERY:
    SELECT COUNT(*) AS total,
           COUNT(f.label) AS labeled,
           COUNT(*) FILTER (WHERE f.label = 'CORRECT') AS correct,
           COUNT(*) FILTER (WHERE f.label = 'INCORRECT') AS incorrect,
           COUNT(*) FILTER (WHERE f.label = 'UNSURE') AS unsure
    FROM pql.detections d
    LEFT JOIN pql.detection_feedback f ON f.detection_id = d.id
    WHERE d.tenant_id = $tenantId

  readinessScore = MIN(labeled / 1000, 1.0)
  isReady = labeled >= 1000

  RETURN { totalSamples, labeledSamples, correctCount, incorrectCount,
           unsureCount, unlabeledCount, readinessScore, isReady }
```
