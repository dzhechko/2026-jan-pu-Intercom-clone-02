# FR-03: Memory AI (CRM Context)
**Status:** Done | **BC:** pql, integration | **Priority:** must | **Milestone:** M1

## Summary
Auto-loads enriched customer context from amoCRM (via MCP Adapter) before the operator responds. Displays CRM data (deals, plan, tags, dialog history) in the operator sidebar with Redis caching (5 min TTL) and graceful degradation when CRM is unavailable. Uses hexagonal architecture — domain depends on CRMPort interface, never on adapter directly.

## Files Created/Modified

| File | Role |
|------|------|
| `src/pql/application/services/memory-ai-service.ts` | Core service: fetch CRM context via CRMPort, Redis cache (TTL 300s), empty context on failure |
| `src/pql/application/services/memory-ai-service.test.ts` | 11 tests: fetch, caching, invalidation, degradation, enrichment score |
| `src/pql/domain/ports/crm-port.ts` | CRMPort interface, CRMContactContext, CRMResult discriminated union |
| `src/pql/infrastructure/memory-ai-routes.ts` | Express router: GET /api/memory/contact/:email, GET /api/memory/:dialogId |
| `src/integration/adapters/amocrm-mcp-adapter.ts` | AmoCRM MCP adapter with Circuit Breaker (opossum), ACL, mock data |
| `app/(workspace)/hooks/useMemoryAI.ts` | React hook: fetch CRM context per dialog, client-side cache, auto-refresh |
| `src/shared/types/result.ts` | Result/ok/err utility types (modified) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/memory/contact/:email` | Fetch CRM context by contact email |
| GET | `/api/memory/:dialogId` | Look up dialog's contact_email, then fetch CRM context |

## Key Decisions

1. **Hexagonal architecture (ADR-002):** MemoryAIService depends on CRMPort interface, never on AmoCRMMCPAdapter directly
2. **CRMResult discriminated union:** Three-state result (ok | not_configured | error) — UI renders different states for each
3. **Two-layer caching:** Server-side Redis (5 min TTL) + client-side useRef cache
4. **Mock data generator:** Deterministic mock data (hash-based on email) when amoCRM unavailable
5. **Circuit Breaker (FF-04):** opossum with 2000ms timeout, 50% error threshold, 30s reset

## Tests

- `src/pql/application/services/memory-ai-service.test.ts` — 11 tests:
  - CRM context fetch from adapter
  - Empty context for empty email
  - Pass-through of not_configured status
  - Redis cache write (5 min TTL) and cache hit
  - Cache invalidation
  - Operation without Redis (null)
  - Graceful degradation on adapter throw and CRM error
  - Enrichment score: 0 for empty, >0.5 for full data

## Acceptance Criteria

- [x] Operator sees CRM context (name, plan, deals, tags) in sidebar on dialog selection
- [x] CRM context loads automatically on dialog selection
- [x] Redis caches CRM responses for 5 minutes
- [x] Graceful degradation when amoCRM unavailable (enrichmentScore=0)
- [x] UI shows "not_configured" state when amoCRM not set up
- [x] Circuit Breaker opens after repeated failures, recovers after 30s
- [x] Cache can be manually invalidated (refresh button)
- [x] No cross-BC imports — CRMPort interface only
