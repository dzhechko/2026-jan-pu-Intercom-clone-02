# Validation Report — IAM-01 Tenant + Operator + JWT + RLS

## Summary
- **Overall Score:** 78/100
- **Status:** PASSED (with critical gaps requiring attention)
- **Date:** 2026-03-04
- **Validator:** Requirements Validator (automated analysis)

---

## INVEST Criteria Assessment

| Criterion | Score (1-10) | Notes |
|-----------|:------------:|-------|
| Independent | 9 | IAM-01 has no upstream dependencies. It is the foundational layer that unblocks all other BCs. Clean boundary. |
| Negotiable | 7 | Core requirements (JWT, RLS, multi-tenancy) are non-negotiable for security. Deferred items (refresh tokens, password reset, OAuth2) are clearly documented and reasonable for v1. |
| Valuable | 10 | Without IAM, every other feature is a security liability. Directly enables FF-03 (tenant isolation), which is CRITICAL and blocks deploy. |
| Estimable | 8 | Well-scoped with clear domain model, API surface, and pseudocode. 11 implementation files + 1 migration + 16 unit tests. Complexity is manageable. |
| Small | 7 | Feature covers registration, login, JWT, RLS, operator CRUD, presence tracking, and role management. This is a large surface area for a single feature, though it is justified as a foundational layer. |
| Testable | 8 | 16 unit tests with mocked Pool. BDD scenarios defined. Integration test structure documented but not yet implemented. Testability pattern (JWT_SECRET at call time) is well-designed. |

**INVEST Total: 49/60**

---

## Requirements Completeness

| Requirement | Defined | Testable | Implemented | Notes |
|-------------|:-------:|:--------:|:-----------:|-------|
| FR-IAM-01: POST /api/auth/register (atomic) | YES | YES | YES | Transaction with BEGIN/COMMIT/ROLLBACK verified in code and tests |
| FR-IAM-02: POST /api/auth/login (JWT issuance) | YES | YES | YES | Generic error messages prevent email enumeration |
| FR-IAM-03: GET /api/auth/me (profile) | YES | YES | YES | Returns operator profile with status and createdAt |
| FR-IAM-04: POST /api/auth/operators (admin invite) | YES | YES | YES | Admin guard + duplicate email check implemented |
| FR-IAM-05: Tenant middleware (JWT + RLS GUC) | YES | YES | YES | Dedicated PoolClient per request, SET app.tenant_id, release on res.close |
| FR-IAM-06: bcrypt 12 rounds | YES | YES | YES | BCRYPT_ROUNDS = 12 constant in auth-service.ts |
| FR-IAM-07: Zod validation on all inputs | YES | YES | YES | RegisterSchema, LoginSchema, InviteOperatorSchema, UpdateRoleSchema all present |
| FR-IAM-08: Operator management (list, role change, deactivate) | YES | YES | YES | All endpoints in operator-routes.ts with admin guards |
| FR-IAM-09: Presence tracking (Redis) | YES | YES | YES | PresenceService with SADD/SREM/SMEMBERS pattern |
| FR-IAM-10: Operator stats | YES | YES | PARTIAL | Stats endpoint exists but queries use pool.query() directly, bypassing RLS |
| RLS policy on iam.operators | YES | YES | YES | Migration 002 creates policy with tenant_id = current_setting('app.tenant_id')::UUID |
| iam.tenants has NO RLS | YES | YES | YES | Intentional design — cross-tenant lookup table |
| Password not leaked in API responses | YES | YES | YES | All route handlers explicitly select fields, never return passwordHash |
| 24-hour JWT expiry | YES | YES | YES | TOKEN_EXPIRES_IN = '24h', verified in unit test with exp-iat check |
| Self-demotion prevention | YES | YES | YES | Checked in operator-routes.ts updateRole handler |
| Self-deactivation prevention | YES | YES | YES | Checked in operator-routes.ts deactivateOperator handler |
| Cross-tenant access returns 404 (not 403) | YES | YES | YES | Prevents tenant enumeration in operator-routes.ts |
| Soft delete (DISABLED status) | YES | YES | YES | updateStatus sets DISABLED, findByEmail filters out DISABLED |
| Result<T, E> pattern | YES | YES | YES | All service/repository methods return Result type |

---

## Security-Specific Validation

### RLS Policies Coverage

| Aspect | Status | Details |
|--------|--------|---------|
| RLS enabled on iam.operators | PASS | Migration 002: `ALTER TABLE iam.operators ENABLE ROW LEVEL SECURITY` |
| RLS policy uses current_setting GUC | PASS | `tenant_id = current_setting('app.tenant_id')::UUID` |
| Middleware sets GUC before any query | PASS | `tenant.middleware.ts` line 44: `SET app.tenant_id = '${payload.tenantId}'` |
| Dedicated PoolClient per request | PASS | `pool.connect()` acquires dedicated client, not `pool.query()` |
| Client released on response close | PASS | `res.on('close', () => client.release())` |
| iam.tenants intentionally excluded from RLS | PASS | Documented design decision — cross-tenant lookup |

**CRITICAL FINDING: RLS Bypass in operator-routes.ts**

The `operator-routes.ts` file uses `pool.query()` directly in three places (lines 119, 196, 203) instead of `req.dbClient` (the tenant-scoped client). This means:

1. **Line 119 (updateRole):** `pool.query('UPDATE iam.operators SET role = $1 WHERE id = $2', ...)` -- This UPDATE bypasses RLS. While there is an application-level tenant check above it, the defense-in-depth principle (Layer 2: RLS) is not enforced for this write operation.

2. **Lines 196-203 (getOperatorStats):** Queries to `conversations.dialogs` use `pool.query()` directly. If `conversations.dialogs` has RLS enabled, these queries would fail or return incorrect results because `app.tenant_id` is not set on the pool connection.

**Recommendation:** Replace all `pool.query(...)` calls in `operator-routes.ts` with `tenantReq.dbClient.query(...)` to ensure RLS is enforced at the database layer for all operations.

### JWT Token Validation

| Aspect | Status | Details |
|--------|--------|---------|
| HS256 algorithm | PASS | Default for jsonwebtoken library |
| JWT_SECRET from env var | PASS | `getJwtSecret()` reads at call time |
| 24-hour expiry | PASS | `expiresIn: '24h'` |
| Payload contains tenantId, operatorId, role, email | PASS | Verified in unit tests |
| Invalid/expired token returns 401 | PASS | Middleware catch block returns 401 |
| Missing Authorization header returns 401 | PASS | Check before JWT verification |
| Generic auth error messages (no email enumeration) | PASS | Both "not found" and "wrong password" return identical message |

**WARNING: JWT Secret Fallback**

`getJwtSecret()` falls back to `'dev-secret-change-me'` if `JWT_SECRET` is not set. This is a CRITICAL security risk in production. The Refinement document (EC-IAM-02) acknowledges this but no startup guard exists in the codebase to prevent deployment with the default secret.

### Tenant Isolation Verification

| Layer | Status | Details |
|-------|--------|---------|
| Layer 1: JWT verification | PASS | Tenant middleware verifies JWT before any DB access |
| Layer 2: PostgreSQL RLS | PARTIAL | RLS policy exists but some queries bypass it (see above) |
| Layer 3: Application-level tenant check | PASS | operator-routes.ts checks `operatorResult.value.tenantId !== tenantReq.tenantId` |

### API Key Encryption

| Aspect | Status | Details |
|--------|--------|---------|
| TenantSettings.crmIntegration.apiKeyEncrypted | DEFINED | Interface declares `apiKeyEncrypted: string` |
| AES-256-GCM encryption implementation | NOT IMPLEMENTED | No encryption/decryption code found in IAM BC. This is expected -- encryption is handled in BC-04 Integration when MCP adapters access CRM credentials. |

### SQL Injection Risk (SET app.tenant_id)

The middleware uses string interpolation for the SET command:
```typescript
await client.query(`SET app.tenant_id = '${payload.tenantId}'`)
```

As documented in Refinement EC-IAM-05, this is LOW risk because:
1. JWT must be signed with valid secret to contain a malicious tenantId
2. PostgreSQL `::UUID` cast would reject non-UUID values

However, the parameterized alternative (`SELECT set_config($1, $2, false)`) is recommended for defense-in-depth.

---

## BDD Scenarios Coverage

| Scenario | Specified | Tested (Unit) | Tested (Integration) |
|----------|:---------:|:-------------:|:--------------------:|
| Tenant registration creates tenant + admin atomically | YES | YES (3 tests) | NO |
| Login with valid credentials returns JWT | YES | YES (1 test) | NO |
| Login with wrong password returns generic 401 | YES | YES (1 test) | NO |
| Login with unknown email returns same generic 401 | YES | YES (1 test) | NO |
| JWT contains tenantId, operatorId, role, email | YES | YES (1 test) | NO |
| JWT expires in 24 hours | YES | YES (1 test) | NO |
| verifyToken accepts valid token | YES | YES (1 test) | NO |
| verifyToken rejects tampered token | YES | YES (1 test) | NO |
| register() token has ADMIN role | YES | YES (1 test) | NO |
| Validation rejects short password | YES | YES (1 test) | NO |
| Validation rejects invalid email | YES | YES (1 test) | NO |
| Transaction rolls back on failure | YES | YES (1 test) | NO |
| RLS: tenant A cannot see tenant B operators | YES | NO | NO |
| RLS: direct UUID access to other tenant returns empty | YES | NO | NO |
| Admin can invite operators | YES | NO (route-level) | NO |
| Non-admin cannot invite operators (403) | YES | NO (route-level) | NO |
| Duplicate email returns 409 | YES | NO (route-level) | NO |
| Self-demotion blocked | YES | NO (route-level) | NO |
| Self-deactivation blocked | YES | NO (route-level) | NO |
| Disabled operator cannot login | YES | NO | NO |

**Gap:** 16 unit tests cover AuthService logic well, but there are zero integration tests and zero route-level tests. The most critical gap is the absence of FF-03 RLS isolation integration tests, which the specification marks as "blocks deploy."

---

## Risks & Gaps

### CRITICAL

1. **RLS bypass in operator-routes.ts** -- Three `pool.query()` calls bypass the tenant-scoped `dbClient`, undermining defense-in-depth. The `UPDATE iam.operators SET role` on line 119 is particularly concerning because it modifies data without RLS enforcement.

2. **No integration tests for FF-03** -- RLS tenant isolation is marked as CRITICAL (blocks deploy) in fitness functions, but zero integration tests verify it. The Refinement document provides test structure but it has not been implemented.

3. **JWT_SECRET fallback to dev secret** -- No startup guard prevents production deployment with the weak default `'dev-secret-change-me'` secret.

### HIGH

4. **Disabled operator tokens remain valid** -- No mechanism to revoke tokens after operator deactivation (EC-IAM-04). Documented as known limitation, but for a security-critical feature, this should be addressed sooner.

5. **No route-level tests** -- Auth routes and operator routes have zero test coverage. All 16 tests are at the service level. Route-level behavior (HTTP status codes, admin guards, error handling) is untested.

6. **Last admin demotion not prevented** -- One ADMIN can demote another ADMIN, potentially leaving a tenant with zero admins (EC-IAM-07).

### MEDIUM

7. **String-based duplicate detection** -- `result.error.message.includes('duplicate')` for 409 status is brittle (EC-IAM-01). Should use PostgreSQL error code `23505`.

8. **SET app.tenant_id uses string interpolation** -- Should use parameterized `set_config()` for defense-in-depth (EC-IAM-05).

9. **Email uniqueness relies on application normalization** -- No DB-level CITEXT or functional index `LOWER(email)` (EC-IAM-06).

10. **Invited operator status** -- PRD specifies status=INVITED for invited operators, but implementation sets status=ACTIVE with a temp password. Documented as v1 simplification but creates UX gap.

### LOW

11. **bcrypt in main thread** -- Could cause event loop blocking under high concurrent login load (SR-01).

12. **Presence not persistent** -- Redis restart clears all presence state. Acceptable for v1.

---

## Recommendations

### Immediate (before next milestone)

1. **Fix RLS bypass in operator-routes.ts** -- Replace all `pool.query()` calls with `tenantReq.dbClient.query()`. This is a 3-line change that significantly improves security posture.

2. **Add startup guard for JWT_SECRET** -- Add to server startup:
   ```typescript
   if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me') {
     throw new Error('JWT_SECRET must be set to a secure value in production')
   }
   ```

3. **Implement FF-03 integration tests** -- The test structure is already documented in Refinement section 3.2. Implement at least the two critical scenarios: cross-tenant listing and direct UUID access.

### Short-term (next sprint)

4. **Add route-level tests** -- Test HTTP status codes, admin guards, and error responses for auth-routes.ts and operator-routes.ts using supertest.

5. **Use parameterized SET** -- Replace string interpolation with `SELECT set_config($1, $2, false)` in tenant.middleware.ts.

6. **Use PostgreSQL error code for duplicate detection** -- Replace `.includes('duplicate')` with `error.code === '23505'`.

### Medium-term (v2)

7. **Implement token revocation** -- Redis-based JWT blocklist for immediate invalidation on operator deactivation.

8. **Add last-admin prevention** -- Count active ADMINs before allowing demotion.

9. **Add CITEXT or functional index** -- Ensure email uniqueness at the DB level regardless of case.

10. **Move bcrypt to worker threads** -- Prevent event loop blocking under load.

---

## Score Breakdown

| Category | Max | Score | Notes |
|----------|:---:|:-----:|-------|
| SPARC Documentation Quality | 20 | 19 | Excellent coverage: PRD, Spec, Architecture, Pseudocode, Refinement, Final Summary. All consistent and thorough. |
| Requirements Completeness | 20 | 17 | All FR-IAM-01 through FR-IAM-10 defined and mostly implemented. Minor gaps in INVITED status and stats RLS. |
| Security Design | 25 | 18 | Three-layer isolation well-designed. RLS bypass in routes is a significant gap. JWT fallback secret is concerning. |
| Test Coverage | 20 | 12 | 16 unit tests are solid but zero integration/route tests. FF-03 critical test missing. |
| Implementation Fidelity | 15 | 12 | Code closely follows pseudocode and spec. Pool.query bypass and a few edge cases reduce score. |
| **Total** | **100** | **78** | |
