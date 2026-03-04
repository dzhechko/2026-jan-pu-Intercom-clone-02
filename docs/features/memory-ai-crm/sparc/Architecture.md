# Architecture: FR-03 Memory AI — CRM Context
**Feature ID:** FR-03
**Version:** 1.0 | **Date:** 2026-03-04

---

## 1. C4 Level 3 — Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  BC-02 PQL Intelligence Context                                      │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Application Layer                                              │ │
│  │                                                                 │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │  MemoryAIService                                         │  │ │
│  │  │  src/pql/application/services/memory-ai-service.ts      │  │ │
│  │  │                                                          │  │ │
│  │  │  + fetchContext(email, tenantId)                         │  │ │
│  │  │  + invalidateCache(email, tenantId)                      │  │ │
│  │  │                                                          │  │ │
│  │  │  Deps: CRMPort (domain interface) + Redis               │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │                    |                                            │ │
│  │                    | uses (interface)                           │ │
│  │                    v                                            │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │  CRMPort (Domain Port)                                   │  │ │
│  │  │  src/pql/domain/ports/crm-port.ts                        │  │ │
│  │  │                                                          │  │ │
│  │  │  interface CRMPort {                                     │  │ │
│  │  │    getContactContextEnriched()                           │  │ │
│  │  │    getContactContext()                                   │  │ │
│  │  │    createDeal()                                          │  │ │
│  │  │    findDealByDialogContext()                             │  │ │
│  │  │  }                                                       │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Infrastructure Layer                                           │ │
│  │                                                                 │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │  MemoryAI Routes                                         │  │ │
│  │  │  src/pql/infrastructure/memory-ai-routes.ts              │  │ │
│  │  │                                                          │  │ │
│  │  │  GET /api/memory/:dialogId                               │  │ │
│  │  │  GET /api/memory/contact/:email                          │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              |
                              | implements CRMPort
                              | (cross-BC dependency via interface only)
                              v
┌─────────────────────────────────────────────────────────────────────┐
│  BC-04 Integration Context                                           │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  AmoCRMMCPAdapter                                            │   │
│  │  src/integration/adapters/amocrm-mcp-adapter.ts             │   │
│  │                                                              │   │
│  │  CircuitBreaker (opossum)                                    │   │
│  │    timeout: 2000ms                                           │   │
│  │    errorThresholdPercentage: 50%                             │   │
│  │    resetTimeout: 30000ms                                     │   │
│  │    rollingCountTimeout: 10000ms                              │   │
│  │                                                              │   │
│  │  callMCP() --> fetch(mcpBaseUrl/tools/{tool})                │   │
│  │  translateToEnrichedContext() [ACL]                          │   │
│  │  generateMockContext() [fallback]                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              |
                              | HTTP/SSE (MCP protocol)
                              v
┌─────────────────────────────────────────────────────────────────────┐
│  Cloud.ru AI Fabric                                                  │
│                                                                      │
│  amoCRM MCP Server (38★)                                            │
│    tools: get_contact_enriched, get_contact_by_email,               │
│            create_lead, find_deals                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Hexagonal Architecture (Ports & Adapters)

```
                    ┌─────────────────────────────────┐
                    │         Application Core          │
                    │                                   │
  HTTP Request ───▶ │  MemoryAIService.fetchContext()   │
                    │          |                        │
                    │          | drives                 │
                    │          v                        │
                    │      [CRMPort]  ◀─── interface ───┤
                    │                                   │
                    └─────────────────────────────────┘
                                 |
                      implements |
                                 v
                    ┌─────────────────────────────────┐
                    │      AmoCRMMCPAdapter             │
                    │   (BC-04 Infrastructure)         │
                    │   + CircuitBreaker               │
                    │   + ACL Translation              │
                    └─────────────────────────────────┘
                                 |
                                 | MCP Protocol
                                 v
                    ┌─────────────────────────────────┐
                    │     amoCRM MCP (Cloud.ru)        │
                    └─────────────────────────────────┘
```

**Why this matters:**
- `MemoryAIService` (BC-02) never imports from `src/integration/`. It only sees `CRMPort`.
- The adapter lives in BC-04 and is injected at composition root.
- This satisfies FF-02 (no cross-BC imports) and ADR-002 (MCP as integration layer).

---

## 3. MCP Adapter Pattern

The adapter follows the Anti-Corruption Layer pattern (ADR-008) in three layers:

### Layer 1: Circuit Breaker (Resilience)
```
CircuitBreaker wraps callMCP()
  CLOSED state → requests pass through normally
  HALF-OPEN state → test request after resetTimeout (30s)
  OPEN state → fallback() returns mock context immediately
```

### Layer 2: Transport (callMCP)
```
fetch(mcpBaseUrl/tools/{tool}, POST, timeout: 2000ms)
  Success → Result.ok(json)
  HTTP error → Result.err(MCPError)
  Network error → throws (caught by CircuitBreaker)
```

### Layer 3: ACL Translation (translateToEnrichedContext)
```
amoCRM raw JSON → domain CRMContactContext
  contact.name → contactName
  custom_fields_values.plan → currentPlan
  created_at (Unix) → accountAge (days)
  leads[] → deals[] (with mapDealStatus)
  tags[].name → tags[]
  dialogs_count → previousDialogCount
  enrichment score computed from field presence
```

---

## 4. Redis Caching Architecture

```
MemoryAIService
  |
  |-- Redis.get("memory-ai:context:{tenantId}:{email}")
  |     |-- HIT --> return parsed CRMContactContext
  |     |-- MISS --> call CRMPort
  |
  |-- [After successful CRM call]
  |-- Redis.set(key, JSON.stringify(context), 'EX', 300)
```

**Cache key design:**
```
memory-ai:context:{tenantId}:{email.toLowerCase()}
```

Tenant isolation is built into the key — no cross-tenant reads are possible.
Email is lowercased for normalization (alice@ACME.com = alice@acme.com).

**TTL:** 300 seconds (5 minutes). Balances freshness vs. CRM load.
Docs pseudocode PS-03 specifies 10 minutes; implementation uses 5 minutes
for fresher data in active support sessions.

**Not cached:**
- `status: 'not_configured'` — always re-checked (configuration may change)
- Error/degraded contexts — allow retry on next request

---

## 5. Cross-BC Dependencies

| Dependency | Direction | Mechanism | ADR Compliance |
|-----------|-----------|-----------|----------------|
| BC-02 uses CRMPort | BC-02 → (interface) → BC-04 | Dependency injection at composition root | ADR-002, ADR-008 |
| MemoryAI routes query BC-01 DB | BC-02 infra → conversations schema | Direct SQL (shared DB, different schema) | ADR-001 (distributed monolith) |

**Important:** `src/pql/` never imports from `src/integration/`. The CRMPort interface is
defined in `src/pql/domain/ports/` (owned by the consuming BC). The adapter in `src/integration/`
imports the interface to implement it. This is the correct dependency direction per DIP.

---

## 6. Fitness Function Compliance

| FF | Requirement | How Satisfied |
|----|-------------|---------------|
| FF-02 | No cross-BC imports | CRMPort defined in BC-02 domain/ports; adapter in BC-04 imports it to implement |
| FF-04 | Circuit Breaker on every MCP adapter | opossum CB in AmoCRMMCPAdapter constructor (timeout:2000, reset:30000) |
| FF-10 | Data residency — Russian VPS only | amoCRM MCP runs on Cloud.ru (Russian); no foreign API calls |

---

## 7. Sequence Diagram: fetchContext() Call

```
Operator Browser     memory-ai-routes    MemoryAIService    Redis     AmoCRMMCPAdapter    amoCRM MCP
      |                    |                   |              |              |                 |
      |-- GET /api/memory/:dialogId -->|        |              |              |                 |
      |                    |-- SQL: get contactEmail -->PG     |              |                 |
      |                    |<-- contactEmail ------------------|              |                 |
      |                    |-- fetchContext(email, tenantId) ->|              |                 |
      |                    |                   |-- GET key --->|              |                 |
      |                    |                   |<-- MISS ------|              |                 |
      |                    |                   |-- getContactContextEnriched()-->|              |
      |                    |                   |              |-- fire(CB) -->|                 |
      |                    |                   |              |              |-- POST /tools/.. |
      |                    |                   |              |              |<-- raw JSON -----|
      |                    |                   |              |-- ACL: translate() -------------|
      |                    |                   |<-- CRMResult.ok(context) ---|                 |
      |                    |                   |-- SET key, TTL 300 -->|     |                 |
      |                    |<-- CRMResult.ok --|              |              |                 |
      |<-- 200 { data } ---|                   |              |              |                 |
```

---

## 8. Deployment View

```
Docker Compose (Russian VPS — HOSTKEY)
  |
  |-- app container
  |     src/pql/application/services/memory-ai-service.ts
  |     src/pql/infrastructure/memory-ai-routes.ts
  |     src/integration/adapters/amocrm-mcp-adapter.ts
  |
  |-- redis container
  |     Cache: memory-ai:context:*
  |
  |-- postgres container
  |     conversations.dialogs (contact_email lookup)
  |
  \-- [external] Cloud.ru AI Fabric
        amoCRM MCP Server (Russian infrastructure)
```

All data flows within Russian territory. CRM context is fetched from Cloud.ru AI Fabric
(Russian cloud provider), cached in on-premise Redis, and never sent to foreign services.
This satisfies FF-10 and 152-ФЗ data residency requirements.
