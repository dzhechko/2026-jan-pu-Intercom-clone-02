# Architecture Guide

## Overview

KommuniK is a Revenue Intelligence Platform that turns PLG/SaaS support into a revenue source. It detects Product-Qualified Leads (PQLs) in support dialogs and attributes revenue back to the support team.

## Architectural Pattern

**Distributed Monolith (Monorepo)** — All Bounded Contexts live in a single repository and deploy as Docker containers, but maintain strict module boundaries enforced by linting rules (FF-02).

```
Monorepo
├── src/conversation/     BC-01
├── src/pql/              BC-02 (core)
├── src/revenue/          BC-03 (core)
├── src/integration/      BC-04
├── src/iam/              BC-05
├── src/notifications/    BC-06
└── src/shared/           Shared kernel (events, middleware, utils)
```

## Bounded Contexts

### BC-01: Conversation

Handles message intake from all channels (widget, Telegram, VK Max), dialog lifecycle management, operator assignment, and real-time WebSocket communication.

- **Aggregates:** Dialog, Message
- **Events:** MessageReceived, DialogAssigned, DialogClosed
- **Ports:** ChannelPort (implemented by Telegram, Widget, Max adapters)

### BC-02: PQL Intelligence (Core)

Detects purchase intent in dialog messages using a rule engine, computes PQL scores, and enriches context with Memory AI (CRM data).

- **Aggregates:** PQLDetector, RuleEngine
- **Events:** PQLDetected, PQLScoreUpdated, PQLFeedbackReceived
- **Ports:** CRMPort, RAGPort
- **Evolution:** v1 Rule-based (current) -> v2 ML (after 1K dialogs) -> v3 LLM (after 10K + GPU)

### BC-03: Revenue (Core)

Links PQL detections to closed CRM deals, generates Revenue Intelligence Reports, and provides an analytics dashboard.

- **Aggregates:** Attribution, RevenueReport
- **Events:** RevenueAttributed, ReportGenerated
- **Ports:** CRMPort (for deal status)

### BC-04: Integration

MCP adapter layer. All external API communication goes through this context. Implements Anti-Corruption Layer (ACL) and Circuit Breaker patterns.

- **Adapters:** AmoCRMMCPAdapter, MaxMCPAdapter, PostgresMCPAdapter, GrafanaMCPAdapter, RAGMCPAdapter
- **Patterns:** Circuit Breaker (opossum), ACL, timeout (3000ms max)

### BC-05: Identity and Access (IAM)

Multi-tenancy, JWT authentication, operator management, and Row-Level Security enforcement.

- **Aggregates:** Tenant, Operator
- **Events:** TenantCreated, OperatorRegistered
- **Middleware:** JWT validation, RLS context setter

### BC-06: Notifications

PQL Pulse notifications, email delivery, and push notifications for PQL events.

- **Aggregates:** NotificationSettings
- **Events:** NotificationSent
- **Channels:** In-app (WebSocket), Email (Resend), Telegram (bot)

## Event Flow

The primary event flow from message intake to revenue attribution:

```
Client sends message
       |
       v
[MessageReceived event] ──> Redis Stream: events:messages
       |
       v
PQL Detector (worker)
  ├── RuleEngine: pattern matching (15+ signals)
  └── Memory AI: CRM context via amoCRM MCP (parallel)
       |
       v
[PQLDetected event] ──> Redis Stream: events:pql
       |
       ├──> WebSocket push to Operator Workspace
       ├──> Revenue Attribution Service
       └──> PQL Pulse Notification
              |
              v
[RevenueAttributed event] ──> Redis Stream: events:revenue
       |
       v
Revenue Report generation
```

Key design decisions in this flow:
- MessageReceived does NOT wait for PQL detection (fire-and-forget via Redis Streams).
- RuleEngine and Memory AI run in parallel (PS-01).
- Each event is processed exactly once via Redis Stream consumer groups.

## Architectural Decision Records (ADR)

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-001 | Distributed Monolith | Simplicity for small team; strict BC boundaries via lint rules |
| ADR-002 | Cloud.ru MCP as integration layer | Never call external APIs directly from domain code |
| ADR-003 | Russian VPS only (HOSTKEY) | 152-FZ data residency compliance |
| ADR-004 | PostgreSQL 16 with RLS | Tenant isolation at database level, not application level |
| ADR-005 | Socket.io for real-time | Mature WebSocket library with fallbacks and rooms |
| ADR-006 | Redis Streams for async events | Reliable event delivery with consumer groups |
| ADR-007 | JWT + RLS middleware | Stateless auth with database-enforced tenant isolation |
| ADR-008 | opossum Circuit Breaker | Prevent cascade failures when MCP servers are down |
| ADR-009 | Rule-based PQL v1, ML v2, LLM v3 | Start simple, evolve with data volume |
| ADR-010 | Zod for input validation | Runtime type safety at API boundaries |
| ADR-011 | Next.js 14 SSR | Single deployment for frontend and API |
| ADR-012 | Resend for email (metadata only) | No PII through foreign services |

## MCP Integration

All external integrations use Cloud.ru AI Fabric MCP servers via the Integration BC (BC-04):

```
Domain Code (BC-01..03)
     |
     | (CRMPort / RAGPort interface)
     v
Integration BC (BC-04)
     |
     | (MCP Adapter + ACL + Circuit Breaker)
     v
Cloud.ru AI Fabric
     |
     ├── amoCRM MCP (38 stars) — CRM, deals, contacts
     ├── Max MCP (23 stars) — VK Max messaging
     ├── Postgres MCP (7 stars) — AI analytics queries
     ├── Grafana MCP (8 stars) — Monitoring dashboards
     └── RAG MCP — Knowledge base, auto-reply drafts
```

### MCP Adapter pattern

Every MCP adapter follows this structure:

```typescript
class AmoCRMMCPAdapter implements CRMPort {
  private circuitBreaker: CircuitBreaker;  // opossum

  constructor(config: MCPConfig) {
    this.circuitBreaker = new CircuitBreaker(this.callMCP, {
      timeout: 3000,           // 3s max
      errorThresholdPercentage: 50,
      resetTimeout: 30000,     // 30s before half-open
    });
  }

  async getContact(email: string): Promise<Result<Contact, MCPError>> {
    try {
      const result = await this.circuitBreaker.fire({ method: 'getContact', params: { email } });
      return Result.ok(this.mapToContact(result));  // ACL: map MCP response to domain type
    } catch (error) {
      return Result.err(new MCPError('amoCRM unreachable'));  // graceful degradation
    }
  }
}
```

## Fitness Functions

Fitness functions are automated checks that guard architectural qualities:

### Critical (blocks deploy)

| ID | Rule | Threshold |
|----|------|-----------|
| FF-01 | PQL detection latency | < 2000ms p95 |
| FF-03 | Tenant RLS isolation | 100% (zero cross-tenant leaks) |
| FF-10 | Data residency | All data on Russian VPS only |

### High (blocks merge)

| ID | Rule | Threshold |
|----|------|-----------|
| FF-02 | No cross-BC imports | 0 violations (ESLint) |
| FF-04 | Circuit Breaker on every MCP adapter | 100% coverage |
| FF-05 | RuleEngine test coverage | >= 95% |
| FF-08 | Redis Stream consumer lag | < 1000 messages |

### Running fitness functions

```bash
# All fitness functions
npm run fitness

# Critical only (pre-deploy)
npm run fitness:critical

# Architecture isolation check
npm run lint:arch
```

## Security Architecture

### Authentication and authorization

```
Client Request
     |
     v
Nginx (SSL termination, rate limiting)
     |
     v
Express Middleware Chain:
  1. Rate limiter (express-rate-limit + Redis)
  2. JWT verification (jose library)
  3. RLS context setter: SET app.tenant_id = jwt.tenantId
  4. Role checker (ADMIN / OPERATOR)
     |
     v
Route Handler
     |
     v
PostgreSQL (RLS enforced)
```

### API key encryption

Tenant API keys (amoCRM, Telegram, etc.) are stored encrypted:

- Algorithm: AES-256-GCM
- Key source: `ENCRYPTION_KEY` environment variable
- Decryption: only at MCP request time, zeroed from memory immediately after

### Rate limits

| Endpoint | Limit |
|----------|-------|
| `/api/dialogs` | 100 req/min per operator |
| `/api/pql/feedback` | 300 req/min per operator |
| WebSocket events | 50 events/sec per tenant namespace |
| Chat Widget messages | 10 msg/min per session |

### Webhook verification

| Source | Method |
|--------|--------|
| Telegram | HMAC-SHA256 signature verification |
| amoCRM | Shared secret in header |
| VK Max | MCP protocol authentication |

Unverified webhooks are rejected with HTTP 401.

## Folder Structure

Each Bounded Context follows a consistent DDD-based folder structure:

```
src/{bc-name}/
├── domain/
│   ├── aggregates/       # Aggregate Root classes
│   ├── events/           # Domain Event type definitions
│   ├── ports/            # Interface definitions (CRMPort, RAGPort)
│   └── value-objects/    # Value Objects (readonly, no setters)
├── application/
│   ├── services/         # Application Services (use case orchestration)
│   └── handlers/         # Event Handlers (Redis Stream consumers)
└── infrastructure/
    ├── repositories/     # PostgreSQL implementations
    └── adapters/         # MCP Adapters (BC-04 only)
```

### Import rules

- Cross-BC imports are forbidden (enforced by ESLint rule FF-02).
- Shared kernel imports are allowed: `shared/events/*`, `shared/middleware/*`, `shared/utils/*`.
- Domain layer must not import from infrastructure layer.
