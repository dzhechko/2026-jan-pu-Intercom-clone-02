# IAM-01: Tenant + Operator + JWT + RLS

**Status:** Done | **BC:** iam | **Priority:** must | **Milestone:** M1

## Summary

Foundation IAM layer providing multi-tenant isolation via PostgreSQL RLS, JWT authentication with role-based access, and operator management (invite, activate, deactivate). Every API request is scoped to a tenant via `SET app.tenant_id` middleware (ADR-007).

## User Stories

- US-IAM-01: As a SaaS founder, I want to register my company and get admin access, so that I can start using the platform.
- US-IAM-02: As an admin, I want to invite operators by email, so that my team can handle support.
- US-IAM-03: As a platform operator, I want tenant data to be fully isolated, so that one tenant cannot access another's data.

## Technical Design

### Architecture

```
src/iam/
  domain/aggregates/
    tenant.ts          — Tenant aggregate (id, name, plan, status, settings)
    operator.ts        — Operator aggregate (id, tenantId, email, role, status)
  infrastructure/repositories/
    tenant-repository.ts   — PostgreSQL CRUD for iam.tenants
    operator-repository.ts — PostgreSQL CRUD for iam.operators (RLS-aware)
  application/services/
    auth-service.ts    — register, login, inviteOperator, verifyToken
  infrastructure/
    auth-routes.ts     — Express router /api/auth/*
```

### Key Decisions

1. **Atomic registration:** `register()` wraps tenant + admin operator creation in a DB transaction (BEGIN/COMMIT). If either fails, both roll back.
2. **JWT at call time:** `getJwtSecret()` reads env var on each call (not at import time) — allows tests to set `process.env.JWT_SECRET` in `beforeEach`.
3. **bcrypt rounds = 12:** Balance between security and login latency (~200ms hash).
4. **Zod validation:** `RegisterSchema`, `LoginSchema`, `InviteOperatorSchema` validate all API input before touching the DB.
5. **RLS bypass for login:** `findByEmail()` in OperatorRepository does NOT set `app.tenant_id` because at login time we don't know the tenant yet.

### Files

| File | Role |
|------|------|
| `src/iam/domain/aggregates/tenant.ts` | Tenant aggregate with TenantSettings (pqlThreshold, notifyChannels, crmIntegration, customBranding) |
| `src/iam/domain/aggregates/operator.ts` | Operator aggregate, JwtPayload interface, Role type |
| `src/iam/infrastructure/repositories/tenant-repository.ts` | CRUD: create, findById, findAllActive, update. Optional PoolClient for transactions |
| `src/iam/infrastructure/repositories/operator-repository.ts` | CRUD: findByEmail (bypasses RLS), findByTenantId, findById, create, updateStatus |
| `src/iam/application/services/auth-service.ts` | register (atomic), login (bcrypt+JWT), inviteOperator (admin-only), verifyToken |
| `src/iam/infrastructure/auth-routes.ts` | POST /register (201/409), POST /login (401/400), GET /me (JWT), POST /operators (admin) |
| `src/shared/middleware/tenant.middleware.ts` | JWT verification + `SET app.tenant_id` before every DB query |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | None | Register tenant + first admin operator |
| POST | /api/auth/login | None | Login, returns JWT |
| GET | /api/auth/me | JWT | Get current operator profile |
| POST | /api/auth/operators | JWT (admin) | Invite new operator |

## Dependencies

- Depends on: nothing (no dependencies)
- Blocks: FR-07 (Operator Workspace), FR-13 (Multi-operator)

## Tests

- `src/iam/application/services/auth-service.test.ts` — 13 tests:
  - register: creates tenant + admin operator, returns JWT, rejects duplicate email
  - login: valid credentials, wrong password, unknown email
  - JWT claims: contains tenantId, operatorId, role, email
  - verifyToken: valid token, expired token, invalid token
  - inviteOperator: creates operator with role, admin-only gate

## Acceptance Criteria

- [x] Tenant registration creates isolated workspace
- [x] JWT contains tenantId, operatorId, role, email
- [x] Login with bcrypt password verification
- [x] Admin can invite operators
- [x] Zod validation on all API inputs
- [x] RLS via `SET app.tenant_id` middleware
- [x] 13 tests passing

## BDD Scenario (from test-scenarios.feature)

```gherkin
Scenario: Row-Level Security предотвращает доступ к чужим данным
  Given тенант A имеет 10 диалогов
  And тенант B имеет 5 диалогов
  When API запрос выполняется с JWT тенанта A
  Then в ответе только 10 диалогов тенанта A
  And диалоги тенанта B недоступны (PostgreSQL RLS)
```
