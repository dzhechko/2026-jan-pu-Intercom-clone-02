# FR-12: amoCRM Auto-Update — Specification

## System Components

### 1. CRM Webhook Types (`src/integration/infrastructure/crm-webhook-types.ts`)

**Purpose:** Anti-Corruption Layer translating amoCRM webhook payloads into domain events.

#### External Types (Raw from amoCRM)

```typescript
interface AmoCRMWebhookLeadStatus {
  readonly id: string
  readonly status_id: string
  readonly pipeline_id: string
  readonly old_status_id: string
  readonly account_id: string
  readonly price?: number
  readonly responsible_user_id?: string
  readonly custom_fields?: Array<{
    id: string; name: string; values: Array<{ value: string }>
  }>
}

interface AmoCRMWebhookPayload {
  readonly leads?: {
    readonly status?: AmoCRMWebhookLeadStatus[]
    readonly add?: AmoCRMWebhookLeadStatus[]
    readonly update?: AmoCRMWebhookLeadStatus[]
  }
  readonly contacts?: {
    readonly update?: Array<{
      id: string; name?: string; email?: string; account_id: string
    }>
  }
  readonly account?: { readonly id: string; readonly subdomain: string }
}
```

#### Domain Event (Internal)

```typescript
interface DealClosedEvent {
  readonly dealId: string
  readonly accountId: string
  readonly dealValue: number
  readonly closedAt: Date
  readonly pipelineId: string
  readonly responsibleUserId: string | null
  readonly contactEmail: string | null
}
```

#### ACL Functions

| Function | Input | Output | Logic |
|----------|-------|--------|-------|
| `isDealClosedWebhook` | `AmoCRMWebhookPayload` | `boolean` | Checks if `leads.status` contains any entry with `status_id === '142'` |
| `translateToDealClosedEvents` | `AmoCRMWebhookPayload` | `DealClosedEvent[]` | Filters status changes to won deals, extracts email from custom fields, maps to domain events |

### 2. Auto-Attribution Service (`src/revenue/application/services/auto-attribution-service.ts`)

**Purpose:** Orchestrates the attribution pipeline for both webhook-driven and manual flows.

#### Ports (Dependencies)

| Port | Interface | Purpose |
|------|-----------|---------|
| `AttributionRepository` | save, findByDealId, findByDetectionId, findByTenantId, deleteById | Persistence of attribution records |
| `PQLDetectionLookup` | findByContactEmail(email, tenantId), findById(detectionId) | Lookup PQL detections for matching |
| `TenantLookup` | findByAmoCRMAccountId(accountId) | Resolve amoCRM account to tenant |
| `onDealAttributed` | callback(Attribution) | Domain event emission |

#### Methods

**`processDealClosed(event: DealClosedEvent): Promise<Attribution | null>`**

Steps:
1. Resolve tenant from `event.accountId` via `TenantLookup`
2. Check for existing attribution by `event.dealId` (idempotency)
3. Validate `event.contactEmail` is present
4. Find PQL detection by contact email within tenant scope
5. Calculate `timeToClose` and `confidence`
6. Save attribution record
7. Emit `DealAttributed` event
8. Return attribution (or null if any precondition fails)

**`linkDetectionToDeal(detectionId, dealId, dealValue, operatorId): Promise<Attribution | null>`**

Steps:
1. Check for existing attribution by `dealId` (idempotency)
2. Look up PQL detection by ID
3. Calculate metrics using current time as close date
4. Save and emit event

### 3. PQL Attribution Value Object (`src/revenue/domain/value-objects/pql-attribution.ts`)

#### Functions

**`calculateTimeToClose(detectedAt: Date, closedAt: Date): number`**
- Returns days between detection and deal closure
- Minimum 0 (no negative values)
- Rounded to nearest integer

**`calculateAttributionConfidence(timeToCloseDays: number, pqlScore: number): number`**
- Returns 0 if `timeToCloseDays > 90`
- `timeFactor = max(0, 1 - timeToCloseDays / 90)`
- `confidence = round(timeFactor * pqlScore * 100) / 100`
- Range: 0.0 to 1.0

### 4. Attribution Repository (`src/revenue/infrastructure/repositories/attribution-repository.ts`)

**Table:** `revenue.attributions`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | FK, RLS policy |
| pql_detection_id | UUID | FK |
| dialog_id | UUID | FK |
| deal_id | VARCHAR | UNIQUE |
| deal_value | NUMERIC | >= 0 |
| closed_at | TIMESTAMP | NOT NULL |
| time_to_close | INTEGER | days |
| operator_id | UUID | nullable |
| confidence | NUMERIC(3,2) | 0.00 - 1.00 |
| created_at | TIMESTAMP | DEFAULT NOW() |

#### Queries

| Method | SQL Pattern | Notes |
|--------|------------|-------|
| save | INSERT ... RETURNING * | Creates new attribution |
| findByDealId | WHERE deal_id = $1 LIMIT 1 | Idempotency check |
| findByDetectionId | WHERE pql_detection_id = $1 LIMIT 1 | Lookup by detection |
| findByTenantId | WHERE tenant_id = $1 [AND closed_at BETWEEN] | Period filter optional, limit 100 |
| deleteById | DELETE WHERE id = $1 | Returns boolean |

### 5. CRM Webhook Routes (`src/integration/infrastructure/crm-webhook-routes.ts`)

**Endpoint:** `POST /api/webhooks/amocrm`

| Aspect | Detail |
|--------|--------|
| Auth | None (amoCRM sends directly) |
| Input | `AmoCRMWebhookPayload` (JSON body) |
| Validation | Rejects if no `leads` or `contacts` key |
| Processing | `isDealClosedWebhook` -> `translateToDealClosedEvents` -> `Promise.allSettled(processDealClosed)` |
| Response | `{ status, processed, failed }` |
| Error handling | Individual failures logged, do not block other events |

### 6. Attribution Routes (`src/revenue/infrastructure/attribution-routes.ts`)

| Method | Path | Auth | Input Validation | Handler |
|--------|------|------|-----------------|---------|
| POST | /api/attributions | JWT | Zod: detectionId, dealId, dealValue | `linkDetectionToDeal` |
| GET | /api/attributions | JWT | Zod: optional start, end dates | `findByTenantId` |
| GET | /api/attributions/:detectionId | JWT | Path param | `findByDetectionId` |
| DELETE | /api/attributions/:id | JWT | Path param | `deleteById` |

## Data Flow Diagram

```
amoCRM Cloud
    |
    | POST /api/webhooks/amocrm (no JWT)
    v
crm-webhook-routes.ts
    |
    | isDealClosedWebhook() filter
    | translateToDealClosedEvents() ACL
    v
DealClosedEvent (domain)
    |
    v
AutoAttributionService.processDealClosed()
    |
    +-- TenantLookup.findByAmoCRMAccountId()  --> tenant_id
    +-- AttributionRepo.findByDealId()         --> idempotency check
    +-- PQLDetectionLookup.findByContactEmail() --> detection record
    +-- calculateTimeToClose()                  --> days
    +-- calculateAttributionConfidence()        --> 0-1 score
    +-- AttributionRepo.save()                  --> persisted
    +-- onDealAttributed callback               --> downstream events
    |
    v
Attribution record in revenue.attributions (RLS-protected)
    |
    v
Revenue Report aggregation (FR-06)
```

## Edge Cases

| ID | Scenario | Behavior |
|----|----------|----------|
| EC-05 | Deal has no contact email | Returns null, logs warning, no error |
| EC-12a | Unknown amoCRM account_id | Returns null, logs warning |
| EC-12b | Duplicate deal_id | Returns existing attribution, skips save |
| EC-12c | PQL detection not found for email | Returns null, logs info |
| EC-12d | Multiple deals in single webhook | Each processed independently via Promise.allSettled |
| EC-12e | Time-to-close > 90 days | Confidence = 0 (attribution still created) |
| EC-12f | Deal value = 0 | Attribution created (valid for free-tier conversions) |
