# Specification: FR-02 — PQL Flag in Dialog
**Feature ID:** FR-02
**Version:** 1.0 | **Date:** 2026-03-04 | **Status:** Implemented

---

## 1. PQL Tier Classification

### 1.1 Tier Thresholds

```typescript
// src/pql/domain/value-objects/pql-score.ts
export type PQLTier = 'HOT' | 'WARM' | 'COLD'

export function calculateTier(score: number): PQLTier {
  if (score >= 0.80) return 'HOT'
  if (score >= 0.65) return 'WARM'
  return 'COLD'
}
```

| Tier | Score Range | Semantic |
|------|-------------|----------|
| HOT  | >= 0.80     | Strong purchase intent — escalate immediately |
| WARM | >= 0.65     | Moderate intent — monitor, offer follow-up |
| COLD | < 0.65      | Weak or no signals — normal support |

### 1.2 Score Calculation

Score is derived from the RuleEngine (PS-02). Raw weight is the sum of weights of all matched rules. Normalized score = `min(rawWeight / MAX_POSSIBLE_WEIGHT, 1.0)`.

`MAX_POSSIBLE_WEIGHT` = sum of the top-5 rule weights = 0.60 + 0.50 + 0.45 + 0.45 + 0.45 = 2.45 (computed dynamically from DEFAULT_RULES at module load).

---

## 2. Signal Rules (DEFAULT_RULES)

15 default rules ship with the product. All patterns are case-insensitive regexes.

| Rule ID | Pattern | Weight | Signal Type |
|---------|---------|--------|-------------|
| R01 | тариф \| pricing \| стоимость | 0.40 | PRICING |
| R02 | enterprise \| корпоратив | 0.50 | ENTERPRISE |
| R03 | команда \| пользователей \| seats | 0.35 | SCALE |
| R04 | интеграц \| api \| webhook | 0.30 | TECHNICAL |
| R05 | демо \| показать \| посмотреть | 0.45 | DEMO |
| R06 | договор \| счёт \| оплат | 0.60 | PURCHASE |
| R07 | руководитель \| директор \| ceo \| cto | 0.40 | DECISION_MAKER |
| R08 | сравни \| vs \| альтернатив | 0.35 | EVALUATION |
| R09 | внедрен \| migrate \| перейти | 0.45 | MIGRATION |
| R10 | sla \| uptime \| гарантия | 0.30 | RELIABILITY |
| R11 | безопасност \| 152-фз \| gdpr | 0.30 | COMPLIANCE |
| R12 | пилот \| тест \| попробова | 0.40 | TRIAL |
| R13 | бюджет \| квартал \| план | 0.45 | BUDGET |
| R14 | партнёр \| реселл \| агент | 0.35 | PARTNERSHIP |
| R15 | обучен \| onboard \| внедр | 0.30 | ONBOARDING |

### Message Preprocessing
1. Content length capped at 2000 characters (EC-02 — performance guard)
2. Emoji stripped via unicode range `\u{1F600}-\u{1F9FF}` (EC-03 — normalization)
3. Lowercased and whitespace-normalized before pattern matching

---

## 3. Detection Persistence Schema

Table: `pql.detections`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| dialog_id | UUID | FK → conversation.dialogs |
| tenant_id | UUID | RLS partition column |
| message_id | UUID | FK → conversation.messages |
| score | DECIMAL | 0.0 – 1.0 |
| tier | VARCHAR | HOT / WARM / COLD |
| signals | JSONB | Full array of matched signals |
| top_signals | JSONB | Top 3 by weight |
| created_at | TIMESTAMPTZ | Detection timestamp |

Row-Level Security: `app.tenant_id` session variable gates all queries. No cross-tenant reads possible.

---

## 4. REST API Specification

### GET /api/pql/detections/:dialogId

Returns all PQL detections for a specific dialog, newest first.

**Auth:** Bearer JWT (operator session)
**Middleware:** tenant middleware sets `app.tenant_id` on DB connection

**Response 200:**
```json
{
  "detections": [
    {
      "id": "uuid",
      "dialogId": "uuid",
      "tenantId": "uuid",
      "messageId": "uuid",
      "score": 0.87,
      "tier": "HOT",
      "signals": [
        { "ruleId": "R02", "type": "ENTERPRISE", "weight": 0.50, "matchedText": "enterprise" },
        { "ruleId": "R03", "type": "SCALE", "weight": 0.35, "matchedText": "команда" }
      ],
      "topSignals": [...],
      "createdAt": "2026-03-04T10:00:00Z"
    }
  ]
}
```

### GET /api/pql/detections (paginated)

Returns recent PQL detections for the authenticated tenant.

**Query params:**
- `limit` (int, 1–100, default 50)
- `offset` (int, default 0)

---

## 5. WebSocket Event: pql:detected

Emitted from the server `/chat` namespace to all sockets in room `tenant:{tenantId}` immediately after a detection is saved.

**Event name:** `pql:detected`

**Payload:**
```typescript
{
  detectionId: string    // UUID of the pql.detections row
  dialogId: string       // UUID of the dialog
  tenantId: string       // UUID of the tenant
  score: number          // 0.0 – 1.0
  tier: 'HOT' | 'WARM' | 'COLD'
  topSignals: Array<{
    ruleId: string
    type: string
    weight: number
    matchedText: string
  }>
}
```

The frontend `useDialogs` hook must listen to this event and update the corresponding dialog's `pqlScore` and `pqlTier` fields in local state.

---

## 6. Frontend Display Specification

### 6.1 Dialog List Item (DialogList component)

Tier badge rendered alongside channel badge (Web/TG/VK):

| Tier | Tailwind Classes |
|------|------------------|
| HOT  | `bg-red-100 text-red-700` |
| WARM | `bg-orange-100 text-orange-700` |
| COLD | `bg-gray-100 text-gray-500` |

Badge is suppressed entirely when `dialog.pqlTier` is undefined (no detection yet).

### 6.2 Right Panel PQL Section (RightPanel component)

Section background:
| Tier | Background | Text |
|------|-----------|------|
| HOT  | `bg-red-50` | `text-red-600` |
| WARM | `bg-orange-50` | `text-orange-600` |
| COLD / none | `bg-gray-50` | `text-gray-600` |

Score displayed as large bold number (3xl). Tier label rendered as bordered badge.

Signal list:
- Fetched on dialog selection via `GET /api/pql/detections/:dialogId`
- Signals deduplicated across all detections (highest-weight per type wins)
- Sorted descending by weight
- Display limit: top 5
- Format: `[dot] SIGNAL TYPE   {weight*100}%`
- `data-testid="pql-signals-list"` for test automation

### 6.3 Signal Re-fetch Trigger

The `useEffect` in `RightPanel` depends on `[dialog?.id, dialog?.pqlScore, token]`. When `pqlScore` changes (pushed via `pql:detected` WS event → state update in `useDialogs`), the signal list re-fetches automatically.

---

## 7. PQL Detection Filter — CLIENT Only

The service only analyzes messages with `senderType === 'CLIENT'`. OPERATOR and BOT messages are skipped immediately before any computation. This is a hard rule (PS-01, security — prevents operators from gaming their own score).
