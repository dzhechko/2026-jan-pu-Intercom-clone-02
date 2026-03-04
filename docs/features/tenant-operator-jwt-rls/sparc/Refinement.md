# IAM-01: Refinement — Edge Cases, Security Risks, Testing Strategy

**Feature ID:** IAM-01
**BC:** BC-05 Identity & Access
**Date:** 2026-03-04

---

## 1. Edge Cases

### EC-IAM-01: Concurrent Registration with Same Email

**Scenario:** Two requests arrive simultaneously with the same email address.

**Risk:** Both pass the Zod validation, both attempt INSERT. PostgreSQL UNIQUE constraint on `iam.operators(tenant_id, email)` will reject one.

**Current behavior:** The second INSERT throws a constraint violation error. `AuthService.register()` catches it in the CATCH block, executes ROLLBACK, and returns `err(error)`. The HTTP response is `409 Conflict` (detected via `.includes('duplicate')` in the error message).

**Gap:** The error message check `.includes('duplicate')` is brittle. If PostgreSQL error text changes between versions, the response code degrades to `400` instead of `409`. This is a v1 simplification acceptable for the milestone.

**Resolution (future):** Check `error.code === '23505'` (PostgreSQL unique violation code) instead of string matching.

---

### EC-IAM-02: JWT Secret Not Set in Production

**Scenario:** `JWT_SECRET` env var missing in production Docker container.

**Current behavior:** `getJwtSecret()` returns `'dev-secret-change-me'` as fallback. Tokens are signed with this weak, publicly-known secret.

**Risk:** CRITICAL — any attacker who knows the fallback can forge tokens for any tenant.

**Mitigation:** The `JWT_SECRET` env var must be enforced in the Docker Compose and deployment process. A startup health check should verify `JWT_SECRET` is set and meets minimum entropy requirements.

**Verification:** `migrations/` include startup checks. Add `if (!process.env.JWT_SECRET) throw new Error(...)` to server startup.

---

### EC-IAM-03: PoolClient Not Released on Route Error

**Scenario:** Route handler throws an uncaught exception before `res.end()` is called.

**Analysis:** The middleware registers `res.on('close', () => client.release())`. The `close` event fires when the underlying socket closes — which happens when Express's default error handler sends a 500 response and ends the connection.

**Verified safe:** Express default error handler calls `res.end()` → socket closes → `close` event fires → `client.release()`. No pool exhaustion.

**Residual risk:** If `res.on('close')` fires before `client.release()` completes and another request reuses the same connection, the `app.tenant_id` GUC from the previous request could leak. This is mitigated by `client.release()` returning the connection to the pool — `pg` resets the connection state on release by default.

---

### EC-IAM-04: Operator Disabled After Token Issuance

**Scenario:** Admin deactivates operator at 10:00. Operator has a valid token (not yet expired). Operator makes a request at 10:05 with the same token.

**Current behavior:** The tenant middleware verifies the JWT signature (valid) and sets `app.tenant_id`. The route handler calls `findById(operatorId)`. The query returns the operator row (id matches, but RLS passes because tenantId matches). The operator's `status` is `DISABLED`.

**Gap:** The `GET /api/auth/me` handler returns the operator even if DISABLED. Protected routes do NOT re-check operator status after JWT validation.

**Resolution (future):** Add an `isOperatorActive` check in the tenant middleware, or use short-lived tokens (e.g., 15 min) with refresh tokens. For v1, the 24-hour token window is acceptable.

---

### EC-IAM-05: RLS GUC Injection via tenantId

**Scenario:** Attacker crafts a JWT with `tenantId = "'; DROP TABLE iam.tenants; --"`.

**Analysis:**
```typescript
await client.query(`SET app.tenant_id = '${payload.tenantId}'`)
```
This uses template string interpolation — the tenantId from JWT payload is embedded directly.

**Risk:** If `payload.tenantId` contains single-quote characters, the SET statement could be malformed. However:
1. `jwt.verify()` only succeeds if the token was signed with the valid `JWT_SECRET` — an attacker without the secret cannot forge a JWT with a malicious tenantId
2. `SET app.tenant_id` accepts a string value — the PostgreSQL parser would reject non-UUID values when the RLS policy casts via `::UUID`

**Risk Level:** LOW (requires JWT secret compromise to exploit), but should be parameterized in future:
```typescript
// Future: Use parameterized SET
await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', payload.tenantId])
```

---

### EC-IAM-06: Email Case Sensitivity

**Current behavior:** `email.toLowerCase().trim()` applied in `OperatorRepository.create()` and `findByEmail()`.

**Gap:** If an operator registers with `Admin@ACME.com`, it is stored as `admin@acme.com`. Login with `ADMIN@acme.com` normalizes and finds the record. This is correct.

**Potential issue:** The UNIQUE constraint is `UNIQUE(tenant_id, email)`. If PostgreSQL's case-sensitive comparison and the application's normalization ever diverge, a duplicate could slip through.

**Mitigation:** The DB-level email column should have a `CITEXT` type or a functional index `LOWER(email)`. V1 relies on application-level normalization.

---

### EC-IAM-07: Last Admin Demotion

**Scenario:** Tenant has 1 ADMIN. Admin changes their own role to OPERATOR (or admin tries to demote themselves).

**Current behavior:** The route handler checks:
```typescript
if (req.params.id === tenantReq.operatorId && parsed.data.role !== 'ADMIN') {
  return res.status(400).json({ error: 'Cannot change your own role' })
}
```
Self-demotion is blocked. But one ADMIN can demote another ADMIN if there are two.

**Gap:** If the last ADMIN demotes another ADMIN, the tenant has zero admins. No business rule prevents this in v1.

**Resolution (future):** Count ADMIN operators before allowing demotion: `SELECT COUNT(*) FROM iam.operators WHERE tenant_id = $1 AND role = 'ADMIN' AND status = 'ACTIVE'`. Block if count would reach 0.

---

## 2. Security Risks

### SR-01: bcrypt Cost Factor

**Current:** 12 rounds (configured in `auth-service.ts` as `BCRYPT_ROUNDS = 12`)

**Performance:** ~200ms on modern CPU (Intel Xeon E5 class) — acceptable for login/registration.

**Risk:** Under heavy load (concurrent logins), bcrypt computation blocks the Node.js event loop. At 100 concurrent logins with 200ms each = 20s total CPU time = DoS potential.

**Mitigation (future):** Move bcrypt operations to a worker thread pool (`worker_threads`). For v1 load (tens of users), not a concern.

---

### SR-02: JWT Secret Entropy

**Requirement:** `JWT_SECRET` must be at minimum 256 bits of random entropy.

**Generation command:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Never use:**
- Passwords as JWT secrets
- Predictable strings
- The default `'dev-secret-change-me'` in production

---

### SR-03: Token Revocation

**Current state:** No token revocation. Tokens are valid until expiry (24h).

**Implications:**
- Deactivated operator tokens remain valid for up to 24h
- Compromised tokens cannot be invalidated immediately

**Mitigation (future):** Redis-based JWT blocklist. On operator deactivation or logout, add `tokenJti` to a Redis SET with TTL = remaining token lifetime.

---

### SR-04: Password Storage

**Current:** `bcryptjs` with 12 rounds. `bcryptjs` is the JavaScript implementation — slower than native `bcrypt` but requires no native compilation (simplifies Docker builds).

**Alternative (future):** `argon2id` (winner of Password Hashing Competition). Provides better memory-hardness than bcrypt. Node.js `argon2` library uses native bindings.

---

## 3. Testing Strategy

### 3.1 Unit Tests (Existing — 16 tests)

**File:** `src/iam/application/services/auth-service.test.ts`

All tests use mocked `pg.Pool` — no real DB connection required:

| Suite | Tests | Assertions |
|-------|-------|-----------|
| `register()` | 5 | Transaction (BEGIN/COMMIT/ROLLBACK), atomicity, validation rejection |
| `login()` | 3 | Correct credentials, wrong password, unknown email |
| `JWT payload` | 5 | All claims present, 24h expiry, verifyToken happy/sad path |
| `register() → token` | 1 | tenantId + ADMIN role in registered token |
| (inviteOperator) | 2 | In routes, checked via integration tests |

**Coverage target:** All AuthService methods 100% line coverage.

### 3.2 Integration Tests Required (FF-03)

**Critical (blocks deploy):**

```typescript
describe('RLS Isolation (FF-03)', () => {
  it('tenant A cannot see tenant B operators', async () => {
    // Setup: create two tenants with operators
    const tenantA = await createTestTenant('Tenant A')
    const tenantB = await createTestTenant('Tenant B')

    // Authenticate as Tenant A
    const tokenA = await loginAs(tenantA.adminEmail, tenantA.adminPassword)

    // Try to access Tenant B's operators
    const response = await request(app)
      .get('/api/operators')
      .set('Authorization', `Bearer ${tokenA}`)

    // Should only see Tenant A's operators
    const operatorIds = response.body.operators.map(op => op.id)
    expect(operatorIds).not.toContain(tenantB.operatorId)
  })

  it('direct UUID access to other tenant operator returns 404', async () => {
    const tokenA = await loginAs(tenantA.adminEmail, tenantA.adminPassword)

    const response = await request(app)
      .get(`/api/operators/${tenantB.operatorId}/stats`)
      .set('Authorization', `Bearer ${tokenA}`)

    expect(response.status).toBe(404)
  })
})
```

### 3.3 BDD Scenario (from test-scenarios.feature)

```gherkin
Feature: Multi-tenancy RLS isolation

  Scenario: Row-Level Security prevents cross-tenant data access
    Given тенант A зарегистрирован с 2 операторами
    And тенант B зарегистрирован с 3 операторами
    When API запрос GET /api/operators выполняется с JWT тенанта A
    Then в ответе только 2 оператора (тенанта A)
    And операторы тенанта B отсутствуют в ответе
    And PostgreSQL RLS автоматически фильтрует строки по tenant_id

  Scenario: Неверный пароль не раскрывает информацию о существовании email
    Given оператор существует с email "admin@acme.com"
    When POST /api/auth/login с email "admin@acme.com" и неверным паролем
    Then ответ 401 с сообщением "Invalid email or password"
    When POST /api/auth/login с несуществующим email "ghost@acme.com"
    Then ответ 401 с тем же сообщением "Invalid email or password"
```

### 3.4 Testing Patterns

**Mock Pool pattern** (from auth-service.test.ts):
```typescript
function createMockPool(overrides?): Pool {
  const mockClient = {
    query: jest.fn().mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
      if (sql.includes('INSERT INTO iam.tenants')) return { rows: [makeFakeTenantRow()] }
      if (sql.includes('INSERT INTO iam.operators')) return { rows: [await makeFakeOperatorRow()] }
      return { rows: [] }
    }),
    release: jest.fn(),
  }
  return {
    connect: jest.fn().mockResolvedValue(mockClient),
    query: jest.fn().mockImplementation(async (sql) => {
      if (sql.includes('FROM iam.operators WHERE email')) { ... }
    })
  } as unknown as Pool
}
```

Key technique: `process.env.JWT_SECRET` is set in `beforeEach` and deleted in `afterEach`, allowing the `getJwtSecret()` read-at-call-time pattern to work correctly in tests.

---

## 4. Known Limitations (v1)

| Limitation | Impact | Priority |
|-----------|--------|---------|
| No refresh token mechanism | Tokens valid up to 24h after revocation | LOW (v1) |
| No password reset flow | Invited operators must use temp passwords | MEDIUM |
| Last admin demotion possible (by another admin) | Tenant can lose all admins | LOW |
| bcrypt in main thread | DoS potential at high concurrency | LOW (v1 scale) |
| Duplicate email check uses string match | Could degrade to 400 vs 409 | LOW |
| SET app.tenant_id interpolated (not parameterized) | Requires JWT secret to exploit | LOW |
| Presence not persistent (Redis volatile) | Restart clears presence state | LOW (acceptable) |

---

## 5. Monitoring and Observability

### 5.1 Logs (v1)

All route handlers log errors with prefix:
```typescript
console.error('[auth-routes] register error', err)
console.error('[operator-routes] listOperators error', err)
```

### 5.2 Metrics (future)

| Metric | Description |
|--------|-------------|
| `iam_login_total{result="success|failure"}` | Login attempts counter |
| `iam_token_verification_duration_ms` | JWT verify latency histogram |
| `iam_bcrypt_duration_ms` | bcrypt hash/compare latency |
| `iam_rls_bypass_total` | Count of intentional RLS bypasses (login flow) |

### 5.3 Alerting (future)

| Alert | Threshold | Severity |
|-------|-----------|---------|
| Login failure rate | > 20/min per tenant | WARN |
| Login failure rate | > 100/min global | CRIT |
| JWT verify errors | > 50/min | WARN |
| Pool exhaustion | < 2 available connections | CRIT |
