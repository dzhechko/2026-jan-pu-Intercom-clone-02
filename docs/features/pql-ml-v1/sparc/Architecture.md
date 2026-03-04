# FR-10: PQL ML v1 -- Architecture

## System Context

FR-10 adds a feedback-driven learning layer on top of the existing rule-based PQL detection (FR-03). It does not replace the rule engine; it adjusts the weights of existing rules based on operator feedback.

```
                         +------------------+
                         |   Operator UI    |
                         | (Workspace)      |
                         +--------+---------+
                                  |
                    Feedback (CORRECT/INCORRECT/UNSURE)
                                  |
                         +--------v---------+
                         | Feedback Routes  |
                         | (feedback-       |
                         |  routes.ts)      |
                         +--------+---------+
                                  |
                         +--------v---------+
                         | MLTraining       |
                         | Service          |
                         +--------+---------+
                                  |
                    +-------------+-------------+
                    |                           |
           +--------v--------+        +--------v--------+
           | pql.detection   |        | pql.ml_training |
           | _feedback       |        | _data           |
           | (PostgreSQL)    |        | (PostgreSQL)    |
           +-----------------+        +--------+--------+
                                               |
                                      +--------v--------+
                                      | MLModel         |
                                      | Service         |
                                      +--------+--------+
                                               |
                                      +--------v--------+
                                      | analyzeRules()  |
                                      | (Rule Engine)   |
                                      | with adjusted   |
                                      | weights         |
                                      +-----------------+
```

## Component Architecture

### Layer Diagram

```
+------------------------------------------------------------------+
|                    Infrastructure Layer                           |
|  +-------------------+  +-------------------+  +---------------+ |
|  | feedback-routes   |  | ml-routes         |  | PgMLModel     | |
|  | .ts               |  | .ts               |  | Repository    | |
|  | (Zod validation)  |  | (admin guard)     |  | .ts           | |
|  +--------+----------+  +--------+----------+  +-------+-------+ |
|           |                      |                      |         |
+------------------------------------------------------------------+
            |                      |                      |
+------------------------------------------------------------------+
|                    Application Layer                              |
|  +-------------------+  +-------------------+                    |
|  | MLTraining        |  | MLModel           |                    |
|  | Service           |  | Service           |                    |
|  | - submitFeedback  |  | - trainModel      |                    |
|  | - collectData     |  | - predict         |                    |
|  | - exportSet       |  | - getMetrics      |                    |
|  | - getStats        |  | - hasTrainedModel |                    |
|  +-------------------+  +-------------------+                    |
+------------------------------------------------------------------+
            |                      |
+------------------------------------------------------------------+
|                      Domain Layer                                |
|  +-------------------+  +-------------------+                    |
|  | DEFAULT_RULES     |  | analyzeRules()    |                    |
|  | (value-objects/   |  | (rule-engine.ts)  |                    |
|  |  rule-set.ts)     |  |                   |                    |
|  +-------------------+  +-------------------+                    |
+------------------------------------------------------------------+
```

### Data Flow: Training

```
1. Operator submits feedback via POST /api/pql/detections/:id/feedback
2. FeedbackRoutes validates input with Zod schema
3. MLTrainingService.submitFeedback() upserts into pql.detection_feedback
4. Admin triggers training via POST /api/pql/ml/train
5. MLRoutes checks role === 'ADMIN'
6. MLTrainingService.collectTrainingData() joins detections + feedback
7. MLRoutes filters to labeled-only, validates count >= 1000
8. MLModelService.trainModel() computes weight adjustments:
   a. Aggregate correct/incorrect counts per rule
   b. Calculate adjustment_factor = (correct_rate - incorrect_rate) * 0.3
   c. Clamp factor to [0.2, 2.0] range
   d. Apply: adjusted_weight = base_weight * clamped_factor
9. PgMLModelRepository.save() upserts weights into pql.ml_training_data
```

### Data Flow: Prediction

```
1. PQL detection triggered by MessageReceived event
2. PQLDetectorService calls MLModelService.predict(tenantId, content)
3. MLModelService loads model from PgMLModelRepository
4. If no model OR sampleCount < 1000 -> return null (fallback to rule-v1)
5. If model ready:
   a. Compute rule-v1 baseline via analyzeRules(content, DEFAULT_RULES)
   b. Create adjusted rules: replace weights from model.weights
   c. Compute ML score via analyzeRules(content, adjustedRules)
   d. Return MLPrediction with both scores for comparison logging
```

## Key Architectural Decisions

### AD-01: Not Real ML (per ADR-009)

The "ML" in FR-10 is deliberate nomenclature for the progressive AI enhancement roadmap. Phase 2 adjusts rule weights using simple arithmetic rather than gradient descent or neural networks. This decision:
- Keeps complexity manageable for a Phase 2 feature
- Avoids dependency on ML libraries (TensorFlow, scikit-learn)
- Provides a clear upgrade path to Phase 3 (real ML after 10K dialogs)
- Allows the same rule engine infrastructure to be reused

### AD-02: Per-Tenant Model Isolation

Each tenant maintains independent model weights in `pql.ml_training_data`. This ensures:
- Tenant A's feedback does not influence Tenant B's detection
- Different industries can have different optimal weights
- RLS isolation is maintained (FF-03)
- Models can be trained/reset independently

### AD-03: Conservative Learning Rate (0.3)

The learning rate of 0.3 combined with weight clamping [0.2, 2.0] prevents:
- Complete elimination of any rule (minimum 20% of original weight)
- Extreme amplification (maximum 200% of original weight)
- Oscillation from noisy feedback
- Single-rule domination of the scoring function

### AD-04: Dual Scoring for Comparison

The predict() method returns both `score` (ML-adjusted) and `ruleV1Score` (baseline). This enables:
- A/B comparison logging during rollout
- Confidence assessment before full switchover
- Rollback to rule-v1 if ML quality degrades

### AD-05: Batch Training (No Real-Time)

Training is manually triggered by an admin, not automatic. This is intentional:
- Admins can review feedback quality before training
- Prevents model degradation from adversarial/noisy feedback
- Aligns with the 1K sample threshold requirement
- Simplifies the architecture (no background job scheduler needed)

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| RLS isolation | detection_feedback has tenant_isolation_feedback policy (FF-03) |
| Admin-only training | Role check in ml-routes.ts (`role !== 'ADMIN'` -> 403) |
| Admin-only export | Same role check for export endpoint |
| Data privacy | messageContent is empty in training data; only signals are stored |
| Feedback spam | Rate limit 300 req/min per operator on feedback endpoint (SH-03) |
| Input validation | Zod schema validates feedback label enum + comment max length |

## Fitness Functions

| FF | Relevance | How FR-10 Complies |
|----|-----------|-------------------|
| FF-03 | Tenant RLS isolation | RLS policy on pql.detection_feedback |
| FF-05 | RuleEngine coverage >= 95% | 15 tests in ml-model-service.test.ts |
| FF-02 | No cross-BC imports | All imports within BC-02 (pql) |
