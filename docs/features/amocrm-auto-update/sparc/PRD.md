# FR-12: amoCRM Auto-Update — Product Requirements Document

## Feature Identity

| Field | Value |
|-------|-------|
| ID | FR-12 |
| Name | amoCRM Auto-Update |
| Status | Done |
| Bounded Contexts | BC-03 Revenue, BC-04 Integration |
| Priority | SHOULD |
| Milestone | M2 |

## Problem Statement

PLG/SaaS companies using KommuniK need to understand how much revenue their support team generates. When a PQL (Product-Qualified Lead) is detected in a support dialog and the associated deal later closes in amoCRM, the system must automatically attribute that revenue back to the PQL detection. Without this automation, revenue attribution is manual, error-prone, and often skipped entirely.

## Core Value Proposition

"On PQL deal close -- auto-attribute in Revenue Report via amoCRM MCP."

This feature closes the loop in the Revenue Intelligence pipeline:
1. **PQL Detection** (FR-05) identifies purchase intent in support dialogs
2. **Memory AI** (FR-03) enriches the operator workspace with CRM context
3. **amoCRM Auto-Update** (FR-12) automatically links closed deals back to PQL detections
4. **Revenue Report** (FR-06) aggregates attributions into actionable reports

## User Stories

| ID | Role | Story | Acceptance Criteria |
|----|------|-------|---------------------|
| US-01 | Admin | As an admin, I want deals closed in amoCRM to be automatically attributed to PQL detections so that revenue is tracked without manual effort | amoCRM webhook triggers attribution; no operator action required |
| US-02 | Operator | As an operator, I want to manually link a PQL detection to a deal so that I can create attributions the system missed | POST /api/attributions creates manual attribution with validation |
| US-03 | Admin | As an admin, I want to list all attributions with optional period filtering so that I can review revenue attribution history | GET /api/attributions returns tenant-scoped data with date filters |
| US-04 | Admin | As an admin, I want duplicate attributions prevented so that revenue is not double-counted | Second attribution for same deal_id returns existing record |

## Functional Requirements

### FR-12.1: Webhook Ingestion
- Receive amoCRM webhook POST at `/api/webhooks/amocrm`
- No JWT authentication (amoCRM sends directly; auth via IP allowlist/shared secret)
- Validate payload structure; reject malformed requests with HTTP 400
- Acknowledge non-deal-closed events with HTTP 200 (no processing)

### FR-12.2: Anti-Corruption Layer (ACL)
- Translate amoCRM `AmoCRMWebhookPayload` into domain `DealClosedEvent`
- Filter only deals with status_id = 142 (amoCRM "won" status)
- Extract contact email from custom fields
- No amoCRM-specific types may appear in domain or application layers

### FR-12.3: Auto-Attribution Pipeline
- Resolve tenant from amoCRM account_id via TenantLookup port
- Check for duplicate attribution (idempotency by deal_id)
- Find PQL detection by contact email within tenant scope
- Calculate time-to-close (days from PQL detection to deal closure)
- Calculate attribution confidence (temporal proximity * PQL score, 90-day max window)
- Persist attribution record
- Emit DealAttributed domain event

### FR-12.4: Manual Attribution
- POST /api/attributions with Zod-validated body (detectionId, dealId, dealValue)
- Requires JWT authentication (operator session)
- Same idempotency and confidence logic as auto-attribution

### FR-12.5: Attribution Queries
- GET /api/attributions with optional start/end date filters
- GET /api/attributions/:detectionId for specific PQL detection
- DELETE /api/attributions/:id for removal
- All queries respect RLS tenant isolation (FF-03)

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Webhook processing latency | < 500ms p95 |
| Idempotency | Guaranteed (no duplicate attributions per deal_id) |
| Tenant isolation | RLS enforced on all attribution queries (FF-03) |
| Error isolation | Batch webhook processing via Promise.allSettled |
| Data residency | All data stored on Russian VPS (FF-10) |

## Dependencies

| Depends On | Description |
|-----------|-------------|
| FR-01 (IAM/JWT) | JWT middleware for manual attribution routes |
| FR-03 (PQL Detection) | PQL detection records for matching by contact email |
| FR-06 (Revenue Report) | Attribution records feed into revenue reports |

| Blocks | Description |
|--------|-------------|
| FR-06 (Revenue Report) | Report enrichment uses attribution data |

## Out of Scope (v1)

- Configurable status_id per pipeline (hardcoded to 142)
- HMAC-SHA256 webhook signature verification (deferred to SH-04 hardening)
- Batch re-attribution for historical deals
- Multi-deal attribution (one PQL detection -> many deals)
