# FR-10: PQL ML v1
**Status:** Done | **BC:** BC-02 PQL Intelligence | **Priority:** SHOULD

## Summary
Adaptive rule weight adjustment system (Phase 2 of Progressive AI Enhancement) that learns from operator feedback to improve PQL detection accuracy. Operators label PQL detections as CORRECT/INCORRECT/UNSURE; after 1K labeled samples, the system adjusts rule weights using a simple learning rate algorithm. This is not a real ML model but a weighted rule adaptation that bridges rule-v1 and future LLM-based detection.

## User Stories
- US-01: As an operator, I want to provide feedback on PQL detections so that the system learns from my expertise
- US-02: As an admin, I want to trigger model training when enough feedback is collected so that detection accuracy improves
- US-03: As an admin, I want to see model accuracy metrics (accuracy, precision, recall) so that I can assess PQL quality
- US-04: As an admin, I want to export training data so that I can analyze patterns externally
- US-05: As an admin, I want to see training readiness status so that I know when enough data is available

## Technical Design

### Files Created
- `src/pql/application/services/ml-model-service.ts` -- MLModelService with trainModel (weight adjustment), predict (adjusted-weight scoring), getModelMetrics (accuracy/precision/recall), hasTrainedModel (readiness check)
- `src/pql/application/services/ml-model-service.test.ts` -- 15 comprehensive tests
- `src/pql/application/services/ml-training-service.ts` -- MLTrainingService with submitFeedback (upsert), collectTrainingData, exportTrainingSet (JSON/CSV), getTrainingStats, getFeedbackStats
- `src/pql/infrastructure/ml-routes.ts` -- ML management routes: status, train, metrics, export
- `src/pql/infrastructure/feedback-routes.ts` -- Operator feedback routes: submit feedback, get stats
- `src/pql/infrastructure/repositories/ml-model-repository.ts` -- PgMLModelRepository with upsert semantics for per-tenant model weights
- `migrations/007_pql_ml_v1.sql` -- Database migration: detection_feedback table, ml_training_data schema update, RLS policies

### Key Decisions
- **Not real ML:** This is deliberate per ADR-009 (Rule-Based v1 -> ML v2 -> LLM v3). The "model" adjusts rule weights rather than training a neural network, keeping complexity manageable.
- **Learning rate = 0.3:** Weight adjustment = `base_weight * (1 + (correct_rate - incorrect_rate) * 0.3)`. Conservative enough to prevent wild swings.
- **Weight clamping:** Weights cannot go below 20% or above 200% of original to prevent any single rule from being eliminated or dominating.
- **1K sample threshold:** Model prediction is only used when >= 1000 labeled samples exist. Below that, falls back to rule-v1 (null return from predict()).
- **Per-tenant models:** Each tenant gets independent model weights, stored as JSONB in `pql.ml_training_data` with upsert on tenant_id.
- **UNSURE excluded:** UNSURE feedback is excluded from weight calculation and accuracy metrics, preventing noise from uncertain labels.
- **Dual scoring:** Prediction returns both ML-adjusted score and rule-v1 score for comparison logging, enabling gradual rollout confidence.
- **Feedback deduplication:** `UNIQUE(detection_id, operator_id)` constraint with `ON CONFLICT DO UPDATE` prevents duplicate feedback.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/pql/ml/status | Training data readiness and model status |
| POST | /api/pql/ml/train | Trigger model training (admin only, requires >= 1K labeled samples) |
| GET | /api/pql/ml/metrics | Model accuracy, precision, recall, and per-rule adjustments |
| GET | /api/pql/ml/export?format=json\|csv | Export training data (admin only) |
| POST | /api/pql/detections/:id/feedback | Submit operator feedback (CORRECT/INCORRECT/UNSURE) |
| GET | /api/pql/feedback/stats | Feedback statistics for tenant |

## Dependencies
- Depends on: FR-03 (PQL RuleEngine -- uses DEFAULT_RULES and analyzeRules), FR-01 (IAM/JWT for auth)
- Blocks: Future ML v2 (real model training after 10K dialogs)

## Tests
- `src/pql/application/services/ml-model-service.test.ts` -- 15 tests covering:
  - **Weight adjustment:** CORRECT feedback increases weights, INCORRECT decreases, no-feedback keeps default, UNSURE is skipped, clamping within bounds
  - **Model metadata:** sampleCount and version stored correctly
  - **Prediction:** Returns null when no model, null when insufficient samples (<1K), uses adjusted weights when ready, includes ruleV1Score for comparison, calculates correct tier
  - **Readiness:** false when no model, false when <1K samples, true when >=1K samples
  - **Accuracy:** Correct calculation from feedback, UNSURE exclusion, zero metrics for empty feedback, rule adjustment details, >= 75% accuracy with balanced feedback
  - **Integration:** Train then predict produces different scores with biased feedback

## Database Schema
```sql
-- pql.detection_feedback
CREATE TABLE pql.detection_feedback (
  id UUID PRIMARY KEY,
  detection_id UUID NOT NULL REFERENCES pql.detections(id),
  tenant_id UUID NOT NULL,
  operator_id UUID NOT NULL REFERENCES iam.operators(id),
  label VARCHAR(10) CHECK (label IN ('CORRECT','INCORRECT','UNSURE')),
  comment TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(detection_id, operator_id)
);

-- pql.ml_training_data (updated)
ALTER TABLE pql.ml_training_data ADD COLUMN weights JSONB;
ALTER TABLE pql.ml_training_data ADD COLUMN adjustments JSONB;
ALTER TABLE pql.ml_training_data ADD COLUMN version VARCHAR(50);
ALTER TABLE pql.ml_training_data ADD COLUMN sample_count INTEGER;
```

## Acceptance Criteria
- [x] Operators can submit CORRECT/INCORRECT/UNSURE feedback on PQL detections
- [x] Feedback is deduplicated per detection+operator pair
- [x] Model training adjusts rule weights based on feedback correctness rates
- [x] Weight adjustment is clamped between 20% and 200% of original
- [x] Model requires >= 1000 labeled samples before prediction activates
- [x] Prediction falls back to rule-v1 when model is not ready
- [x] Accuracy metrics exclude UNSURE feedback
- [x] Training data exportable in JSON and CSV formats
- [x] RLS enforced on detection_feedback table
- [x] Admin-only access for train and export endpoints
