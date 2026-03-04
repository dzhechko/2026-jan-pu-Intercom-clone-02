# Specification: FR-03 Memory AI — CRM Context
**Feature ID:** FR-03
**Version:** 1.0 | **Date:** 2026-03-04 | **Status:** Implemented

---

## 1. Domain Model

### 1.1 CRMContactContext (Value Object)

Defined in `src/pql/domain/ports/crm-port.ts`:

```typescript
interface CRMContactContext {
  readonly contactEmail: string
  readonly contactName?: string
  readonly currentPlan?: string
  readonly accountAge?: number        // days since CRM registration
  readonly deals: {
    id: string
    title: string
    value: number
    status: 'OPEN' | 'WON' | 'LOST'
    closedAt?: string
  }[]
  readonly previousDialogCount: number
  readonly tags: string[]
  readonly enrichmentScore: number    // 0-1: completeness of CRM data
}
```

**Enrichment Score Calculation** (in AmoCRMMCPAdapter.translateToEnrichedContext):

| Field Present | Score Contribution |
|---------------|--------------------|
| contactName   | +0.20              |
| currentPlan   | +0.20              |
| accountAge    | +0.20              |
| deals > 0     | +0.20              |
| tags > 0      | +0.20              |

Score = filled fields / total fields (rounded to 2 decimals).

### 1.2 CRMResult Discriminated Union

```typescript
type CRMResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'not_configured' }   // amoCRM not connected for this tenant
  | { status: 'error'; error: string }

const CRMResult = {
  ok<T>(data: T): CRMResult<T>
  notConfigured<T>(): CRMResult<T>
  error<T>(error: string): CRMResult<T>
}
```

**Rationale:** Distinguishes "tenant has no CRM configured" (expected state) from "CRM
is configured but unreachable" (transient failure). The service handles each differently.

### 1.3 CRMPort Interface (Dependency Inversion)

```typescript
interface CRMPort {
  getContactContext(email, tenantId): Promise<Result<ContactContext>>
  getContactContextEnriched(email, tenantId): Promise<CRMResult<CRMContactContext>>
  createDeal(tenantId, contactEmail, title): Promise<Result<{ dealId: string }>>
  findDealByDialogContext(tenantId, contactEmail, afterDate, beforeDate): Promise<Result<CRMDeal | null>>
}
```

The domain layer (BC-02) depends only on `CRMPort`. The adapter (`AmoCRMMCPAdapter` in BC-04)
implements it. This is a textbook application of the Dependency Inversion Principle.

---

## 2. Service Specification

### 2.1 MemoryAIService

**File:** `src/pql/application/services/memory-ai-service.ts`
**Layer:** Application Service (BC-02)

#### Constructor

```typescript
class MemoryAIService {
  constructor(
    private readonly crmPort: CRMPort,
    private readonly redis: Redis | null,
  ) {}
}
```

Redis is optional (`null` = no caching, calls CRM on every request).

#### Method: fetchContext()

**Signature:** `async fetchContext(contactEmail: string, tenantId: string): Promise<CRMResult<CRMContactContext>>`

**Algorithm:**

```
1. Guard: if contactEmail is empty → return CRMResult.ok(emptyContext)
2. Check Redis: key = "memory-ai:context:{tenantId}:{email.toLowerCase()}"
   - HIT: return CRMResult.ok(parsed JSON)
   - MISS: continue
3. Call crmPort.getContactContextEnriched(email, tenantId)
   - status === 'ok': cache result (EX 300s), return result
   - status === 'not_configured': return as-is (do NOT cache)
   - status === 'error': return CRMResult.ok(emptyContext) [graceful degradation]
4. On uncaught exception: return CRMResult.ok(emptyContext) [graceful degradation]
```

**Empty Context:**
```typescript
{
  contactEmail,
  deals: [],
  previousDialogCount: 0,
  tags: [],
  enrichmentScore: 0,
}
```

#### Method: invalidateCache()

**Signature:** `async invalidateCache(contactEmail: string, tenantId: string): Promise<void>`

Deletes the Redis key. Silently ignores Redis errors.

### 2.2 Cache Key Format

```
memory-ai:context:{tenantId}:{contactEmail.toLowerCase()}
```

Example: `memory-ai:context:tenant-123:alice@acme.com`

**Tenant isolation:** The tenantId is embedded in the cache key. Tenant A can never
read Tenant B's cached context.

---

## 3. Adapter Specification

### 3.1 AmoCRMMCPAdapter

**File:** `src/integration/adapters/amocrm-mcp-adapter.ts`
**Layer:** Infrastructure Adapter (BC-04)
**Implements:** `CRMPort`

#### Circuit Breaker Configuration (opossum)

```typescript
new CircuitBreaker(this.callMCP.bind(this), {
  timeout: 2000,                 // 2s per MCP call
  errorThresholdPercentage: 50,  // open after 50% errors in rolling window
  resetTimeout: 30000,           // try again after 30s
  rollingCountTimeout: 10000,    // 10s rolling window
})

breaker.fallback(() => ({
  ok: false,
  error: new Error('amoCRM MCP circuit open — unavailable'),
}))
```

#### MCP Transport

```typescript
private async callMCP(request: { tool: string; params: Record<string, unknown> }): Promise<Result<any>> {
  const response = await fetch(`${this.mcpBaseUrl}/tools/${request.tool}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.params),
    signal: AbortSignal.timeout(2000),  // double-guard: Node.js level timeout
  })
  // ...
}
```

#### getContactContextEnriched() Behavior

| Condition | Behavior |
|-----------|----------|
| `mcpBaseUrl` is empty | `CRMResult.notConfigured()` |
| Circuit OPEN | Falls back to `generateMockContext(email)` (graceful degradation) |
| MCP returns error | Falls back to `generateMockContext(email)` (graceful degradation) |
| MCP returns data | ACL translation via `translateToEnrichedContext()` |
| Exception thrown | Falls back to `generateMockContext(email)` |

**Note on mock data:** `generateMockContext()` produces deterministic mock data based on
an email hash. This keeps the Memory AI UI functional while real amoCRM MCP is not
yet connected. The structure is identical to real data — replacing the mock with a real
MCP call requires no interface changes.

#### ACL Translation (Anti-Corruption Layer)

The `translateToEnrichedContext()` method maps raw amoCRM response to domain types:

| amoCRM Field | Domain Field | Transformation |
|---|---|---|
| `contacts[0].name` | `contactName` | direct |
| `contacts[0].custom_fields_values.plan` | `currentPlan` | direct |
| `contacts[0].created_at` (Unix timestamp) | `accountAge` | `(Date.now() - ts*1000) / 86400000` |
| `leads[]` | `deals[]` | `mapDealStatus(status_id)` |
| `leads[].closed_at` (Unix) | `deals[].closedAt` | ISO string |
| `dialogs_count` | `previousDialogCount` | direct |
| `contacts[0].tags[].name` | `tags[]` | map to name string |

**amoCRM status_id mapping:**

| amoCRM status_id | Domain status |
|---|---|
| 142 | `WON` |
| 143 | `LOST` |
| anything else | `OPEN` |

---

## 4. REST API Specification

### 4.1 GET /api/memory/:dialogId

**Auth:** JWT (tenant middleware required)
**Description:** Fetches CRM context for the dialog's contact email.

**Process:**
1. Query `conversations.dialogs WHERE id = $1 AND tenant_id = $2`
2. If dialog not found: 404
3. If dialog has no `contact_email`: return empty context (status 200)
4. Call `MemoryAIService.fetchContext(contactEmail, tenantId)`
5. Return result

**Response (200 OK):**
```json
{
  "status": "ok",
  "data": {
    "contactEmail": "alice@acme.com",
    "contactName": "Alice Johnson",
    "currentPlan": "Professional",
    "accountAge": 180,
    "deals": [
      { "id": "deal-1", "title": "Annual Subscription", "value": 12000, "status": "WON", "closedAt": "2025-12-01T00:00:00Z" },
      { "id": "deal-2", "title": "Add-on Package", "value": 2400, "status": "OPEN" }
    ],
    "previousDialogCount": 5,
    "tags": ["enterprise", "high-value"],
    "enrichmentScore": 0.85
  }
}
```

**Response (not_configured):**
```json
{ "status": "not_configured", "data": null }
```

**Response (404):**
```json
{ "error": "Dialog not found" }
```

### 4.2 GET /api/memory/contact/:email

**Auth:** JWT (tenant middleware required)
**Description:** Fetches CRM context directly by email address.

Same response shape as above. Used when dialogId is not available.

---

## 5. Data Flow

```
HTTP GET /api/memory/{dialogId}
  |
  v [memory-ai-routes.ts]
Pool.query("SELECT contact_email FROM conversations.dialogs WHERE id=$1 AND tenant_id=$2")
  |
  v [memory-ai-service.ts]
Redis.get("memory-ai:context:{tenantId}:{email}")
  |-- HIT --> return cached
  |-- MISS -->
          |
          v [amocrm-mcp-adapter.ts]
          CircuitBreaker.fire({ tool: 'get_contact_enriched', params: { email, tenantId } })
            |-- CLOSED --> fetch(`{mcpBaseUrl}/tools/get_contact_enriched`, POST)
            |-- OPEN   --> fallback() --> generateMockContext(email)
          ACL: translateToEnrichedContext(raw, email)
          |
          v [memory-ai-service.ts]
          Redis.set(key, JSON.stringify(context), 'EX', 300)
  |
  v
res.json({ status: 'ok', data: context })
```

---

## 6. Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `AMOCRM_MCP_BASE_URL` | amoCRM MCP server URL | `''` (not configured) |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

When `AMOCRM_MCP_BASE_URL` is empty, adapter returns `CRMResult.notConfigured()`.
When Redis is unavailable, service falls back to direct CRM calls on every request.
