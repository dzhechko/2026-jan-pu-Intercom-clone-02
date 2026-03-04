# FR-12: amoCRM Auto-Update — Architecture

## Architectural Context

FR-12 spans two bounded contexts (BC-03 Revenue and BC-04 Integration) and implements the final stage of the Revenue Intelligence pipeline. It follows the project's Distributed Monolith pattern with strict BC isolation enforced by ESLint (FF-02).

## Component Diagram (C4 Level 3)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        KommuniK Backend                              │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │ BC-04 Integration                                        │        │
│  │                                                          │        │
│  │  ┌─────────────────────┐   ┌──────────────────────────┐ │        │
│  │  │ crm-webhook-routes  │   │ crm-webhook-types (ACL)  │ │        │
│  │  │ POST /api/webhooks/ │──>│ isDealClosedWebhook()    │ │        │
│  │  │      amocrm         │   │ translateToDealClosed()   │ │        │
│  │  └─────────────────────┘   └──────────────────────────┘ │        │
│  │                                        │                 │        │
│  └────────────────────────────────────────│─────────────────┘        │
│                                           │ DealClosedEvent          │
│  ┌────────────────────────────────────────│─────────────────┐        │
│  │ BC-03 Revenue                          v                 │        │
│  │                                                          │        │
│  │  ┌──────────────────────────────────────────────┐       │        │
│  │  │ AutoAttributionService                        │       │        │
│  │  │  - processDealClosed(DealClosedEvent)         │       │        │
│  │  │  - linkDetectionToDeal(manual)                │       │        │
│  │  └──────┬──────────┬──────────┬─────────────────┘       │        │
│  │         │          │          │                           │        │
│  │         v          v          v                           │        │
│  │  ┌──────────┐ ┌─────────┐ ┌──────────────┐              │        │
│  │  │Attribut. │ │PQLAttrib│ │attribution-  │              │        │
│  │  │Repository│ │(VO)     │ │routes (REST) │              │        │
│  │  └────┬─────┘ └─────────┘ └──────────────┘              │        │
│  │       │                                                   │        │
│  └───────│───────────────────────────────────────────────────┘        │
│          v                                                            │
│  ┌──────────────────┐                                                │
│  │ PostgreSQL 16     │                                                │
│  │ revenue.          │                                                │
│  │   attributions    │                                                │
│  │ (RLS by tenant)   │                                                │
│  └──────────────────┘                                                │
└──────────────────────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### ADR-002 Compliance: MCP Adapter as Integration Layer

The implementation correctly uses the Anti-Corruption Layer (ACL) pattern. amoCRM-specific types (`AmoCRMWebhookPayload`, `AmoCRMWebhookLeadStatus`) are defined in `src/integration/infrastructure/crm-webhook-types.ts` and are translated into the domain `DealClosedEvent` before crossing the BC boundary. No amoCRM types appear in revenue domain code.

### ADR-008 Compliance: Revenue Attribution Design

The service implements the attribution algorithm described in PS-05 of the pseudocode document:
- Time-to-close calculation using day-level granularity
- Confidence scoring with 90-day decay window
- Idempotent attribution by deal_id

### Cross-BC Communication Pattern

```
BC-04 Integration                    BC-03 Revenue
┌──────────────┐                    ┌──────────────────────┐
│ Webhook Route │── DealClosedEvent ──>│ AutoAttributionService │
│              │   (shared type)     │                      │
└──────────────┘                    └──────────────────────┘
```

The `DealClosedEvent` type is defined in `src/integration/infrastructure/crm-webhook-types.ts` and imported by the revenue service. This is an acceptable cross-BC dependency because:
1. The event type is a simple DTO (no behavior)
2. The integration BC owns the external translation
3. The revenue BC consumes the domain-level event

In a future refactor, this could be moved to `shared/events/` for stricter isolation.

### Port-Based Dependency Injection

The `AutoAttributionService` depends on three ports:

| Port | Defined In | Implemented By |
|------|-----------|----------------|
| `AttributionRepository` | `src/revenue/infrastructure/repositories/attribution-repository.ts` | `PgAttributionRepository` |
| `PQLDetectionLookup` | `src/revenue/application/services/auto-attribution-service.ts` | `PgPQLDetectionReader` adapter |
| `TenantLookup` | `src/revenue/application/services/auto-attribution-service.ts` | `PgTenantReader` adapter |

This follows Dependency Inversion Principle (DIP): the application service depends on abstractions, not PostgreSQL or amoCRM implementations directly.

### Tenant Isolation (FF-03)

- `PgAttributionRepository` runs all queries under RLS -- the `tenant_id` column has a Row-Level Security policy
- The `SET app.tenant_id` is applied by the tenant middleware before any DB operation
- Webhook route resolves `tenant_id` from amoCRM `account_id` before passing to the service
- Manual attribution routes extract `tenant_id` from JWT token via middleware

### Error Isolation Strategy

The webhook endpoint processes multiple deal events using `Promise.allSettled`:
- Each `DealClosedEvent` is processed independently
- A failure in one attribution does not block others
- Failed attributions are logged with reasons
- The response reports both `processed` and `failed` counts

### No JWT on Webhook Route

The `/api/webhooks/amocrm` endpoint intentionally skips JWT authentication because amoCRM sends webhooks directly from its servers. Security is provided by:
1. Infrastructure-level IP allowlist (amoCRM IP ranges)
2. Future: HMAC-SHA256 shared secret verification (SH-04, deferred)

This is consistent with the webhook security pattern described in `docs/refinement.md`.

## Database Schema

```sql
CREATE TABLE revenue.attributions (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  pql_detection_id UUID NOT NULL,
  dialog_id     UUID NOT NULL,
  deal_id       VARCHAR(255) NOT NULL,
  deal_value    NUMERIC(12,2) NOT NULL DEFAULT 0,
  closed_at     TIMESTAMP NOT NULL,
  time_to_close INTEGER NOT NULL DEFAULT 0,
  operator_id   UUID,
  confidence    NUMERIC(3,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- RLS policy
ALTER TABLE revenue.attributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON revenue.attributions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Indexes
CREATE UNIQUE INDEX idx_attributions_deal_id ON revenue.attributions(deal_id);
CREATE INDEX idx_attributions_tenant_period ON revenue.attributions(tenant_id, closed_at);
CREATE INDEX idx_attributions_detection ON revenue.attributions(pql_detection_id);
```

## Deployment Considerations

- No new containers required; the webhook route is added to the existing Express server
- amoCRM webhook URL must be configured in amoCRM settings: `https://{domain}/api/webhooks/amocrm`
- The `TenantLookup` port requires a mapping table between amoCRM `account_id` and KommuniK `tenant_id` (stored in `iam.tenant_settings`)
- Circuit Breaker on the AmoCRM MCP Adapter (FF-04) is already implemented in `src/integration/adapters/amocrm-mcp-adapter.ts` with 2000ms timeout and 30s reset
