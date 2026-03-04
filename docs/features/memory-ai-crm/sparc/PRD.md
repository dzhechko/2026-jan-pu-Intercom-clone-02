# PRD: FR-03 Memory AI — CRM Context
**Feature ID:** FR-03
**Version:** 1.0 | **Date:** 2026-03-04 | **Status:** Implemented
**Bounded Context:** BC-02 PQL Intelligence (consumer) + BC-04 Integration (provider)

---

## 1. Problem Statement

Operators responding to support dialogs lack customer context. Without knowing a client's
current subscription plan, open deals, or previous interactions, operators ask redundant
questions — reducing conversion opportunities and degrading customer experience.

**Root cause:** CRM data exists in amoCRM but is not surfaced at the moment an operator
opens a dialog to respond.

---

## 2. Feature Vision

Memory AI automatically loads the customer's CRM context from amoCRM *before* the operator
types their first word. The operator sidebar shows: current plan, open deals, previous
dialog count, account age, and relevant tags — all fetched through the amoCRM MCP adapter
on Cloud.ru AI Fabric.

**Core Value Proposition:** Zero-question interactions. Operator already knows who they
are talking to.

---

## 3. Functional Requirements (MoSCoW)

### MUST HAVE

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-03.1 | Auto-load CRM context on dialog open | CRM panel loads < 1 sec (US-03) |
| FR-03.2 | Display contact plan, deals, dialog count, tags | All fields visible in operator sidebar |
| FR-03.3 | Redis caching with 5-minute TTL | Second request returns cached data; CRM not called again |
| FR-03.4 | Graceful degradation when amoCRM MCP unavailable | Empty context shown; no error thrown to domain |
| FR-03.5 | Cache invalidation endpoint | `invalidateCache()` removes stale entry |
| FR-03.6 | REST endpoints for context fetch | GET /api/memory/:dialogId and GET /api/memory/contact/:email |

### SHOULD HAVE

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-03.7 | enrichmentScore field (0–1) | 0 = no data, 1 = full data; used by PQL score boost |
| FR-03.8 | Context boost for PQL scoring | Free plan + active account + no open deals → +0.10 score |

### COULD HAVE

| ID | Requirement |
|----|-------------|
| FR-03.9 | RAG MCP integration for KB context alongside CRM context |
| FR-03.10 | Webhook-triggered cache invalidation when CRM deal closes |

---

## 4. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-03.1 | Latency: context load | < 1000ms p95 end-to-end (including cache hit) |
| NFR-03.2 | MCP timeout | 2000ms max per amoCRM MCP call (FF-04) |
| NFR-03.3 | Circuit Breaker failover | < 30 seconds to recover (NFR-08) |
| NFR-03.4 | Cache hit rate | > 80% on active dialogs (Redis TTL 5 min) |
| NFR-03.5 | Data residency | All context data stored on Russian VPS only (FF-10) |
| NFR-03.6 | Tenant isolation | Context key includes tenantId — no cross-tenant data leakage |

---

## 5. User Stories

```
US-03 [MUST] As an operator, I want to see the full customer history from amoCRM
      before my first response (plan, open deals, previous interactions),
      so that I don't ask repetitive questions.
      Acceptance: CRM panel loads < 1 sec via amoCRM MCP.

US-03a [MUST] As an operator, I want to see an enrichmentScore indicator
       so that I know how complete the CRM data is and can adjust my response accordingly.

US-03b [SHOULD] As a PQL system, I want to boost the PQL score
       when Memory AI reveals the contact is on a Free plan with > 30 days account age
       and has no open deals, indicating high conversion probability.
```

---

## 6. User Journey: Memory AI in Action

```
Operator opens dialog with client alice@acme.com
    |
    v
[Operator Workspace] calls GET /api/memory/{dialogId}
    |
    v
[MemoryAIService] checks Redis cache
    |-- CACHE HIT --> returns cached context immediately
    |-- CACHE MISS --> calls CRMPort.getContactContextEnriched()
                           |
                           v
                   [AmoCRMMCPAdapter] fires through Circuit Breaker
                       --> amoCRM MCP (Cloud.ru AI Fabric)
                           --> get_contact_enriched(alice@acme.com)
                           <-- { plan: "Professional", deals: [...], tags: [...] }
                   [ACL] translates amoCRM types -> domain CRMContactContext
                           |
                           v
                   [MemoryAIService] stores in Redis (TTL 5 min)
    |
    v
[Operator Sidebar] shows:
  - Name: Alice Johnson
  - Plan: Professional
  - Account Age: 180 days
  - Deals: 2 (1 WON, 1 OPEN)
  - Tags: enterprise, high-value
  - Enrichment Score: 0.85
    |
    v
[PQL Detector] uses enrichmentScore > 0.3 to apply context boost:
  - OPEN deal found --> score -= 0.05
  - Professional plan (not Free) --> no boost
  Final PQL score adjusted
```

---

## 7. MCP Integration Details

| MCP Server | Cloud.ru Stars | Use Case | Priority |
|------------|:--------------:|----------|:--------:|
| amoCRM MCP | 38★ | Memory AI — contact context fetch | MUST |
| Evolution RAG MCP | 1★ | KB context (FR-03.9, future) | COULD |

**amoCRM MCP tools used:**
- `get_contact_enriched` — enriched contact context with deals, tags, history
- `get_contact_by_email` — basic contact lookup (used by RevenueReport)
- `create_lead` — deal creation from PQL (shared with BC-03)
- `find_deals` — deal verification for Revenue Attribution (shared with BC-03)

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Context load latency p95 | < 1000ms |
| Cache hit rate | > 80% |
| MCP circuit open incidents | < 1 per week |
| Operator satisfaction (no repeated questions) | Survey NPS > 40 |
| PQL score accuracy boost via context | Measurable after 100+ PQL detections |
