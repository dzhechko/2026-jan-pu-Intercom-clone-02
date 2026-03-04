# FR-10: PQL ML v1 -- Refinement

## Edge Cases

### EC-01: Zero Feedback for a Rule

**Scenario:** A rule has never been triggered in any detection that received feedback.
**Handling:** Weight remains at default value. adjustmentFactor = 0.
**Code:** `if (stats.total === 0) { weights[rule.id] = rule.weight; adjustments[rule.id] = 0; continue }`
**Risk:** Low. Rules without feedback are preserved as-is.

### EC-02: All Feedback is UNSURE

**Scenario:** All 1000+ labeled samples have label = 'UNSURE'.
**Handling:** UNSURE is filtered out during weight calculation. Effectively the same as zero feedback for all rules. Training still succeeds but produces no weight changes.
**Code:** `if (dp.feedback === 'UNSURE') continue`
**Risk:** Low. The model is saved but weights equal defaults. The train endpoint does not reject this case because labeled count includes UNSURE at the route level.

### EC-03: Extreme Skew (100% INCORRECT for One Rule)

**Scenario:** A single rule (e.g., R06 PURCHASE) receives 100% INCORRECT feedback.
**Handling:** adjustmentFactor = (0 - 1.0) * 0.3 = -0.30. factor = 1 + (-0.30) = 0.70. Weight = original * 0.70. The clamping floor (0.2) is not reached. The rule is weakened but not eliminated.
**Worst case:** If somehow all detections mark R06 as incorrect over multiple training cycles (each saving lower weights), the floor is still 20% of the DEFAULT weight because training always starts from DEFAULT_RULES, not from the previously adjusted model.
**Risk:** Medium. See "Concern: Compounding" below.

### EC-04: Model Loaded But Missing Rule Weights

**Scenario:** A new rule is added to DEFAULT_RULES after a model was trained. The model does not contain the new rule's weight.
**Handling:** `model.weights[rule.id] ?? rule.weight` -- falls back to default weight for unknown rules.
**Risk:** Low. New rules work at default weight immediately.

### EC-05: Concurrent Training Requests

**Scenario:** Two admins trigger training simultaneously for the same tenant.
**Handling:** The `ON CONFLICT (tenant_id) DO UPDATE` in PgMLModelRepository ensures only one model exists per tenant. The last writer wins. Both operations succeed; the final state reflects whichever completed last.
**Risk:** Low. No data corruption, but the "loser" admin sees a stale version until refresh.

### EC-06: Large Training Dataset (100K+ detections)

**Scenario:** Tenant accumulates 100K+ detections with feedback.
**Handling:** collectTrainingData() loads all detections in a single query. trainModel() iterates all data points in memory. No pagination.
**Risk:** Medium. For 100K detections with 5 signals each, the inner loop executes 500K iterations. This is still O(n*s) and completes in milliseconds on modern hardware. However, the SQL query result set could consume significant memory (~100MB for 100K rows with JSONB signals).
**Mitigation:** Consider adding LIMIT or pagination in future versions.

### EC-07: Feedback After Model Training

**Scenario:** New feedback arrives after model was trained but before next training.
**Handling:** New feedback is stored in detection_feedback but does not affect the current model. The model only updates when admin triggers POST /api/pql/ml/train again.
**Risk:** None by design. Batch training is intentional (AD-05).

### EC-08: Empty Feedback Data Array

**Scenario:** getModelMetrics() called with empty feedbackData[].
**Handling:** Returns zeroed metrics: accuracy=0, precision=0, recall=0, totalEvaluated=0.
**Test:** "should return zero metrics for empty feedback"

## Concerns and Risks

### Concern 1: Compounding Weight Changes

**Description:** Training always adjusts from DEFAULT_RULES weights, not from previously saved model weights. This means each training run produces adjustments relative to the original baseline, not accumulated. This is correct behavior but may be surprising: if feedback distribution changes over time, earlier patterns are overwritten by the latest aggregate.

**Severity:** Low (correct by design).

### Concern 2: Privacy of Training Data

**Description:** MLTrainingService.collectTrainingData() returns `messageContent: ''` (empty string) because raw dialog content is not stored in training data. Only signal metadata (ruleId, type, weight, matchedText) is available. The `matchedText` field contains the regex-matched substring, which could potentially contain PII.

**Severity:** Medium. matchedText values like "enterprise" or "demo" are typically not PII, but edge cases exist (e.g., a company name matched by a pattern).

**Mitigation:** The export endpoint is admin-only. Future enhancement: redact matchedText in exports.

### Concern 3: Accuracy Metric Definition

**Description:** The "accuracy" metric is defined as `correct_feedback / total_labeled_feedback`. This measures operator agreement, not predictive accuracy in the traditional ML sense. A more rigorous metric would compare model predictions against held-out test sets.

**Severity:** Low for v1. The metric serves its purpose of tracking operator satisfaction with PQL detection quality. True predictive accuracy metrics are deferred to ML v2.

### Concern 4: No Automatic Degradation Detection

**Description:** There is no mechanism to detect if the model degrades after training. If adversarial feedback is submitted (e.g., intentionally marking CORRECT detections as INCORRECT), the model will learn incorrect weights.

**Severity:** Medium. Mitigated by admin-only training trigger (human in the loop) and weight clamping (max 2x, min 0.2x).

### Concern 5: No Model Versioning History

**Description:** Only one model per tenant is stored (upsert on tenant_id). Previous model versions are overwritten and cannot be rolled back.

**Severity:** Medium. If a bad training run produces poor weights, there is no way to revert to the previous model.

**Mitigation:** Admin should check metrics before and after training. Future enhancement: store model history with version timestamps.

## Performance Characteristics

| Operation | Complexity | Expected Latency |
|-----------|-----------|-----------------|
| submitFeedback | O(1) SQL upsert | < 10ms |
| collectTrainingData | O(N) single query | < 100ms for 10K rows |
| trainModel (in-memory) | O(F * S) | < 50ms for 1K samples |
| predict | O(R) = O(15) | < 5ms |
| getModelMetrics | O(F) | < 10ms for 1K samples |
| getTrainingStats | O(1) aggregation query | < 10ms |

Where F = feedback data points, S = average signals per detection, R = number of rules.

## Test Coverage Summary

| Test Category | Count | Key Assertions |
|---------------|-------|----------------|
| Weight adjustment (CORRECT) | 1 | Weights increase for positively rated rules |
| Weight adjustment (INCORRECT) | 1 | Weights decrease for negatively rated rules |
| Weight adjustment (no feedback) | 1 | Default weights preserved |
| Weight adjustment (UNSURE) | 1 | UNSURE skipped, defaults preserved |
| Weight clamping | 1 | Factor stays within [0.2, 2.0] |
| Model metadata | 1 | sampleCount, version, trainedAt stored |
| Prediction (no model) | 1 | Returns null |
| Prediction (insufficient data) | 1 | Returns null when < 1K samples |
| Prediction (ready model) | 1 | Uses adjusted weights, returns MLPrediction |
| Prediction (comparison) | 1 | Includes ruleV1Score |
| Prediction (tier) | 1 | Correct HOT/WARM/COLD from score |
| Readiness (no model) | 1 | false |
| Readiness (< 1K) | 1 | false |
| Readiness (>= 1K) | 2 | true for 1K and 5K |
| Accuracy calculation | 1 | Correct accuracy from feedback ratios |
| UNSURE exclusion | 1 | UNSURE not counted in accuracy |
| Empty feedback | 1 | Zero metrics |
| Rule adjustments | 1 | Per-rule detail in metrics |
| >= 75% accuracy | 1 | Validates acceptance criteria |
| Train + predict integration | 1 | End-to-end weight adjustment affects prediction |
| **Total** | **20** | |
