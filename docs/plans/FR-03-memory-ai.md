# FR-03: Memory AI (CRM Context)
**Status:** Done | **BC:** BC-02 PQL Intelligence, BC-04 Integration | **Priority:** MUST

## Summary
Auto-loads enriched customer context from amoCRM (via MCP Adapter) before the operator responds. Displays CRM data (deals, plan, tags, dialog history) in the operator sidebar with Redis caching (5 min TTL) and graceful degradation when CRM is unavailable.

## User Stories
- US-01: As an Operator, I want to see the customer's CRM profile (deals, plan, tags) in the sidebar so that I can provide contextual support without switching to amoCRM.
- US-02: As an Operator, I want CRM context to load automatically when I select a dialog so that I do not waste time searching manually.
- US-03: As an Operator, I want the workspace to remain functional even when amoCRM is down so that I can still respond to customers.

## Technical Design

### Files Created
- `src/pql/application/services/memory-ai-service.ts` — Core service: fetches CRM context via CRMPort, caches in Redis (TTL 300s), returns empty context on failure (enrichmentScore=0).
- `src/pql/application/services/memory-ai-service.test.ts` — 9 unit tests covering fetch, caching, cache invalidation, null Redis, graceful degradation, enrichment score.
- `src/pql/domain/ports/crm-port.ts` — Port interface (CRMPort) with CRMContactContext, CRMResult discriminated union, ContactContext, CRMDeal, CRMContact types.
- `src/pql/infrastructure/memory-ai-routes.ts` — Express router: `GET /api/memory/contact/:email` and `GET /api/memory/:dialogId` endpoints.
- `src/integration/adapters/amocrm-mcp-adapter.ts` — AmoCRM MCP adapter implementing CRMPort with Circuit Breaker (opossum), ACL translation, mock data generator for demo mode.
- `app/(workspace)/hooks/useMemoryAI.ts` — React hook: fetches CRM context per dialog, client-side cache via useRef Map, auto-refresh on dialog change, manual refresh support.

### Files Modified
- `src/shared/types/result.ts` — Added Result/ok/err utility types used by CRM port.

### Key Decisions
- **Hexagonal architecture (ADR-002):** MemoryAIService depends on CRMPort interface, never on AmoCRMMCPAdapter directly. Domain code is decoupled from MCP infrastructure.
- **CRMResult discriminated union:** Three-state result (`ok | not_configured | error`) distinguishes "CRM not set up" from "CRM failed" — the UI renders different states for each.
- **Two-layer caching:** Server-side Redis cache (5 min TTL) reduces MCP calls; client-side useRef cache prevents redundant API calls during dialog switching.
- **Mock data generator:** When real amoCRM MCP is unavailable, the adapter generates deterministic mock data (hash-based on email) so the UI is always demonstrable.
- **Circuit Breaker (FF-04):** opossum wraps all MCP calls with 2000ms timeout, 50% error threshold, 30s reset. Fallback returns mock context instead of throwing.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/memory/contact/:email` | Fetch CRM context by contact email |
| GET | `/api/memory/:dialogId` | Look up dialog's contact_email, then fetch CRM context |

## Dependencies
- Depends on: FR-01 (IAM/JWT for tenant middleware), FR-07 (Operator Workspace for sidebar rendering), BC-01 Dialog table (contact_email column)
- Blocks: FR-09 (Revenue Attribution uses CRM deals data)

## Tests
- `src/pql/application/services/memory-ai-service.test.ts` — 9 tests covering:
  - Enriched CRM context fetch from adapter
  - Empty context for empty email (no CRM call)
  - Pass-through of not_configured status
  - Redis cache write after successful fetch (5 min TTL)
  - Cache hit on second call (CRM not called again)
  - Cache invalidation via invalidateCache()
  - Operation without Redis (null)
  - Graceful degradation when adapter throws
  - Graceful degradation on CRM error status
  - Enrichment score: 0 for empty, >0.5 for full data

## Acceptance Criteria
- [x] Operator sees CRM context (name, plan, deals, tags, dialog count) in sidebar when selecting a dialog
- [x] CRM context loads automatically on dialog selection without manual action
- [x] Redis caches CRM responses for 5 minutes to avoid excessive MCP calls
- [x] When amoCRM is unavailable, operator sees empty context (enrichmentScore=0) without errors
- [x] When amoCRM is not configured for the tenant, UI shows "not_configured" state
- [x] Circuit Breaker opens after repeated MCP failures (50% threshold) and recovers after 30s
- [x] Cache can be manually invalidated (refresh button in UI)
- [x] No cross-BC imports: MemoryAIService uses CRMPort interface, not adapter directly
