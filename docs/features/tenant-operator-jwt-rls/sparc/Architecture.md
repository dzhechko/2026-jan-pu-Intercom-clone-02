# IAM-01: Architecture Document

**Feature ID:** IAM-01
**BC:** BC-05 Identity & Access
**Status:** Implemented
**Date:** 2026-03-04
**Reference:** ADR-007, ADR-004, FF-03

---

## 1. Context (C4 Level 1 — System Context)

```
┌──────────────────────────────────────────────────────────────┐
│                         Internet                             │
│                                                              │
│   ┌─────────────┐          ┌─────────────┐                  │
│   │  Operator   │  HTTPS   │  КоммуниК   │                  │
│   │  Browser /  │─────────▶│  Platform   │                  │
│   │  Dashboard  │          │  (Node.js)  │                  │
│   └─────────────┘          └──────┬──────┘                  │
│                                   │                          │
│                            ┌──────▼──────┐                  │
│                            │ PostgreSQL  │                   │
│                            │ (RLS + IAM) │                   │
│                            └─────────────┘                  │
└──────────────────────────────────────────────────────────────┘

All components deployed on Russian VPS (152-ФЗ compliance)
```

---

## 2. Container Diagram (C4 Level 2)

```
┌────────────────────────────────────────────────────────────┐
│                    КоммуниК Monorepo                        │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Express API Server                     │  │
│  │                                                      │  │
│  │  ┌─────────────────┐   ┌──────────────────────────┐  │  │
│  │  │  Auth Routes    │   │  Operator Routes         │  │  │
│  │  │  /api/auth/*    │   │  /api/operators/*        │  │  │
│  │  └────────┬────────┘   └──────────┬───────────────┘  │  │
│  │           │                       │                   │  │
│  │  ┌────────▼───────────────────────▼───────────────┐  │  │
│  │  │         Tenant Middleware (JWT + RLS)           │  │  │
│  │  │  jwt.verify → pool.connect → SET app.tenant_id  │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                         │                │                   │
│              ┌──────────▼──┐    ┌────────▼────────┐        │
│              │  PostgreSQL  │    │     Redis 7     │        │
│              │  (iam schema)│    │  (presence:*)   │        │
│              └─────────────┘    └─────────────────┘        │
└────────────────────────────────────────────────────────────┘
```

---

## 3. Component Diagram (C4 Level 3 — BC-05 IAM)

```
                    BC-05: Identity & Access

┌─────────────────────────────────────────────────────────────┐
│  Infrastructure Layer                                        │
│  ┌─────────────────┐      ┌────────────────────────────┐   │
│  │  auth-routes.ts │      │  operator-routes.ts        │   │
│  │  POST /register │      │  GET  /                    │   │
│  │  POST /login    │      │  GET  /online              │   │
│  │  GET  /me       │      │  GET  /:id/stats           │   │
│  │  POST /operators│      │  PATCH/:id/role            │   │
│  └────────┬────────┘      │  DELETE/:id                │   │
│           │               └────────────┬───────────────┘   │
│           │                            │                    │
│  ┌────────▼────────────────────────────▼──────────────┐    │
│  │              Tenant Middleware                       │    │
│  │  src/shared/middleware/tenant.middleware.ts          │    │
│  │  [JWT verify → pool.connect → SET app.tenant_id]    │    │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────┐  ┌───────────────────────────┐   │
│  │  TenantRepository    │  │  OperatorRepository       │   │
│  │  create()            │  │  create()                  │   │
│  │  findById()          │  │  findByEmail() [RLS bypass]│   │
│  │  update()            │  │  findById()                │   │
│  └──────────────────────┘  │  findByTenantId()         │   │
│                             │  updateStatus()           │   │
│                             └───────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────┐
│  Application Layer                                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  AuthService                                          │   │
│  │  register(input) → Result<{tenant, operator, token}> │   │
│  │  login(input)    → Result<{operator, token}>         │   │
│  │  inviteOperator(tenantId, input) → Result<Operator>  │   │
│  │  verifyToken(token) → Result<JwtPayload>             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  PresenceService (Redis)                             │   │
│  │  setOnline / setOffline / getOnlineOperators         │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────┐
│  Domain Layer                                                │
│                                                             │
│  ┌────────────────────┐   ┌────────────────────────────┐   │
│  │  Tenant aggregate  │   │  Operator aggregate        │   │
│  │  tenant.ts         │   │  operator.ts               │   │
│  │  TenantSettings VO │   │  JwtPayload interface      │   │
│  └────────────────────┘   └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Layer Map

| Layer | Files | Rules |
|-------|-------|-------|
| **Domain** | `src/iam/domain/aggregates/*.ts` | Pure TypeScript interfaces, no imports from infra |
| **Application** | `src/iam/application/services/*.ts` | Orchestrates domain + repos, no HTTP coupling |
| **Infrastructure** | `src/iam/infrastructure/**/*.ts` | DB repos, Express routes, adapters |
| **Shared** | `src/shared/middleware/tenant.middleware.ts` | Used by ALL BCs — cross-cutting concern |

**Import direction (enforced by ESLint, FF-02):**
```
Domain ← Application ← Infrastructure
                ↑
           Shared Kernel
```

---

## 5. Security Architecture

### 5.1 Multi-Layer Tenant Isolation

```
Layer 1: JWT verification (tenant.middleware.ts)
  → Proves the request comes from a valid, authenticated operator
  → Extracts tenantId from JWT claims (cannot be forged without JWT_SECRET)

Layer 2: PostgreSQL RLS (migration 002)
  → Even if Layer 1 is bypassed (e.g., internal service call), RLS blocks access
  → Policy: tenant_id = current_setting('app.tenant_id')::UUID

Layer 3: Application-level tenant check (operator-routes.ts)
  → findById() returns operator, then checks operatorResult.value.tenantId === tenantReq.tenantId
  → Returns 404 (not 403) to avoid tenant enumeration
```

### 5.2 Authentication Flow

```
Client                    Express              PostgreSQL
  │                          │                     │
  │  POST /api/auth/login     │                     │
  │  { email, password }      │                     │
  │──────────────────────────▶│                     │
  │                          │                     │
  │                          │  SELECT * FROM      │
  │                          │  iam.operators      │
  │                          │  WHERE email = $1   │
  │                          │────────────────────▶│
  │                          │                     │
  │                          │  [row returned]     │
  │                          │◀────────────────────│
  │                          │                     │
  │                          │  bcrypt.compare(    │
  │                          │    password,        │
  │                          │    row.password_hash│
  │                          │  )                  │
  │                          │                     │
  │                          │  jwt.sign({         │
  │                          │    tenantId,        │
  │                          │    operatorId,      │
  │                          │    role, email      │
  │                          │  }, JWT_SECRET, '24h')
  │                          │                     │
  │  200 { token, operator }  │                     │
  │◀──────────────────────────│                     │
```

### 5.3 Middleware Flow (Protected Request)

```
Client                    Middleware              PostgreSQL
  │                          │                     │
  │  GET /api/auth/me        │                     │
  │  Authorization: Bearer <token>                 │
  │──────────────────────────▶│                     │
  │                          │                     │
  │                          │  jwt.verify(token)  │
  │                          │  → { tenantId, ... }│
  │                          │                     │
  │                          │  pool.connect()     │
  │                          │────────────────────▶│
  │                          │  [PoolClient]       │
  │                          │◀────────────────────│
  │                          │                     │
  │                          │  SET app.tenant_id  │
  │                          │  = '<tenantId>'     │
  │                          │────────────────────▶│
  │                          │                     │
  │                          │  req.dbClient = client
  │                          │  next()             │
  │                          │  [route handler]    │
  │                          │                     │
  │                          │  SELECT * FROM      │
  │                          │  iam.operators      │
  │                          │  WHERE id = $1      │
  │                          │  [RLS auto-filters] │
  │                          │────────────────────▶│
  │                          │                     │
  │  res.on('close')         │                     │
  │  → client.release()      │                     │
  │◀──────────────────────────│                     │
```

---

## 6. RLS Architecture

### 6.1 How RLS Works in PostgreSQL

PostgreSQL Row Level Security attaches a WHERE clause to every query on a table that has RLS enabled:

```sql
-- Without RLS (dangerous):
SELECT * FROM iam.operators WHERE id = $1;
-- Returns operator regardless of tenant

-- With RLS (safe):
-- PostgreSQL internally rewrites to:
SELECT * FROM iam.operators WHERE id = $1
  AND tenant_id = current_setting('app.tenant_id')::UUID;
```

The application never needs to add `tenant_id` to WHERE clauses — the database enforces it automatically.

### 6.2 RLS Exception: Login Flow

```typescript
// OperatorRepository.findByEmail() — RLS intentionally bypassed
async findByEmail(email: string): Promise<Result<Operator | null, Error>> {
  // Uses this.pool directly (not per-request client with SET app.tenant_id)
  // Because at login time, tenant is unknown
  const result = await this.pool.query(
    'SELECT * FROM iam.operators WHERE email = $1 AND status != $2',
    [email.toLowerCase().trim(), 'DISABLED'],
  )
  ...
}
```

This is the only intentional RLS bypass. All other queries go through the middleware-scoped `dbClient`.

### 6.3 Tables with RLS (across all BCs)

| Table | Policy |
|-------|--------|
| `iam.operators` | `tenant_id = current_setting('app.tenant_id')::UUID` |
| `conversations.dialogs` | Same pattern |
| `conversations.messages` | Same pattern |
| `pql.detections` | Same pattern |
| `revenue.reports` | Same pattern |
| `revenue.attributions` | Same pattern |
| `notifications.jobs` | Same pattern |

`iam.tenants` — NO RLS (cross-tenant lookup table)

---

## 7. Concurrency and Connection Management

### 7.1 Pool vs Dedicated Client

```
┌─────────────────────────────────────────────────────┐
│  PostgreSQL Connection Pool (pg.Pool)               │
│                                                     │
│  pool.query() → borrows connection, returns to pool │
│  *** Session params (SET ...) DO NOT persist ***    │
│                                                     │
│  pool.connect() → acquires dedicated PoolClient     │
│  *** Session params PERSIST for client lifetime *** │
│  *** MUST be released with client.release() ***     │
└─────────────────────────────────────────────────────┘
```

The tenant middleware always uses `pool.connect()` to get a dedicated client so that `SET app.tenant_id` persists for the entire request. Using `pool.query()` would silently discard the GUC after the query completes.

### 7.2 Client Lifecycle

```typescript
// Acquire on request start
const client = await pool.connect()
await client.query(`SET app.tenant_id = '${payload.tenantId}'`)

// Release guaranteed via event — works even if route handler throws
res.on('close', () => {
  client.release()
})
```

Using `res.on('close')` rather than `try/finally` in middleware because the response close event fires whether the response ends normally, with an error, or via connection drop.

---

## 8. Integration Points

### 8.1 BC-01 Conversation

```typescript
// BC-01 uses TenantRequest from shared middleware
import { TenantRequest } from '@shared/middleware/tenant.middleware'

// Route handler pattern:
router.post('/dialogs', requireAuth, async (req, res) => {
  const { tenantId, dbClient } = req as TenantRequest
  // dbClient already has app.tenant_id set — RLS active
})
```

### 8.2 All Protected BCs

All BCs that need tenant isolation follow the same pattern:
1. Import `createTenantMiddleware` from `@shared/middleware/tenant.middleware`
2. Apply as Express middleware on all protected routes
3. Access `req.tenantId`, `req.operatorId`, `req.role`, `req.dbClient` in handlers

This is a **Conformist** relationship in the Context Map — all BCs conform to the IAM standard.

---

## 9. Deployment Architecture

```
Docker Compose (VPS HOSTKEY)
│
├── api (Node.js 20 / Express)
│   └── PORT 3001
│   └── JWT_SECRET=<env>
│
├── postgres (PostgreSQL 16-alpine)
│   └── PORT 5432
│   └── Schemas: iam, conversations, pql, revenue, notifications, integrations
│   └── Migration 001: schemas + extensions
│   └── Migration 002: iam tables + RLS
│
├── redis (Redis 7-alpine)
│   └── PORT 6379
│   └── Keys: presence:{tenantId}
│
└── nginx (Nginx 1.25-alpine)
    └── PORT 80/443
    └── Proxies /api → api:3001
```

All services within Docker Compose internal network. Nginx is the only public-facing port. No external API calls for authentication (no foreign SSO providers — 152-ФЗ compliance).
