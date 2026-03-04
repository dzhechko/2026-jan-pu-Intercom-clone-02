# Architecture Compliance Review: IAM-01 Tenant + Operator + JWT + RLS

**Feature ID:** IAM-01
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** APPROVED WITH CONDITIONS -- 3 critical issues must be resolved before production

---

## 1. Architecture Compliance

### FF-03: Tenant RLS Isolation -- PARTIAL FAIL

**Migration 002** correctly enables RLS on `iam.operators` and creates the `tenant_isolation_operators` policy with `USING (tenant_id = current_setting('app.tenant_id')::UUID)`. The `iam.tenants` table intentionally does not have RLS, which is correctly documented as a design decision for cross-tenant lookup.

**The tenant middleware** (`src/shared/middleware/tenant.middleware.ts`) correctly acquires a dedicated `PoolClient` via `pool.connect()`, sets the RLS GUC with `SET app.tenant_id`, attaches the client to `req.dbClient`, and guarantees release via `res.on('close')`. This is architecturally sound.

**CRITICAL FINDING: RLS bypass in operator-routes.ts**

The `operator-routes.ts` file uses `pool.query()` directly in **three locations**, completely bypassing the tenant-scoped `dbClient` that the middleware provides:

1. **Line 119 (updateRole):** `pool.query('UPDATE iam.operators SET role = $1 WHERE id = $2', ...)` -- This UPDATE bypasses RLS entirely. While there is an application-level tenant check on line 110, this violates the defense-in-depth principle mandated by ADR-007. If the application check has a bug, this UPDATE could modify an operator belonging to another tenant.

2. **Lines 196-197 (getOperatorStats):** `pool.query('SELECT COUNT(*)::int AS count FROM conversations.dialogs WHERE operator_id = $1 AND status = \'ASSIGNED\'', ...)` -- Queries `conversations.dialogs` without RLS. If that table has its own RLS policy (it should per the Architecture doc), these queries will either fail or return cross-tenant data depending on PostgreSQL's `app.tenant_id` state for the pool connection.

3. **Lines 203-206 (getOperatorStats):** Same issue -- queries `conversations.dialogs` for closed count without RLS enforcement.

**Severity:** CRITICAL -- violates FF-03 (blocks deploy) and ADR-007.

**CRITICAL FINDING: OperatorRepository uses pool.query() for all reads**

Even more concerning: `OperatorRepository.findById()` (line 82), `findByTenantId()` (line 94), and `updateStatus()` (line 111) all use `this.pool.query()` or `this.pool` directly. The repository never receives or uses the tenant-scoped `dbClient` from the middleware (confirmed: zero occurrences of `dbClient` in any IAM file).

This means **every read and write operation** in the OperatorRepository bypasses RLS, except `findByEmail()` which intentionally bypasses it for login, and `create()` which accepts an optional client parameter used only during registration transactions.

The tenant middleware carefully acquires a dedicated client and sets `app.tenant_id`, but none of the downstream IAM code actually uses that client. The RLS protection for `iam.operators` is effectively **not enforced at the application layer**.

**Why this is partially mitigated:** The `operator-routes.ts` handlers do perform application-level tenant checks (e.g., `operatorResult.value.tenantId !== tenantReq.tenantId`). However, this is Layer 3 protection only. Layer 2 (RLS) is absent for all IAM operations, violating the documented three-layer isolation model.

---

### ADR-007: JWT + RLS -- PARTIAL FAIL

**JWT issuance:** Correctly implemented in `AuthService`. Payload includes `tenantId`, `operatorId`, `role`, `email`. Expiry is `24h` via `TOKEN_EXPIRES_IN`. Algorithm is HS256 (jsonwebtoken default).

**JWT verification:** Implemented in both `AuthService.verifyToken()` and `tenant.middleware.ts`. However, there is a **critical inconsistency** in how the JWT secret is accessed:

- `auth-service.ts` uses `getJwtSecret()` which falls back to `'dev-secret-change-me'`
- `tenant.middleware.ts` uses `process.env.JWT_SECRET!` (non-null assertion, no fallback)

If `JWT_SECRET` is not set in the environment:
- `AuthService.issueToken()` signs with `'dev-secret-change-me'`
- `tenant.middleware.ts` attempts to verify with `undefined` (the `!` does not provide a value)
- `jwt.verify(token, undefined)` throws, returning 401 for every request

This means in a misconfigured deployment, **registration and login would succeed** (producing tokens signed with the weak fallback), but **all subsequent authenticated requests would fail**. While this is "fail-closed" behavior, it creates confusion and masks the real problem.

**RLS enforcement:** Per ADR-007, the application must "ALWAYS `SET app.tenant_id` before DB query" and "NEVER pass tenant_id as filter param." The middleware correctly sets the GUC, but as documented above, the IAM routes never use the scoped client. Meanwhile, `findByTenantId()` passes `tenant_id` as a WHERE clause filter (`WHERE tenant_id = $1`), which directly contradicts the "NEVER pass tenant_id as filter param" directive.

---

### FF-02: No Cross-BC Imports -- PASS

Verified all imports in `src/iam/`:

- Domain layer imports only from own BC and `@shared/types/result`
- Infrastructure imports from `@iam/*` and `@shared/middleware/tenant.middleware`
- `operator-routes.ts` imports from `@iam/*`, `@shared/*`, and `ioredis` (external library)

No imports from `@conversation/*`, `@pql/*`, `@revenue/*`, `@integration/*`, or `@notifications/*`. Clean BC boundary.

**Note:** `operator-routes.ts` queries `conversations.dialogs` directly via raw SQL (lines 196-206), which is a semantic cross-BC dependency even though there is no TypeScript import. The `conversations` schema is owned by BC-01, and BC-05 should not directly query it. This should go through a port/adapter or shared event.

---

### FF-04: Circuit Breaker on MCP Adapters -- N/A

IAM does not use MCP adapters. Not applicable.

---

## 2. Code Quality Review

### Strengths

1. **Clean domain model:** `Tenant` and `Operator` aggregates are pure TypeScript interfaces with no framework dependencies. `TenantSettings` value object is well-structured with sensible defaults via `DEFAULT_TENANT_SETTINGS`.

2. **Atomic registration transaction:** `AuthService.register()` wraps tenant + operator creation in `BEGIN/COMMIT/ROLLBACK` with proper `finally { client.release() }`. This guarantees no orphaned records.

3. **Result<T, E> pattern consistently applied:** All service and repository methods return `Result<T, Error>` instead of throwing. Callers check `result.ok` before accessing `.value`. This is a well-disciplined pattern throughout the codebase.

4. **Generic authentication errors:** Both "email not found" and "wrong password" return `"Invalid email or password"`, preventing email enumeration attacks.

5. **Comprehensive Zod validation:** `RegisterSchema`, `LoginSchema`, `InviteOperatorSchema`, and `UpdateRoleSchema` cover all API inputs with appropriate min/max constraints.

6. **Intentional RLS bypass clearly documented:** `OperatorRepository.findByEmail()` includes a comment explaining the intentional bypass for login flow, which is architecturally correct since tenant is unknown at login time.

7. **PresenceService is clean and focused:** Redis-based presence tracking uses the correct data structure (SET) with `SADD/SREM/SMEMBERS/SISMEMBER` operations. Key pattern `presence:{tenantId}` provides natural tenant scoping.

8. **Good test isolation pattern:** `process.env.JWT_SECRET` set in `beforeEach` and deleted in `afterEach`, combined with `getJwtSecret()` reading at call time, ensures test isolation.

---

### Issues Found

#### Issue 1: OperatorRepository never uses tenant-scoped dbClient (CRITICAL)

```typescript
// operator-repository.ts lines 80-86
async findById(id: string): Promise<Result<Operator | null, Error>> {
  try {
    const result = await this.pool.query(
      'SELECT * FROM iam.operators WHERE id = $1',
      [id],
    )
```

The repository is constructed with `pool` and uses `this.pool.query()` for all operations. It never accepts the tenant-scoped `dbClient` from the middleware. This means RLS is bypassed for every read/write except `create()` (which accepts an optional `client` for transaction use, not for RLS).

**Severity:** CRITICAL

**Fix:** Either (a) refactor repository methods to accept a `PoolClient` parameter (the tenant-scoped client from middleware), or (b) redesign the repository to be instantiated per-request with the scoped client, or (c) at minimum, ensure operator-routes.ts uses `tenantReq.dbClient.query()` for the direct `pool.query()` calls.

---

#### Issue 2: JWT_SECRET inconsistency between auth-service and middleware (HIGH)

```typescript
// auth-service.ts line 28
return process.env.JWT_SECRET ?? 'dev-secret-change-me'

// tenant.middleware.ts line 35
const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
```

Two different access patterns for the same secret. The middleware uses non-null assertion (`!`), meaning it will pass `undefined` to `jwt.verify()` if the env var is missing. The service uses a fallback string. These two values will never match when `JWT_SECRET` is unset.

**Severity:** HIGH

**Fix:** Extract `getJwtSecret()` into `@shared/utils/` and use it in both `auth-service.ts` and `tenant.middleware.ts`. Or better: crash on startup if `JWT_SECRET` is not set.

---

#### Issue 3: Cross-BC raw SQL query to conversations.dialogs (MEDIUM)

```typescript
// operator-routes.ts lines 196-206
const activeResult = await pool.query(
  `SELECT COUNT(*)::int AS count FROM conversations.dialogs
   WHERE operator_id = $1 AND status = 'ASSIGNED'`,
  [req.params.id],
)
```

BC-05 (IAM) directly queries `conversations.dialogs`, a table owned by BC-01 (Conversation). This violates bounded context encapsulation. If BC-01 changes its schema (renames columns, changes status values), BC-05 breaks silently.

**Severity:** MEDIUM

**Fix:** Define a `DialogStatsPort` interface in BC-05 and implement it in BC-01, or expose a shared query service.

---

#### Issue 4: Duplicate detection via string matching (LOW)

```typescript
// auth-routes.ts line 25
const status = result.error.message.includes('duplicate') ? 409 : 400
```

Relies on PostgreSQL error message containing the word "duplicate." This is locale-dependent and version-dependent.

**Severity:** LOW

**Fix:** Check `error.code === '23505'` (PostgreSQL unique_violation) instead. This requires passing the raw error code through the Result type.

---

#### Issue 5: Missing updated_at column in iam.tenants (LOW)

The `Tenant` interface declares `updatedAt: Date`, and `TenantRepository` returns `created_at AS updated_at` as an alias because the actual `updated_at` column does not exist in the migration. The `update()` method does not set an `updated_at` timestamp.

**Severity:** LOW

**Fix:** Add `updated_at TIMESTAMPTZ DEFAULT NOW()` to migration and set it in the UPDATE query.

---

#### Issue 6: PresenceService.setOffline silently does nothing without tenantId (LOW)

```typescript
// presence-service.ts lines 22-26
async setOffline(operatorId: string, tenantId?: string): Promise<void> {
  if (tenantId) {
    await this.redis.srem(`presence:${tenantId}`, operatorId)
  }
}
```

If `tenantId` is undefined, the operator remains in the presence set forever. This is a silent failure.

**Severity:** LOW

**Fix:** Either make `tenantId` required (remove the `?`), or log a warning when called without it.

---

#### Issue 7: No `last_login_at` update on login (LOW)

Migration 002 defines `last_login_at TIMESTAMPTZ` on `iam.operators`, but `AuthService.login()` never updates this column after successful authentication.

**Severity:** LOW

---

## 3. Security Review

### JWT Secret Handling -- FAIL

| Check | Status | Details |
|-------|--------|---------|
| JWT_SECRET from env var | PARTIAL | Used in auth-service via `getJwtSecret()`, but with dangerous fallback |
| Fallback secret in production | FAIL | `'dev-secret-change-me'` -- any attacker who reads source code can forge tokens |
| No startup guard | FAIL | Server starts without error if JWT_SECRET is missing |
| Consistent access pattern | FAIL | `auth-service.ts` and `tenant.middleware.ts` use different patterns |
| Secret entropy requirement | NOT ENFORCED | No minimum length or complexity check |

**Verdict:** The JWT secret handling has three compounding failures: a weak fallback, no startup validation, and inconsistent access. In combination, these create a plausible path to token forgery in a misconfigured deployment.

---

### RLS Bypass -- FAIL

| Check | Status | Details |
|-------|--------|---------|
| Middleware sets RLS GUC | PASS | `SET app.tenant_id = '${payload.tenantId}'` on dedicated client |
| Routes use tenant-scoped client | FAIL | Zero usage of `req.dbClient` in any IAM route or repository |
| RLS enforced on writes | FAIL | `UPDATE iam.operators SET role` on line 119 uses `pool.query()` |
| RLS enforced on reads | FAIL | `findById()`, `findByTenantId()` use `this.pool.query()` |
| Application-level tenant check | PASS | All management routes verify `tenantId` match |
| RLS bypass documented (login) | PASS | `findByEmail()` comment explains intentional bypass |

**Verdict:** The RLS infrastructure is correctly set up at the PostgreSQL level, and the middleware correctly provisions a scoped client. But the application layer never uses that client, rendering the RLS protection effectively non-functional for IAM operations. Only application-level tenant checks (Layer 3) protect against cross-tenant access.

---

### SQL Injection via SET app.tenant_id -- LOW RISK

```typescript
// tenant.middleware.ts line 44
await client.query(`SET app.tenant_id = '${payload.tenantId}'`)
```

Uses string interpolation instead of parameterized query. As documented in Refinement EC-IAM-05, exploitation requires JWT secret compromise (to forge a token with a malicious tenantId), and the `::UUID` cast in the RLS policy would reject non-UUID values. Risk is LOW but the fix is trivial:

```typescript
await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', payload.tenantId])
```

---

### Password Hashing -- PASS

| Check | Status | Details |
|-------|--------|---------|
| bcrypt used | PASS | `bcryptjs` with `BCRYPT_ROUNDS = 12` |
| Cost factor appropriate | PASS | 12 rounds is ~200ms, good balance |
| Password not leaked in responses | PASS | All route handlers explicitly select fields, never return `passwordHash` |
| Generic error on wrong password | PASS | `"Invalid email or password"` for both not-found and wrong-password |
| Timing-safe comparison | PASS | `bcrypt.compare()` is constant-time by design |
| Min password length enforced | PASS | Zod schema enforces `min(8)` |

---

### API Key Encryption -- NOT IMPLEMENTED (expected)

`TenantSettings.crmIntegration.apiKeyEncrypted` is declared as a type but no encryption/decryption code exists in BC-05. This is expected -- encryption is BC-04's responsibility when accessing CRM credentials.

---

### Token Revocation -- NOT IMPLEMENTED

No JWT blocklist exists. A deactivated operator's token remains valid for up to 24 hours. The `GET /me` route returns the operator even with `status: 'DISABLED'`. No status check in the middleware prevents disabled operators from making authenticated requests.

**Severity:** HIGH for a security-critical feature. Documented as "deferred" but should be prioritized.

---

### RLS Policy Scope -- PARTIAL

The RLS policy on `iam.operators` uses only a `USING` clause, not a separate `WITH CHECK` clause for writes:

```sql
CREATE POLICY tenant_isolation_operators ON iam.operators
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

Without `WITH CHECK`, the `USING` clause applies to both reads and writes (default PostgreSQL behavior for `ALL` command). This means INSERT operations would also be checked -- but since `app.tenant_id` must match `tenant_id` for inserts to succeed, this could block legitimate cross-tenant operations like the registration flow. The registration flow avoids this by using a transaction client that does not have `app.tenant_id` set (since it occurs before the middleware).

**Assessment:** Acceptable for v1 but should be explicitly tested.

---

## 4. Test Coverage Review

### Unit Tests: 16 tests -- AuthService only

| Test | What it verifies | Status |
|------|------------------|--------|
| register: creates tenant + admin, returns token | Happy path | PASS |
| register: begins and commits transaction | Transaction discipline | PASS |
| register: rolls back on error | Atomicity guarantee | PASS |
| register: rejects short password | Zod validation | PASS |
| register: rejects invalid email | Zod validation | PASS |
| login: returns JWT on correct credentials | Happy path | PASS |
| login: fails with wrong password | Authentication | PASS |
| login: fails when operator not found | Authentication | PASS |
| JWT: contains correct claims | Token structure | PASS |
| JWT: expires in ~24h | Token lifetime | PASS |
| verifyToken: accepts valid token | Token verification | PASS |
| verifyToken: rejects tampered token | Token security | PASS |
| register token: has ADMIN role | First operator role | PASS |

**Missing test coverage:**

| Gap | Severity |
|-----|----------|
| Zero route-level tests (auth-routes.ts) | HIGH |
| Zero route-level tests (operator-routes.ts) | HIGH |
| No integration test for FF-03 RLS isolation | CRITICAL |
| No test for inviteOperator() | MEDIUM |
| No test for disabled operator login rejection | MEDIUM |
| No test for admin guard on POST /operators | MEDIUM |
| No test for self-demotion prevention | LOW |
| No test for self-deactivation prevention | LOW |
| No test for cross-tenant 404 response | LOW |
| No test for PresenceService | LOW |
| No test for TenantRepository | LOW |
| No test for OperatorRepository | LOW |

**Test quality assessment:** The existing 16 tests are well-structured with clean mock setup and proper `beforeEach`/`afterEach` for env cleanup. The mock pool factory is reusable. However, the test suite only covers the service layer. Zero route-level or middleware tests exist. The most critical gap is the absence of FF-03 integration tests, which the PRD marks as "blocks deploy."

---

## 5. Summary Scorecard

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| Architectural compliance | 4/10 | RLS bypass in all repository reads/writes is a fundamental violation of FF-03 and ADR-007. Cross-BC raw SQL to conversations.dialogs. |
| Code quality | 7/10 | Clean patterns (Result type, Zod, domain interfaces), but JWT secret inconsistency and pool.query everywhere undermine the architecture |
| Test coverage | 4/10 | 16 unit tests for AuthService are solid, but zero route tests, zero repository tests, zero integration tests, zero FF-03 tests |
| Security | 4/10 | JWT fallback secret, no startup guard, RLS effectively not enforced at app layer, no token revocation, disabled operators not blocked |
| Performance | 8/10 | bcrypt 12 rounds is appropriate, dedicated PoolClient per request avoids GUC leaks, Redis presence is efficient |
| Documentation | 9/10 | Excellent SPARC coverage. PRD, Specification, Architecture, Pseudocode, Refinement all thorough and consistent. Validation report accurately identifies issues. |

**Overall: 36/60 (60%) -- APPROVED WITH CONDITIONS**

---

## 6. Overall Verdict

IAM-01 has a **well-designed architecture on paper** that is **partially undermined by the implementation**. The three-layer isolation model (JWT + RLS + application check) is correctly specified in the SPARC documentation, but only Layer 1 (JWT) and Layer 3 (application check) are actually functional. Layer 2 (RLS) is configured at the database level but never exercised by the application because no IAM code uses the tenant-scoped `dbClient`.

### Blocking Issues (must fix before production)

1. **RLS bypass in operator-routes.ts** -- Replace `pool.query()` calls on lines 119, 196, 203 with `tenantReq.dbClient.query()`. This is a 3-line change with massive security impact.

2. **OperatorRepository does not use tenant-scoped client** -- Either refactor `findById()` and `findByTenantId()` to accept a `PoolClient` parameter, or pass `dbClient` from the request context. Without this, the RLS policy on `iam.operators` is decorative.

3. **JWT_SECRET inconsistency** -- Unify secret access between `auth-service.ts` (fallback to `'dev-secret-change-me'`) and `tenant.middleware.ts` (non-null assertion `!`). Add a startup guard that crashes the process if `JWT_SECRET` is not set or equals the dev fallback.

### High Priority (next sprint)

4. **Add FF-03 integration tests** -- The test structure is documented in Refinement section 3.2 but not implemented. At minimum: (a) tenant A cannot list tenant B operators, (b) direct UUID access to another tenant's operator returns empty.

5. **Add route-level tests** -- All 9 API endpoints in auth-routes.ts and operator-routes.ts need supertest coverage for HTTP status codes, admin guards, and error responses.

6. **Block disabled operators at middleware level** -- Either add an `isOperatorActive` check in tenant middleware, or implement short-lived tokens with refresh.

### Medium Priority

7. **Eliminate cross-BC SQL** -- `operator-routes.ts` should not query `conversations.dialogs` directly. Define a port interface.

8. **Parameterize SET app.tenant_id** -- Use `SELECT set_config($1, $2, false)` instead of string interpolation.

9. **Use PostgreSQL error code for duplicate detection** -- Replace `.includes('duplicate')` with `error.code === '23505'`.

10. **Add `updated_at` column to migration** -- The `Tenant` interface expects it but the column does not exist.

### Acknowledged Limitations (v1)

- No refresh token rotation (acceptable for v1 scale)
- No password reset flow (documented as deferred)
- Last admin demotion not prevented (edge case, low probability)
- bcrypt in main thread (acceptable for v1 concurrency levels)
- Presence not persistent across Redis restarts (acceptable)

---

**Bottom line:** The IAM feature delivers working authentication and authorization, but the RLS enforcement -- the feature's most critical security guarantee -- is architecturally present but operationally absent. The `dbClient` from tenant middleware is never consumed by any IAM code. Fixing this gap requires modest code changes (passing the client through to repository calls) but is non-negotiable for a system that claims "100% RLS isolation" as a fitness function.
