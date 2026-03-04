# FR-10: PQL ML v1 -- Specification

## Component Inventory

### Application Layer

| Component | File | Responsibility |
|-----------|------|----------------|
| MLModelService | `src/pql/application/services/ml-model-service.ts` | Training, prediction, metrics, readiness check |
| MLTrainingService | `src/pql/application/services/ml-training-service.ts` | Feedback collection, training data aggregation, export |

### Infrastructure Layer

| Component | File | Responsibility |
|-----------|------|----------------|
| PgMLModelRepository | `src/pql/infrastructure/repositories/ml-model-repository.ts` | PostgreSQL persistence for model weights |
| ML Routes | `src/pql/infrastructure/ml-routes.ts` | REST endpoints for ML management |
| Feedback Routes | `src/pql/infrastructure/feedback-routes.ts` | REST endpoints for operator feedback |

### Database

| Artifact | File | Description |
|----------|------|-------------|
| Migration 007 | `migrations/007_pql_ml_v1.sql` | Schema for detection_feedback + ml_training_data updates |

## Type Definitions

### Domain Types

```typescript
// Feedback label: operator assessment of a PQL detection
type FeedbackLabel = 'CORRECT' | 'INCORRECT' | 'UNSURE'

// Training data point: one labeled detection with its signals
interface TrainingDataPoint {
  detectionId: string
  messageContent: string       // empty for privacy; signals are sufficient
  signals: Array<{ ruleId: string; type: string; weight: number; matchedText: string }>
  pqlScore: number
  operatorFeedback: FeedbackLabel | null
  actualOutcome: 'DEAL' | 'NO_DEAL' | null
  tenantId: string
  createdAt: Date
}

// Training readiness statistics
interface TrainingStats {
  totalSamples: number
  labeledSamples: number
  correctCount: number
  incorrectCount: number
  unsureCount: number
  unlabeledCount: number
  readinessScore: number    // 0.0 - 1.0 (labeled / 1000)
  isReady: boolean          // true if labeled >= 1000
}
```

### Model Types

```typescript
// Persisted model weights for a tenant
interface ModelWeights {
  tenantId: string
  weights: Record<string, number>       // ruleId -> adjusted weight
  adjustments: Record<string, number>   // ruleId -> adjustment factor
  version: string                       // e.g. "ml-v1-1709312000000"
  trainedAt: Date
  sampleCount: number
}

// Model accuracy metrics
interface ModelMetrics {
  accuracy: number
  precision: number
  recall: number
  totalEvaluated: number
  ruleAdjustments: Array<{
    ruleId: string
    type: string
    defaultWeight: number
    adjustedWeight: number
    adjustmentFactor: number
  }>
}

// Prediction result with dual scoring
interface MLPrediction {
  score: number                          // ML-adjusted normalized score
  tier: 'HOT' | 'WARM' | 'COLD'
  signals: RuleAnalysisResult['signals']
  topSignals: RuleAnalysisResult['topSignals']
  modelVersion: string
  ruleV1Score: number                    // original score for comparison
}
```

## API Specification

### Feedback Endpoints

#### POST /api/pql/detections/:id/feedback

Submit operator feedback for a PQL detection.

**Auth:** JWT (any operator role)

**Request Body (Zod validated):**
```json
{
  "label": "CORRECT | INCORRECT | UNSURE",
  "comment": "optional string, max 500 chars"
}
```

**Response 201:**
```json
{
  "feedback": {
    "id": "uuid",
    "detectionId": "uuid",
    "tenantId": "uuid",
    "operatorId": "uuid",
    "label": "CORRECT",
    "comment": null,
    "createdAt": "ISO8601"
  }
}
```

**Deduplication:** `UNIQUE(detection_id, operator_id)` with `ON CONFLICT DO UPDATE`.

#### GET /api/pql/feedback/stats

**Auth:** JWT (any operator role)

**Response 200:**
```json
{
  "stats": {
    "total": 1250,
    "correct": 800,
    "incorrect": 350,
    "unsure": 100
  }
}
```

### ML Management Endpoints

#### GET /api/pql/ml/status

**Auth:** JWT (any operator role)

**Response 200:**
```json
{
  "trainingData": {
    "totalSamples": 2500,
    "labeledSamples": 1200,
    "correctCount": 800,
    "incorrectCount": 300,
    "unsureCount": 100,
    "unlabeledCount": 1300,
    "readinessScore": 1.0,
    "isReady": true
  },
  "modelReady": true,
  "phase": "ml-v1"
}
```

#### POST /api/pql/ml/train

**Auth:** JWT (ADMIN role only)

**Response 200:**
```json
{
  "message": "Model trained successfully",
  "version": "ml-v1-1709312000000",
  "sampleCount": 1200
}
```

**Response 400 (insufficient data):**
```json
{
  "error": "Insufficient training data",
  "required": 1000,
  "current": 450
}
```

#### GET /api/pql/ml/metrics

**Auth:** JWT (any operator role)

**Response 200:**
```json
{
  "metrics": {
    "accuracy": 0.842,
    "precision": 0.78,
    "recall": 0.91,
    "totalEvaluated": 950,
    "ruleAdjustments": [
      {
        "ruleId": "R01",
        "type": "PRICING",
        "defaultWeight": 0.40,
        "adjustedWeight": 0.48,
        "adjustmentFactor": 0.2
      }
    ]
  }
}
```

#### GET /api/pql/ml/export?format=json|csv

**Auth:** JWT (ADMIN role only)

**Response 200:** JSON array or CSV file with `Content-Disposition` header.

## Database Schema

### Table: pql.detection_feedback

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| detection_id | UUID | NOT NULL, FK -> pql.detections(id) |
| tenant_id | UUID | NOT NULL |
| operator_id | UUID | NOT NULL, FK -> iam.operators(id) |
| label | VARCHAR(10) | NOT NULL, CHECK IN ('CORRECT','INCORRECT','UNSURE') |
| comment | TEXT | nullable |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Constraints:** UNIQUE(detection_id, operator_id)
**Indexes:** tenant_id, detection_id
**RLS:** tenant_isolation_feedback policy

### Table: pql.ml_training_data (updated columns)

| Column | Type | Default |
|--------|------|---------|
| weights | JSONB | '{}' |
| adjustments | JSONB | '{}' |
| version | VARCHAR(50) | null |
| trained_at | TIMESTAMPTZ | null |
| sample_count | INTEGER | 0 |
| updated_at | TIMESTAMPTZ | NOW() |

**Unique Index:** idx_ml_training_data_tenant ON tenant_id (for upsert)

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| LEARNING_RATE | 0.3 | Adjustment sensitivity |
| MIN_WEIGHT_FACTOR | 0.2 | Floor: weight cannot drop below 20% of original |
| MAX_WEIGHT_FACTOR | 2.0 | Ceiling: weight cannot exceed 200% of original |
| MIN_TRAINING_SAMPLES | 1000 | Threshold to activate ML prediction |
| READINESS_THRESHOLD | 1000 | Denominator for readinessScore calculation |
