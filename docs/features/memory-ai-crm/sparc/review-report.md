# Architecture Compliance Review: FR-03 Memory AI — CRM Context

**Feature ID:** FR-03
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** APPROVED with 1 HIGH severity issue requiring fix

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — PASS

Verified imports across all FR-03 files:

- `memory-ai-service.ts` imports only from `@pql/domain/ports/crm-port` (own BC domain port). No imports from `src/integration/`.
- `memory-ai-routes.ts` imports from `@pql/application/services/memory-ai-service` (own BC) and `@shared/middleware/tenant.middleware` (shared kernel). Clean.
- `amocrm-mcp-adapter.ts` imports from `@pql/domain/ports/crm-port` (to implement the interface) and `@shared/types/result`. This is the correct dependency direction per DIP: the adapter in BC-04 imports the interface owned by BC-02.

The composition root in `server.ts` (line 155-157) wires the adapter to the service. No domain code ever references the concrete adapter class.

**Verdict:** Textbook hexagonal architecture. The CRMPort interface in BC-02 domain/ports is the seam, and BC-04 implements it without any reverse coupling.

---

### FF-03: Tenant RLS Isolation — FAIL (HIGH)

The tenant middleware (`createTenantMiddleware` at `server.ts:128`) correctly:
1. Verifies JWT and extracts `tenantId`
2. Acquires a dedicated `PoolClient`
3. Runs `SET app.tenant_id` on that client
4. Attaches the client as `req.dbClient`

**However, `memory-ai-routes.ts` does NOT use `req.dbClient`.** It uses `pool.query()` directly:

```typescript
// memory-ai-routes.ts line 60-63
const { rows } = await pool.query(
  'SELECT contact_email FROM conversations.dialogs WHERE id = $1 AND tenant_id = $2',
  [dialogId, tenantId],
)
```

`pool.query()` checks out a fresh connection from the pool that does NOT have `SET app.tenant_id` applied. This means the RLS policy is NOT active for this query.

**Mitigating factor:** The query includes `AND tenant_id = $2` as a WHERE clause parameter, providing defense-in-depth. So in practice, cross-tenant data leakage does not occur. But this violates the project's ADR-007 rule: "NEVER pass tenant_id as WHERE clause filter -- RLS handles it."

**Severity:** HIGH. The code works correctly by accident (the WHERE clause saves it), but the architectural contract is violated. If someone removes the WHERE clause trusting RLS to handle it, data leaks.

**Fix:** Change `pool.query(...)` to `(req as TenantRequest).dbClient.query(...)` in both route handlers. Remove `tenant_id = $2` from the WHERE clause and rely on RLS as ADR-007 requires.

---

### FF-04: Circuit Breaker on MCP Adapter — PASS

The `AmoCRMMCPAdapter` constructor (line 18-28) configures opossum correctly:

```typescript
this.breaker = new CircuitBreaker(this.callMCP.bind(this), {
  timeout: 2000,                 // 2s per MCP call
  errorThresholdPercentage: 50,  // open after 50% errors
  resetTimeout: 30000,           // retry after 30s
  rollingCountTimeout: 10000,    // 10s rolling window
})

this.breaker.fallback(() => ({
  ok: false,
  error: new Error('amoCRM MCP circuit open — unavailable'),
}))
```

Additionally, `callMCP()` (line 224-237) applies a second timeout via `AbortSignal.timeout(2000)` on the fetch call. This dual-timeout strategy is robust: opossum handles the circuit state machine, while AbortSignal ensures the HTTP connection is actually killed at the Node.js level.

All four CRMPort methods (`getContactContext`, `getContactContextEnriched`, `createDeal`, `findDealByDialogContext`) route through `this.breaker.fire()`. No MCP call bypasses the circuit breaker.

**Verdict:** Fully compliant with FF-04. The circuit breaker configuration matches the spec exactly.

---

### ADR-002: MCP as Integration Layer — PASS

Domain code (`MemoryAIService`) never calls amoCRM directly. It calls `CRMPort.getContactContextEnriched()`, which is an interface. The concrete `AmoCRMMCPAdapter` translates between MCP protocol and domain types via the ACL methods `translateToEnrichedContext()` and `generateMockContext()`.

The adapter is instantiated and injected in the composition root (`server.ts:155-156`), not in any BC domain or application code.

**Verdict:** Fully compliant. MCP calls are properly encapsulated behind the port interface.

---

### ADR-007: JWT + RLS — PARTIAL FAIL

See FF-03 above. The tenant middleware sets RLS correctly, but the memory-ai routes bypass it by using `pool.query()` instead of `req.dbClient`. The WHERE clause provides functional correctness but violates the architectural decision.

---

## 2. Code Quality Review

### Strengths

1. **Clean hexagonal architecture.** The `CRMPort` interface is defined in `src/pql/domain/ports/crm-port.ts` with four methods. `MemoryAIService` depends only on this interface. The adapter in BC-04 implements it. This is the most cleanly separated cross-BC dependency in the entire codebase.

2. **CRMResult discriminated union.** The three-state result type (`ok | not_configured | error`) elegantly handles the real-world scenario where a tenant may not have CRM configured at all. This prevents the service from treating "no CRM" as an error, avoiding false alerts and unnecessary circuit breaker trips.

3. **Robust graceful degradation.** Every failure path in `MemoryAIService.fetchContext()` returns a valid `CRMResult.ok(emptyContext)` instead of throwing. The adapter falls back to deterministic mock data. Redis failures are silently swallowed. The feature literally cannot crash the application.

4. **Deterministic mock data.** `generateMockContext()` uses an email hash to produce consistent mock data. This means the same contact always sees the same mock context across page refreshes, which avoids confusing operators during development/demo phases.

5. **Cache key includes tenantId.** The format `memory-ai:context:{tenantId}:{email}` ensures zero cross-tenant leakage in the Redis cache. Email is lowercased for normalization.

6. **Comprehensive test suite.** 11 unit tests covering: successful fetch, empty email guard, not_configured pass-through, caching with TTL verification, cache hit avoiding CRM call, cache invalidation, Redis-null mode, adapter throws, CRM error status, and enrichment score boundaries.

---

### Issues Found

#### Issue 1: Routes use `pool.query()` instead of `req.dbClient` — RLS bypassed (HIGH)

```typescript
// memory-ai-routes.ts line 60-63
const { rows } = await pool.query(
  'SELECT contact_email FROM conversations.dialogs WHERE id = $1 AND tenant_id = $2',
  [dialogId, tenantId],
)
```

The tenant middleware acquires a dedicated `PoolClient` with `SET app.tenant_id` and attaches it as `req.dbClient`. This route ignores it and uses the shared pool, which has no RLS context set. The explicit `WHERE tenant_id = $2` prevents actual data leakage, but this contradicts ADR-007.

**Fix:** Replace `pool.query(...)` with `(req as TenantRequest).dbClient.query(...)`. Remove the `AND tenant_id = $2` clause, or keep it as defense-in-depth (but document the deviation from ADR-007).

---

#### Issue 2: No Zod validation on route parameters (MEDIUM)

The `/:dialogId` and `/contact/:email` routes accept user-provided params without Zod validation:

```typescript
const { dialogId } = req.params  // could be anything
const { email } = req.params     // could be anything
```

Per coding-style rules: "Use `zod` for all API input validation." The `dialogId` should be validated as a UUID pattern. The `email` should be validated as a valid email format.

**Risk:** Without validation, a malformed dialogId like `'; DROP TABLE--` gets passed to a parameterized query (safe from SQL injection) but wastes a DB round-trip. A garbage email gets passed to the CRM adapter, wasting an MCP call.

**Fix:** Add Zod schemas:
```typescript
const dialogIdSchema = z.object({ dialogId: z.string().uuid() })
const emailSchema = z.object({ email: z.string().email() })
```

---

#### Issue 3: Environment variable name discrepancy (MEDIUM)

The SPARC Specification (section 6) documents:
```
AMOCRM_MCP_BASE_URL — amoCRM MCP server URL
```

The actual code in `server.ts:155` uses:
```typescript
process.env.AMOCRM_MCP_URL || ''
```

And `.env.example:28` confirms:
```
AMOCRM_MCP_URL=https://amocrm-mcp.cloud.ru
```

The docs say `AMOCRM_MCP_BASE_URL`, the code uses `AMOCRM_MCP_URL`. Anyone following the documentation to configure the system will set the wrong variable.

**Fix:** Update the Specification.md and Final_Summary.md to reference `AMOCRM_MCP_URL`, matching the actual code.

---

#### Issue 4: `as any` usage in adapter (LOW)

The `AmoCRMMCPAdapter` uses `as Result<any>` in four locations (lines 36, 77, 101, 133) and `as any` in the `translateToEnrichedContext` method parameters. While some `any` usage is inevitable when dealing with untyped MCP responses, the coding style rules state: "FORBIDDEN: `any`, `as any` without justification comment."

Two of the `as any` casts lack justification comments. The raw MCP response type could be defined as a loose interface (e.g., `AmoCRMRawResponse`) to add at least some structure.

**Fix:** Add justification comments to the remaining `as any` casts, or define a minimal `AmoCRMRawResponse` interface.

---

#### Issue 5: No unit tests for AmoCRMMCPAdapter (MEDIUM)

There are 11 comprehensive tests for `MemoryAIService`, but zero tests for `AmoCRMMCPAdapter`. The adapter contains significant logic:

- Circuit breaker configuration and fallback behavior
- ACL translation (`translateToEnrichedContext`) with field mapping, enrichment score calculation, date conversion
- Mock context generation (`generateMockContext`)
- `mapDealStatus` with magic numbers (142, 143)

The ACL translation is a pure function that should have unit tests verifying:
- Correct enrichment score computation for various field combinations
- Correct status mapping (142 -> WON, 143 -> LOST, others -> OPEN)
- Handling of missing/null fields in raw amoCRM response
- Date conversion from Unix timestamps to days/ISO strings

**Risk:** Any change to the amoCRM API response format could silently break the translation without test detection.

**Fix:** Add unit tests for `translateToEnrichedContext`, `generateMockContext`, and `mapDealStatus`. These are pure functions that can be tested without mocking the circuit breaker.

---

#### Issue 6: SQL injection risk in tenant middleware (LOW)

```typescript
// tenant.middleware.ts line 44
await client.query(`SET app.tenant_id = '${payload.tenantId}'`)
```

The `tenantId` from the JWT payload is interpolated directly into a SQL string without parameterization. While JWT verification with the secret key means an attacker cannot forge arbitrary `tenantId` values, a compromised or misconfigured JWT secret could allow SQL injection via a crafted `tenantId`.

**Note:** This is not specific to FR-03 but affects all routes using the tenant middleware. Flagged here because FR-03 relies on this middleware for tenant isolation.

**Fix:** Use parameterized SET: `await client.query("SET app.tenant_id = $1", [payload.tenantId])` -- or validate the format of `tenantId` (UUID) before interpolation.

---

#### Issue 7: Mock enrichmentScore is always 0.85 (LOW)

`generateMockContext()` hardcodes `enrichmentScore: 0.85` regardless of which mock fields are actually populated. In the real `translateToEnrichedContext()`, the score is dynamically computed from field presence. This inconsistency means:

1. Downstream code that branches on enrichmentScore (e.g., PQL context boost checks `enrichmentScore < 0.3`) will always take the "data available" path when using mock data.
2. Testing the "low enrichment" code path requires explicitly mocking it.

**Fix:** Compute enrichmentScore dynamically in the mock function using the same formula as the real ACL.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | MCP URL comes from env var, no secrets in source |
| No raw SQL injection risk in routes | PASS | All queries use parameterized placeholders ($1, $2) |
| SQL injection risk in middleware | LOW RISK | `SET app.tenant_id` uses string interpolation, mitigated by JWT verification |
| Input validation with Zod | FAIL | No Zod on route params (dialogId, email) |
| Tenant isolation via RLS | PARTIAL | RLS not active (pool.query), but WHERE clause compensates |
| Tenant isolation via cache key | PASS | tenantId embedded in Redis key |
| No PII sent to external APIs | PASS | Only email + tenantId sent to MCP (necessary for lookup) |
| Data residency (FF-10) | PASS | amoCRM MCP on Cloud.ru (Russian); Redis on-premise; no foreign API calls |
| Circuit Breaker prevents cascade | PASS | opossum configured correctly with fallback |
| Error messages do not leak internals | PASS | Routes return generic "Internal server error" on catch |

---

## 4. Summary Scorecard

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| Architectural compliance | 7/10 | RLS bypass via pool.query is a real architectural violation (HIGH) |
| Code quality | 8/10 | Clean hexagonal design; minor type safety gaps |
| Test coverage | 7/10 | MemoryAIService well tested (11 tests); AmoCRMMCPAdapter has zero tests |
| Security | 7/10 | No Zod validation on routes; SQL interpolation in middleware; RLS bypass |
| Performance | 9/10 | Dual timeout, Redis cache with smart TTL strategy, graceful degradation |
| Documentation | 8/10 | Excellent SPARC docs; env var name discrepancy (AMOCRM_MCP_BASE_URL vs AMOCRM_MCP_URL) |

**Overall: 46/60 (77%) -- APPROVED with conditions**

---

## 5. Overall Verdict

**APPROVED** -- the feature is well-designed and functional. The hexagonal architecture is the cleanest in the codebase: MemoryAIService depends on CRMPort interface, the adapter in BC-04 implements it, and wiring happens in the composition root. The CRMResult discriminated union, graceful degradation, and caching strategy are all production-quality.

**1 issue must be fixed before production:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | **HIGH** | `memory-ai-routes.ts` uses `pool.query()` bypassing RLS | Switch to `req.dbClient.query()` |

**5 issues recommended before v2:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 2 | MEDIUM | No Zod validation on route params | Add UUID and email schemas |
| 3 | MEDIUM | Env var name mismatch in docs vs code | Update Specification.md |
| 4 | LOW | `as any` without justification comments | Add comments or define interface |
| 5 | MEDIUM | No unit tests for AmoCRMMCPAdapter | Add tests for ACL, mock generator, status mapping |
| 6 | LOW | SQL interpolation in tenant middleware | Use parameterized SET or validate UUID format |
| 7 | LOW | Mock enrichmentScore hardcoded at 0.85 | Compute dynamically |
