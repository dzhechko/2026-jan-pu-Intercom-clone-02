# FR-10: PQL ML v1 -- Product Requirements Document

## Feature Identity

| Field | Value |
|-------|-------|
| ID | FR-10 |
| Name | PQL ML v1 -- Adaptive Rule Weight Adjustment |
| BC | BC-02 PQL Intelligence |
| Priority | SHOULD |
| Milestone | M3 |
| Status | Done |
| ADR Reference | ADR-009 (Rule-Based v1 -> ML v2 -> LLM v3) |

## Problem Statement

The rule-based PQL detection system (FR-03) uses static weights for 15 signal rules. These weights are hand-tuned during initial development and do not adapt to real-world feedback. As operators accumulate experience with PQL detections, their CORRECT/INCORRECT/UNSURE feedback represents valuable signal about which rules are effective for each tenant's specific domain. Without a feedback loop, detection accuracy stagnates and cannot improve beyond the initial calibration.

## Solution

FR-10 implements Phase 2 of the Progressive AI Enhancement strategy (ADR-009): an adaptive rule weight adjustment system that learns from operator feedback. This is deliberately NOT a neural network or statistical ML model. It is a weighted rule adaptation algorithm that:

1. Collects operator feedback (CORRECT/INCORRECT/UNSURE) on PQL detections
2. After accumulating >= 1,000 labeled samples, adjusts rule weights per tenant
3. Uses a conservative learning rate (0.3) with clamped weight bounds (20%-200%)
4. Falls back to rule-v1 when insufficient data is available
5. Provides dual scoring (ML-adjusted + rule-v1 baseline) for comparison logging

## User Stories

| ID | Story | Persona |
|----|-------|---------|
| US-01 | As an operator, I want to provide feedback on PQL detections so that the system learns from my expertise | Operator |
| US-02 | As an admin, I want to trigger model training when enough feedback is collected so that detection accuracy improves | Admin |
| US-03 | As an admin, I want to see model accuracy metrics (accuracy, precision, recall) so that I can assess PQL quality | Admin |
| US-04 | As an admin, I want to export training data so that I can analyze patterns externally | Admin |
| US-05 | As an admin, I want to see training readiness status so that I know when enough data is available | Admin |

## Acceptance Criteria

- AC-01: Operators can submit CORRECT/INCORRECT/UNSURE feedback on PQL detections
- AC-02: Feedback is deduplicated per detection+operator pair (upsert semantics)
- AC-03: Model training adjusts rule weights based on feedback correctness rates
- AC-04: Weight adjustment is clamped between 20% and 200% of original weight
- AC-05: Model requires >= 1,000 labeled samples before prediction activates
- AC-06: Prediction falls back to rule-v1 when model is not ready
- AC-07: Accuracy metrics exclude UNSURE feedback from calculation
- AC-08: Training data exportable in JSON and CSV formats
- AC-09: RLS enforced on detection_feedback table (FF-03)
- AC-10: Admin-only access for train and export endpoints
- AC-11: Model accuracy >= 75% with balanced feedback distribution

## Dependencies

| Direction | Feature | Description |
|-----------|---------|-------------|
| Depends on | FR-03 (PQL RuleEngine) | Uses DEFAULT_RULES and analyzeRules() |
| Depends on | FR-01 (IAM/JWT) | Authentication and role-based access |
| Blocks | Future ML v2 | Real model training after 10K dialogs |

## Out of Scope

- Neural network or statistical ML model training
- LLM-based PQL detection (reserved for v3 per ADR-009)
- Automatic retraining (training is triggered manually by admin)
- Cross-tenant model sharing (each tenant has independent weights)
- Real-time weight adjustment (batch training only)
