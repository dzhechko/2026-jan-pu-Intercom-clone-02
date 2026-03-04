# IAM-01: Technical Specification

**Feature ID:** IAM-01
**BC:** BC-05 Identity & Access
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. Domain Model

### 1.1 Tenant Aggregate

```typescript
// src/iam/domain/aggregates/tenant.ts

interface TenantSettings {
  pqlThreshold: number           // 0–1, default 0.65 (WARM threshold)
  notifyChannels: ('EMAIL' | 'PUSH')[]
  crmIntegration?: {
    type: 'AMOCRM' | 'BITRIX24'
    apiKeyEncrypted: string      // AES-256-GCM encrypted (ADR security)
    subdomain: string
  }
  customBranding?: {
    primaryColor: string
    logoUrl: string
    widgetTitle: string
  }
}

interface Tenant {
  id: string                     // UUID v4
  name: string                   // Company name
  plan: 'TRIAL' | 'GROWTH' | 'REVENUE' | 'OUTCOME'
  status: 'ACTIVE' | 'SUSPENDED' | 'CHURNED'
  billingEmail: string
  settings: TenantSettings
  createdAt: Date
  updatedAt: Date
}
```

**Default settings:** `{ pqlThreshold: 0.65, notifyChannels: ['EMAIL'] }`

### 1.2 Operator Aggregate

```typescript
// src/iam/domain/aggregates/operator.ts

interface Operator {
  id: string                     // UUID v4
  tenantId: string               // FK → iam.tenants.id
  email: string                  // Normalized: lowercase + trimmed
  name: string
  passwordHash: string           // bcrypt(12 rounds)
  role: 'ADMIN' | 'OPERATOR'
  status: 'ACTIVE' | 'INVITED' | 'DISABLED'
  createdAt: Date
}

/** JWT payload embedded in Bearer tokens */
interface JwtPayload {
  tenantId: string
  operatorId: string
  role: 'ADMIN' | 'OPERATOR'
  email: string
}
```

**Role permissions matrix:**

| Action | ADMIN | OPERATOR |
|--------|:-----:|:--------:|
| Read own dialogs | Yes | Yes |
| Invite operators | Yes | No |
| Change operator role | Yes | No |
| Deactivate operators | Yes | No |
| View all tenant operators | Yes | Yes |
| Access revenue reports | Yes | No |

---

## 2. Database Schema

### 2.1 Tables (Migration 002)

```sql
-- Schema: iam
CREATE TABLE iam.tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  plan          VARCHAR(20) NOT NULL DEFAULT 'TRIAL'
                  CHECK (plan IN ('TRIAL','GROWTH','REVENUE','OUTCOME')),
  status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','CHURNED')),
  settings      JSONB DEFAULT '{}',
  billing_email VARCHAR(255) NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE iam.operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'OPERATOR'
                  CHECK (role IN ('ADMIN','OPERATOR')),
  status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  password_hash VARCHAR(255) NOT NULL,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);
```

### 2.2 RLS Policies (ADR-007, FF-03)

```sql
-- Enable RLS on operators table
ALTER TABLE iam.operators ENABLE ROW LEVEL SECURITY;

-- Policy: operator rows visible only when app.tenant_id matches
CREATE POLICY tenant_isolation_operators ON iam.operators
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

**Important:** The `iam.tenants` table does NOT have RLS — it is a cross-tenant lookup table that the system reads directly (for registration, system-level checks). Only `iam.operators` (and all other BC tables) enforce RLS.

**RLS GUC setting mechanism:**

```sql
-- Set before any query within this connection:
SET app.tenant_id = '<uuid>';
-- PostgreSQL evaluates USING clause of RLS policy against this value
-- All subsequent queries on this connection respect the policy
```

---

## 3. JWT Specification

### 3.1 Token Structure

```
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: {
  "tenantId":   "<UUID>",
  "operatorId": "<UUID>",
  "role":       "ADMIN" | "OPERATOR",
  "email":      "<email>",
  "iat":        <unix timestamp>,
  "exp":        <iat + 86400>   // 24 hours
}
Signature: HMAC-SHA256(base64url(header) + "." + base64url(payload), JWT_SECRET)
```

### 3.2 Token Issuance

- Library: `jsonwebtoken`
- Secret: `process.env.JWT_SECRET` (read at call time, not import time — testability pattern)
- Expiry: `'24h'` → `expiresIn` option → sets `exp = iat + 86400`
- Algorithm: HS256 (default for jsonwebtoken)

### 3.3 Token Verification

Token verification occurs in the tenant middleware on every protected request:

```typescript
const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
  tenantId: string
  operatorId: string
  role: 'ADMIN' | 'OPERATOR'
}
```

Failure modes:
- Expired token → `TokenExpiredError` → 401
- Invalid signature → `JsonWebTokenError` → 401
- Missing header → 401 immediately (before JWT verification)

---

## 4. API Endpoints

### 4.1 POST /api/auth/register

**Auth:** None (public)

**Request body** (validated by `RegisterSchema`):
```typescript
{
  tenantName: string   // min 2, max 255 chars
  email: string        // valid email format
  password: string     // min 8, max 100 chars
  name: string         // min 2, max 255 chars (operator display name)
}
```

**Response 201:**
```typescript
{
  token: string        // JWT (24h)
  tenant: {
    id: string
    name: string
    plan: 'TRIAL'      // always TRIAL on registration
  }
  operator: {
    id: string
    email: string
    name: string
    role: 'ADMIN'      // always ADMIN for first operator
  }
}
```

**Error responses:**
- `400` — Zod validation failure (detailed message)
- `409` — Duplicate tenant name or operator email (postgres unique constraint)

**Implementation note:** Wraps both DB writes in a transaction (BEGIN/COMMIT). If operator creation fails, tenant creation is rolled back — no orphaned data.

---

### 4.2 POST /api/auth/login

**Auth:** None (public)

**Request body** (validated by `LoginSchema`):
```typescript
{
  email: string
  password: string    // min 1 char
}
```

**Response 200:**
```typescript
{
  token: string
  operator: {
    id: string
    email: string
    name: string
    role: 'ADMIN' | 'OPERATOR'
    tenantId: string
  }
}
```

**Error responses:**
- `400` — Zod validation failure
- `401` — Invalid email or password (generic — no distinction between "not found" and "wrong password")

**Security note:** `findByEmail()` intentionally bypasses RLS — at login time, `app.tenant_id` is unknown. The query uses the pool directly (not the per-request client) and filters by email only.

---

### 4.3 GET /api/auth/me

**Auth:** Bearer JWT (required)

**Response 200:**
```typescript
{
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'OPERATOR'
  tenantId: string
  status: 'ACTIVE' | 'INVITED' | 'DISABLED'
  createdAt: string   // ISO 8601
}
```

**Error responses:**
- `401` — Missing or invalid JWT
- `404` — Operator not found (e.g., was deactivated after token issuance)

---

### 4.4 POST /api/auth/operators

**Auth:** Bearer JWT (ADMIN role required)

**Request body** (validated by `InviteOperatorSchema`):
```typescript
{
  email: string
  name: string        // min 2, max 255
  role?: 'ADMIN' | 'OPERATOR'   // default: 'OPERATOR'
}
```

**Response 201:**
```typescript
{
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'OPERATOR'
  status: 'ACTIVE'    // starts ACTIVE (temp password auto-generated)
  tenantId: string
}
```

**Error responses:**
- `400` — Zod validation failure
- `403` — Not ADMIN role
- `409` — Email already exists in this tenant

---

### 4.5 Operator Management Endpoints (/api/operators)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/operators | JWT | List all operators in tenant |
| GET | /api/operators/online | JWT | List currently online operators |
| GET | /api/operators/:id/stats | JWT | Operator stats (active dialogs, closed today) |
| PATCH | /api/operators/:id/role | JWT (ADMIN) | Change operator role |
| DELETE | /api/operators/:id | JWT (ADMIN) | Soft-delete (sets status=DISABLED) |

**Security guards on management endpoints:**
- Self-demotion from ADMIN is blocked (`400`)
- Self-deactivation is blocked (`400`)
- Cross-tenant operator access returns `404` (not `403`, to avoid tenant enumeration)

---

## 5. Middleware Chain

### 5.1 Tenant Middleware (createTenantMiddleware)

```
HTTP Request
  │
  ▼
Parse Authorization header
  │  Missing → 401
  ▼
jwt.verify(token, JWT_SECRET)
  │  Invalid/expired → 401
  ▼
pool.connect() → acquire dedicated PoolClient
  │
  ▼
client.query("SET app.tenant_id = '<tenantId>'")
  │  Sets PostgreSQL GUC for this connection
  ▼
Attach to request:
  req.tenantId   = payload.tenantId
  req.operatorId = payload.operatorId
  req.role       = payload.role
  req.dbClient   = client  (dedicated, RLS-scoped)
  │
  ▼
res.on('close', () => client.release())
  │  Guaranteed release — even on error
  ▼
next()  →  Route Handler
```

**Critical design point:** The dedicated `PoolClient` is acquired per-request (not per-query). This ensures the `SET app.tenant_id` GUC persists for the entire request lifetime. Returning a pooled client to the pool would reset session parameters — which is why a dedicated client per request is required.

### 5.2 Role Guard (inline in routes)

```typescript
if (tenantReq.role !== 'ADMIN') {
  return res.status(403).json({ error: 'Admin role required' })
}
```

No separate middleware for roles — checked inline at the route handler level.

---

## 6. Input Validation Schemas (Zod)

```typescript
// RegisterSchema
z.object({
  tenantName: z.string().min(2).max(255),
  email:      z.string().email(),
  password:   z.string().min(8).max(100),
  name:       z.string().min(2).max(255),
})

// LoginSchema
z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

// InviteOperatorSchema
z.object({
  email: z.string().email(),
  name:  z.string().min(2).max(255),
  role:  z.enum(['ADMIN', 'OPERATOR']).default('OPERATOR'),
})
```

Validation errors are collected via `.safeParse()` and returned as joined message strings:
```typescript
parsed.error.issues.map((i) => i.message).join('; ')
```

---

## 7. Presence Tracking (Redis)

**Key pattern:** `presence:{tenantId}` → Redis SET of `operatorId` strings

```typescript
// Set online:   SADD presence:{tenantId} {operatorId}
// Set offline:  SREM presence:{tenantId} {operatorId}
// Get all:      SMEMBERS presence:{tenantId}
// Check one:    SISMEMBER presence:{tenantId} {operatorId}
```

Presence is set when operator connects via WebSocket and cleared on disconnect or deactivation.

---

## 8. Result Type Pattern

All service/repository methods return `Result<T, Error>`:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

Callers check `result.ok` before accessing `result.value`. Errors never throw across the application boundary — they are wrapped and propagated as `Result.err`.
