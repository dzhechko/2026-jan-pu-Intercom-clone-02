# Specification: FR-01 PQL Detector v1 (Rule-Based)

**Feature ID:** FR-01
**Bounded Context:** BC-02 PQL Intelligence
**Status:** Implemented
**Version:** 1.0 | **Date:** 2026-03-04

---

## 1. Domain Types

### 1.1 Value Objects

#### SignalRule
```typescript
interface SignalRule {
  readonly id: string        // e.g. "R01"
  readonly pattern: RegExp   // case-insensitive regex
  readonly weight: number    // 0.0 – 1.0
  readonly type: string      // signal category label
}
```

#### SignalMatch
```typescript
interface SignalMatch {
  readonly ruleId: string    // rule that fired
  readonly type: string      // signal category
  readonly weight: number    // weight contributed
  readonly matchedText: string  // first regex match text
}
```

#### PQLTier
```typescript
type PQLTier = 'HOT' | 'WARM' | 'COLD'
// HOT  >= 0.80
// WARM >= 0.65
// COLD  < 0.65
```

#### PQLScore
```typescript
interface PQLScore {
  readonly value: number      // 0.0 – 1.0
  readonly tier: PQLTier
  readonly topSignals: Array<{ type: string; weight: number }>
}
```

### 1.2 Aggregate-Level Types

#### MessageEvent (input to service)
```typescript
interface MessageEvent {
  messageId: string
  dialogId: string
  tenantId: string
  content: string
  senderType: 'CLIENT' | 'OPERATOR' | 'BOT'
}
```

#### PQLDetection (output, also persisted)
```typescript
interface PQLDetection {
  id: string              // UUID v4
  dialogId: string
  tenantId: string
  messageId: string
  score: number           // normalized 0.0 – 1.0
  tier: PQLTier
  signals: SignalMatch[]  // all matched signals
  topSignals: SignalMatch[] // top 3 by weight
  createdAt: Date
}
```

#### RuleAnalysisResult (internal, from RuleEngine)
```typescript
interface RuleAnalysisResult {
  readonly signals: SignalMatch[]
  readonly rawScore: number       // sum of matched weights (un-capped)
  readonly normalizedScore: number // min(rawScore / MAX_POSSIBLE_WEIGHT, 1.0)
  readonly topSignals: SignalMatch[] // top 3 by weight
}
```

---

## 2. Scoring Model

### 2.1 Normalization Formula

```
normalizedScore = min(sum(matched_rule_weights) / MAX_POSSIBLE_WEIGHT, 1.0)
```

Where:
- `MAX_POSSIBLE_WEIGHT` = sum of the 5 highest rule weights
- = 0.60 (PURCHASE) + 0.50 (ENTERPRISE) + 0.45 (DEMO) + 0.45 (MIGRATION) + 0.45 (BUDGET)
- = **2.25**

This means:
- A single PURCHASE signal (0.60) = score 0.267 (COLD)
- PURCHASE + ENTERPRISE (1.10) = score 0.489 (COLD)
- PURCHASE + ENTERPRISE + DEMO (1.55) = score 0.689 (WARM)
- 5+ signals including strongest = score 1.00 (HOT, capped)

### 2.2 Tier Classification
```typescript
function calculateTier(score: number): PQLTier {
  if (score >= 0.80) return 'HOT'
  if (score >= 0.65) return 'WARM'
  return 'COLD'
}
```

### 2.3 Content Pre-Processing Pipeline
```
1. Guard: empty string → return zero result
2. Truncate: content.slice(0, 2000)   [EC-02 edge case]
3. Strip emoji: /[\u{1F600}-\u{1F9FF}]/gu → ''   [EC-03 edge case]
4. Lowercase: .toLowerCase()
5. Trim: .trim()
6. Collapse whitespace: .replace(/\s+/g, ' ')
```

---

## 3. REST API

### 3.1 GET /api/pql/detections/:dialogId

Returns all PQL detections for a specific dialog.

**Auth:** Bearer JWT (operator session)
**RLS:** query runs under tenant context (SET app.tenant_id)

**Request:**
```
GET /api/pql/detections/dlg-uuid-here
Authorization: Bearer <jwt>
```

**Response 200:**
```json
{
  "detections": [
    {
      "id": "det-uuid",
      "dialogId": "dlg-uuid",
      "tenantId": "ten-uuid",
      "messageId": "msg-uuid",
      "score": 0.822,
      "tier": "HOT",
      "signals": [
        { "ruleId": "R06", "type": "PURCHASE", "weight": 0.60, "matchedText": "договор" },
        { "ruleId": "R02", "type": "ENTERPRISE", "weight": 0.50, "matchedText": "enterprise" }
      ],
      "topSignals": [
        { "ruleId": "R06", "type": "PURCHASE", "weight": 0.60, "matchedText": "договор" },
        { "ruleId": "R02", "type": "ENTERPRISE", "weight": 0.50, "matchedText": "enterprise" },
        { "ruleId": "R05", "type": "DEMO", "weight": 0.45, "matchedText": "демо" }
      ],
      "createdAt": "2026-03-04T10:00:00.000Z"
    }
  ]
}
```

**Error responses:**
- `500` Internal server error

---

### 3.2 GET /api/pql/detections

Lists recent PQL detections for the authenticated tenant, with pagination.

**Auth:** Bearer JWT (operator session)
**RLS:** query runs under tenant context

**Query Parameters:**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| limit | integer | 50 | min=1, max=100 |
| offset | integer | 0 | min=0 |

**Request:**
```
GET /api/pql/detections?limit=20&offset=0
Authorization: Bearer <jwt>
```

**Response 200:**
```json
{
  "detections": [ ... ]
}
```

**Error responses:**
- `400` Invalid query params (with Zod error details)
- `500` Internal server error

---

## 4. WebSocket Event

### pql:detected (emitted to tenant room)

After a detection is persisted, the PQL consumer broadcasts to the Socket.io room `tenant:{tenantId}`:

```json
{
  "detectionId": "uuid",
  "dialogId": "uuid",
  "tenantId": "uuid",
  "score": 0.822,
  "tier": "HOT",
  "topSignals": [
    { "ruleId": "R06", "type": "PURCHASE", "weight": 0.60, "matchedText": "договор" }
  ]
}
```

### pql:analyze (internal trigger)

Sent within the `/chat` Socket.io namespace by the ws-handler after saving a CLIENT message:

```json
{
  "messageId": "uuid",
  "dialogId": "uuid",
  "tenantId": "uuid",
  "content": "message text here",
  "senderType": "CLIENT"
}
```

---

## 5. Database Schema

### Table: pql.detections

```sql
CREATE TABLE pql.detections (
  id          UUID PRIMARY KEY,
  dialog_id   UUID NOT NULL,
  tenant_id   UUID NOT NULL,
  message_id  UUID NOT NULL,
  score       NUMERIC(4,3) NOT NULL,      -- 0.000 – 1.000
  tier        VARCHAR(10) NOT NULL,        -- 'HOT' | 'WARM' | 'COLD'
  signals     JSONB NOT NULL DEFAULT '[]', -- SignalMatch[]
  top_signals JSONB NOT NULL DEFAULT '[]', -- SignalMatch[] top 3
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS enabled (FF-03)
ALTER TABLE pql.detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON pql.detections
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Indexes
CREATE INDEX idx_pql_detections_dialog_id ON pql.detections(dialog_id);
CREATE INDEX idx_pql_detections_tenant_id ON pql.detections(tenant_id, created_at DESC);
```

---

## 6. Input Validation

**Pagination (Zod schema):**
```typescript
const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
```

**MessageEvent guard (in message consumer):**
- All four fields (messageId, dialogId, tenantId, content) must be truthy
- Missing fields: event silently skipped (fire-and-forget, no HTTP response)

---

## 7. Service Interfaces (Ports)

### PQLDetectionRepository (port, implemented by PgPQLDetectionRepository)
```typescript
interface PQLDetectionRepository {
  save(detection: PQLDetection): Promise<PQLDetection>
  findByDialogId(dialogId: string): Promise<PQLDetection[]>
  findByTenantId(tenantId: string, options?: { limit?: number; offset?: number }): Promise<PQLDetection[]>
}
```

### DialogPQLUpdater (port, implemented by Conversation BC)
```typescript
interface DialogPQLUpdater {
  updatePQLScore(dialogId: string, score: number, tier: PQLTier): Promise<unknown>
}
```

---

## 8. ML Service Integration (v2 hook)

`PQLDetectorService` accepts an optional `MLModelService` parameter. When provided and ML prediction is available, it replaces the rule-based score. When ML prediction returns null (model not ready), the service falls back to rule-v1. This enables zero-downtime upgrade from v1 to v2.

```typescript
// v1 path (no ML service)
const result = analyzeRules(event.content, DEFAULT_RULES)
score = result.normalizedScore
tier  = calculateTier(score)

// v2 path (ML service returns prediction)
const mlPrediction = await this.mlModelService.predict(tenantId, content)
// If mlPrediction is null → fall back to rule-v1
```
