# FR-12: amoCRM Auto-Update
**Status:** Done | **BC:** BC-03 Revenue, BC-04 Integration | **Priority:** SHOULD

## Summary
Automatic revenue attribution triggered by amoCRM webhook events. When a deal is closed/won in amoCRM, the system receives a webhook, translates it through an Anti-Corruption Layer into a domain event, finds the matching PQL detection by contact email, calculates attribution metrics (time-to-close, confidence), and persists the attribution record. Also supports manual attribution by operators.

## User Stories
- US-01: As an admin, I want deals closed in amoCRM to be automatically attributed to PQL detections so that revenue is tracked without manual effort
- US-02: As an operator, I want to manually link a PQL detection to a deal so that I can create attributions the system missed
- US-03: As an admin, I want to list all attributions for my tenant with optional period filtering so that I can review revenue attribution history
- US-04: As an admin, I want duplicate attributions prevented so that revenue is not double-counted

## Technical Design

### Files Created
- `src/revenue/application/services/auto-attribution-service.ts` -- AutoAttributionService with processDealClosed (webhook-driven) and linkDetectionToDeal (manual), both with idempotency and event emission
- `src/revenue/application/services/auto-attribution-service.test.ts` -- 13 comprehensive tests
- `src/integration/infrastructure/crm-webhook-routes.ts` -- POST /api/webhooks/amocrm endpoint (no JWT auth, processes batch deal events via Promise.allSettled)
- `src/integration/infrastructure/crm-webhook-types.ts` -- Anti-Corruption Layer: AmoCRMWebhookPayload types, isDealClosedWebhook guard, translateToDealClosedEvents ACL function
- `src/revenue/infrastructure/attribution-routes.ts` -- CRUD routes for attribution management (create, list, get by detection, delete)
- `src/revenue/infrastructure/repositories/attribution-repository.ts` -- PgAttributionRepository with save, findByDealId, findByDetectionId, findByTenantId (with period filter), deleteById

### Key Decisions
- **ACL pattern (ADR-002):** amoCRM-specific types never leak into domain code. `crm-webhook-types.ts` translates raw webhook payload into `DealClosedEvent` domain events.
- **No JWT on webhook endpoint:** amoCRM sends webhooks directly; authentication is at infrastructure level (IP allowlist or shared secret). The endpoint explicitly does NOT require JWT.
- **amoCRM WON status_id = 142:** Maps to the default "successfully realized" status in amoCRM. Configurable per pipeline in future.
- **Contact email matching:** PQL detection is found by contact email. If the deal has no contact email (EC-05), attribution is skipped gracefully.
- **Idempotent attribution:** `findByDealId` check before save prevents duplicate attributions. Existing attribution is returned as-is.
- **Promise.allSettled for batch:** Multiple deal events in one webhook are processed independently; failures don't block other attributions.
- **Confidence scoring reused:** Same `calculateAttributionConfidence()` from PQLAttribution value object is used for both auto and manual attributions.
- **DealAttributed callback:** Optional event emitter callback for downstream processing (notifications, dashboard refresh).
- **Tenant resolution:** amoCRM account_id is mapped to tenant_id via TenantLookup port, supporting multi-tenancy.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/webhooks/amocrm | Receive amoCRM deal status change webhooks (no JWT auth) |
| POST | /api/attributions | Manually create an attribution (operator auth required) |
| GET | /api/attributions?start=&end= | List attributions with optional period filter |
| GET | /api/attributions/:detectionId | Get attribution for a specific PQL detection |
| DELETE | /api/attributions/:id | Remove an attribution record |

## Dependencies
- Depends on: FR-01 (IAM/JWT for manual attribution routes), FR-03 (PQL detections for matching), FR-06 (Revenue Report aggregate for attribution storage)
- Blocks: FR-06 report enrichment (attributions feed into revenue reports)

## Tests
- `src/revenue/application/services/auto-attribution-service.test.ts` -- 13 tests covering:
  - **processDealClosed:**
    - Creates attribution when PQL detection exists for contact email
    - Emits DealAttributed event on successful attribution
    - Calculates time-to-close in days (Jan 15 to Feb 15 = 31 days)
    - Calculates confidence based on time and PQL score (0 < confidence <= 1)
    - Returns existing attribution for duplicate deals (idempotency)
    - Returns null when no PQL detection found for contact
    - Returns null when deal has no contact email
    - Returns null when tenant not found for amoCRM account
    - Preserves deal value in attribution record
    - Sets operator from responsible user
  - **linkDetectionToDeal:**
    - Creates manual attribution when detection exists
    - Returns null when detection not found
    - Prevents duplicate manual attribution for same deal
    - Emits DealAttributed event on manual link

## Acceptance Criteria
- [x] amoCRM webhook receives deal closed events and creates attributions automatically
- [x] ACL translates amoCRM types to domain events (no external types in domain)
- [x] Attribution includes time-to-close, confidence score, deal value, and operator
- [x] Duplicate attributions are prevented (idempotent by deal_id)
- [x] Missing contact email results in graceful skip (not error)
- [x] Unknown amoCRM account_id results in graceful skip
- [x] Manual attribution endpoint allows operators to link detections to deals
- [x] Batch webhook processing uses Promise.allSettled for error isolation
- [x] All attribution queries respect RLS tenant isolation
- [x] Zod validation on manual attribution input
