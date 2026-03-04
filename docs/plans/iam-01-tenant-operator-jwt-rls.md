# IAM-01: Tenant + Operator + JWT + RLS
**Status:** Done | **BC:** BC-05 Identity & Access | **Priority:** MUST

## Summary
Implemented the foundational multi-tenancy identity and access management layer with Tenant/Operator aggregates, JWT-based authentication (register, login, invite), Zod input validation, and PostgreSQL Row-Level Security (RLS) enforcement via `app.tenant_id` GUC. Includes operator management routes (list, role change, deactivation) and Redis-based presence tracking.

## User Stories
- US-01: As a company admin, I want to register my organization so that I get an isolated tenant workspace with an initial ADMIN account.
- US-02: As an operator, I want to log in with email/password so that I receive a JWT token for authenticated API access.
- US-03: As an admin, I want to invite new operators to my tenant so that my team can handle support dialogs.
- US-04: As an admin, I want to manage operator roles and deactivate accounts so that I control access within my workspace.
- US-05: As the system, I want to enforce tenant isolation via RLS so that tenant A never sees tenant B data (FF-03).

## Technical Design

### Files Created
- `src/iam/domain/aggregates/tenant.ts` -- Tenant aggregate root with TenantSettings (PQL threshold, notify channels, CRM integration, custom branding), plan tiers (TRIAL/GROWTH/REVENUE/OUTCOME), status lifecycle, and DEFAULT_TENANT_SETTINGS.
- `src/iam/domain/aggregates/operator.ts` -- Operator aggregate with roles (ADMIN/OPERATOR), status (ACTIVE/INVITED/DISABLED), and JwtPayload interface definition.
- `src/iam/application/services/auth-service.ts` -- AuthService with register (atomic tenant+operator creation), login (bcrypt verify), inviteOperator (admin-only), verifyToken, and issueToken. Uses Zod schemas for all input validation.
- `src/iam/application/services/auth-service.test.ts` -- 11 unit tests covering register, login, JWT claims, token expiry, and error cases.
- `src/iam/application/services/presence-service.ts` -- PresenceService using Redis SETs per tenant (`presence:{tenantId}`) for online/offline tracking.
- `src/iam/infrastructure/repositories/tenant-repository.ts` -- TenantRepository with create, findById, update methods. Uses PoolClient for transactional writes.
- `src/iam/infrastructure/repositories/operator-repository.ts` -- OperatorRepository with create, findByEmail (bypasses RLS for login), findById, findByTenantId, updateStatus.
- `src/iam/infrastructure/auth-routes.ts` -- Auth HTTP routes: POST /register, POST /login, GET /me, POST /operators (admin invite).
- `src/iam/infrastructure/operator-routes.ts` -- Operator management routes: GET / (list), GET /online, GET /:id/stats, PATCH /:id/role, DELETE /:id (soft deactivate).

### Key Decisions
- JWT secret read at call time via `getJwtSecret()` to allow test-time override via `process.env.JWT_SECRET`.
- Registration is atomic: Tenant + ADMIN Operator created in a single DB transaction with BEGIN/COMMIT/ROLLBACK.
- Password hashing uses bcrypt with 12 rounds; tokens expire in 24 hours.
- `findByEmail` intentionally bypasses RLS (uses pool directly, not tenant-scoped client) because login must work without knowing the tenant upfront.
- Operator deactivation is soft-delete (status = DISABLED) rather than hard delete, preserving audit trail.
- Presence uses Redis SETs (`SADD`/`SREM`/`SMEMBERS`) for O(1) online status checks.
- All input validated with Zod schemas (RegisterSchema, LoginSchema, InviteOperatorSchema) before any DB interaction.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Register new tenant + admin operator, returns JWT |
| POST | /api/auth/login | Authenticate operator, returns JWT |
| GET | /api/auth/me | Get current operator profile (requires auth) |
| POST | /api/auth/operators | Invite new operator to tenant (admin only) |
| GET | /api/operators | List all operators for authenticated tenant |
| GET | /api/operators/online | List online operators for tenant |
| GET | /api/operators/:id/stats | Operator stats (active dialogs, closed today) |
| PATCH | /api/operators/:id/role | Change operator role (admin only) |
| DELETE | /api/operators/:id | Soft-deactivate operator (admin only) |

## Dependencies
- Depends on: shared/middleware/tenant.middleware (RLS enforcement), shared/types/result (Result monad)
- Blocks: FR-04 Chat Widget (needs tenant context), FR-07 Operator Workspace (needs auth), all features requiring multi-tenancy

## Tests
- `src/iam/application/services/auth-service.test.ts` -- 11 tests covering:
  - register: creates tenant + admin + token, transaction BEGIN/COMMIT, rollback on error, rejects invalid input (short password, bad email)
  - login: correct credentials return JWT, wrong password fails, unknown email fails
  - JWT: correct claims (tenantId, operatorId, role, email), 24h expiry, verifyToken success/failure

## Acceptance Criteria
- [x] Tenant registration creates isolated workspace with ADMIN operator
- [x] Login returns valid JWT with tenantId, operatorId, role, email claims
- [x] JWT tokens expire after 24 hours
- [x] Input validation via Zod rejects malformed requests (bad email, short password)
- [x] Transaction rollback on registration failure
- [x] Admin can invite operators with temporary password
- [x] Admin can change operator roles (cannot self-demote)
- [x] Admin can deactivate operators (cannot self-deactivate)
- [x] Operator presence tracked via Redis
- [x] Disabled operators excluded from findByEmail (cannot login)
