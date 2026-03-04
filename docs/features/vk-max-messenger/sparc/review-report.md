# Brutal Honesty Review: FR-09 VK Max / Messenger Max MCP

**Feature ID:** FR-09
**Reviewer:** Brutal Honesty Review (Phase 4)
**Date:** 2026-03-04
**Overall Verdict:** APPROVED WITH CONDITIONS — circuit breaker is broken at the architectural level; must be fixed before production load

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — CONDITIONAL PASS

`VKMaxAdapter` and `VKMaxOutbound` import `DialogRepository` and `MessageRepository` directly from `@conversation/infrastructure/repositories/`. This is the same pattern as the Telegram adapter and is explicitly noted as "allowed under the current architecture" in the FR-09 Architecture doc.

**However**, the existing review report for FR-08 never challenged this pattern critically. Let us challenge it now:

BC-04 Integration directly instantiates BC-01 infrastructure classes inside its own adapter. This is not an ACL pattern — it is direct infrastructure coupling between bounded contexts. The Telegram adapter established this as a "pattern." FR-09 copied it. Two wrongs do not make a right.

The correct DDD approach: BC-04 should call a BC-01 application service port (e.g., `DialogCreationPort`) rather than reaching into BC-01's infrastructure layer. The current pattern bypasses BC-01's application layer entirely.

**Severity:** MEDIUM — this is a structural debt that will cause pain when BC-01's persistence changes.

**Recommendation:** Define `IDialogRepository` and `IMessageRepository` ports in a shared kernel or in BC-04's own domain/ports layer and have BC-01's implementations satisfy those interfaces. This has not been done in any channel adapter so far. This is systemic architectural debt across FR-05, FR-08, and FR-09.

---

### FF-03: Tenant RLS Isolation — FAIL (Critical Gap)

The `DialogRepository` comment on line 7 explicitly states:

```
IMPORTANT: All queries run under RLS (FF-03).
Caller must have SET app.tenant_id in the session before calling any method.
```

The VK Max webhook handler (`vkmax-routes.ts` line 53) does this:

```typescript
const adapter = new VKMaxAdapter(pool, io, mcpService, tenantId)
const handled = await adapter.handleUpdate(update)
```

The `VKMaxAdapter` then calls `this.dialogRepo.findByExternalId(this.tenantId, peerId)` and `this.dialogRepo.create(...)` using the `pool` directly — without ever issuing `SET app.tenant_id = $1` to establish the RLS session variable.

Searching the entire codebase, `SET app.tenant_id` is mentioned only in the dialog-repository comment — it is never actually executed anywhere. Not in the adapter, not in any middleware for the webhook path, not in the repository methods themselves.

**This means RLS is never activated for VK Max webhook requests.** If the PostgreSQL RLS policies are configured to enforce `app.tenant_id`, every query will fail. If they are configured with a fallback (no restriction when the variable is unset), data residency isolation is broken — VK Max webhooks could read or write across tenant boundaries.

This is not a VK Max-specific problem. The same gap exists in the Telegram adapter and likely throughout BC-01. FR-09 exposes it most clearly because the webhook path explicitly handles a `tenantId` from an untrusted query parameter rather than a JWT-validated session.

**Severity:** CRITICAL — FF-03 (Tenant RLS isolation 100%) is a CRITICAL fitness function that blocks deploy.

**Recommendation:** Repositories must set `SET LOCAL app.tenant_id = $1` within each query transaction, or the adapter must acquire a client from the pool and set the session variable before any query. This is the pattern that ADR-007 requires but that no implementation file actually demonstrates.

---

### FF-04: Circuit Breaker on MCP — PARTIALLY BROKEN

The circuit breaker exists and uses opossum. However, there is a critical architectural defect.

The `VKMaxMCPService.fromEnv()` factory is called in `server.ts` at startup (line 76) and the singleton is injected into `createVKMaxWebhookRouter`, `createVKMaxManagementRouter`, and `registerVKMaxOutbound` — this part is **correct**.

But `_sendMessage` in `vkmax-mcp-service.ts` contains this check:

```typescript
private async _sendMessage(peerId: string | number, text: string): Promise<VKMaxSendResult> {
  if (!this.mcpUrl) {
    // Mock implementation — log and return success
    console.info(`[vkmax-mcp-service] MOCK sendMessage to peer ${peerId}: ...`)
    return { ok: true, messageId: Date.now() }
  }
  // ... real HTTP call
}
```

The constructor accepts `mcpUrl` and `accessToken`. But `fromEnv()` only returns a non-null service when **both** env vars are set. When both are set, `this.mcpUrl` is always truthy, so the mock branch inside `_sendMessage` can never be reached through `fromEnv()`.

Conversely, when you instantiate directly (`new VKMaxMCPService('', 'test-token')`) as the tests do, mock mode activates. This means the mock branch is only reachable via the test path that bypasses `fromEnv()`. In production, if `VKMAX_MCP_URL` is set but the real MCP endpoint is unreachable, the circuit breaker fires real HTTP requests and trips — which is correct. But the internal dead-code mock creates confusion and false confidence.

Additionally, `setWebhook` and `getStatus` are **not wrapped in circuit breakers**. Only `sendMessage` goes through the `sendBreaker`. If `setWebhook` or `getStatus` hang, the Express handler blocks with no timeout protection.

**Severity:** MEDIUM — the circuit breaker gap on `setWebhook` and `getStatus` can cause request handler timeouts.

**Timeout violation:** The circuit breaker is configured at 5000ms. The security rules explicitly state "Timeout: ≤3000ms per MCP call." This is documented in the existing review report but left unresolved. It is still a violation.

---

### ADR-002: MCP = Integration Layer — PARTIAL PASS

All VK Max outbound communication goes through `VKMaxMCPService`. This is correct.

However, `VKMaxAdapter.handleUpdate()` constructs the `VKMaxAdapter` with a direct `Pool` reference and uses it to call `DialogRepository` and `MessageRepository` — BC-01 infrastructure — without going through any application service or port. The spirit of ADR-002 is that domain code never calls external APIs directly; the VK Max adapter is calling BC-01's database layer directly. This is the same structural issue flagged under FF-02.

---

### FF-10: Data Residency — CONDITIONAL PASS

The MCP endpoint is configurable via `VKMAX_MCP_URL`. There is no enforcement at the code level that this URL points to Cloud.ru infrastructure. If misconfigured to an OpenAI or foreign endpoint, the check passes at the code level. This is the same condition accepted for Telegram.

---

## 2. Code Quality Review

### Strengths

1. **Webhook idempotency:** Always returning `'ok'` to prevent VK Max retry storms is correctly implemented at the route level and documented.

2. **Singleton injection at startup:** `server.ts` correctly calls `VKMaxMCPService.fromEnv()` once at startup and passes the singleton to all consumers. The prior review report (located at `docs/features/vk-max-messenger/review-report.md`) incorrectly identified this as Issue 3 ("VKMaxMCPService.fromEnv() called per request"). It is not called per request — the singleton is created once. That prior review contained a factually incorrect finding.

3. **Type interfaces:** `VKMaxMessage`, `VKMaxUpdate`, `VKMaxSendResult`, `VKMaxBotInfo`, `VKMaxWebhookResult` are all explicitly typed. No `any` in production code.

4. **Dual outbound paths:** Socket.io middleware + REST helper function provides flexibility for different call sites.

5. **Mock mode for development:** The pattern is sound, though the dead-code path inside `_sendMessage` (noted above) creates confusion.

---

### Issues Found

#### Issue 1: RLS session variable never set — CRITICAL

```typescript
// vkmax-adapter.ts lines 75, 93 — no SET app.tenant_id before DB queries
let dialog = await this.dialogRepo.findByExternalId(this.tenantId, peerId)
const message = await this.messageRepo.create({ ... })
```

The repository comment explicitly warns callers to set `app.tenant_id`. No code in the VK Max integration path does this. No code in the Telegram integration path does this either. This is a systemic gap across all channel adapters.

**Fix:** Each repository method that touches tenant-scoped data should begin with `await client.query("SET LOCAL app.tenant_id = $1", [tenantId])` within a transaction, or a higher-level middleware must set the session variable per-connection before the adapter is invoked.

---

#### Issue 2: Circuit breaker does not cover setWebhook and getStatus — MEDIUM

```typescript
// vkmax-mcp-service.ts line 115 — no circuit breaker
async setWebhook(url: string): Promise<VKMaxWebhookResult> {
  // direct fetch, no CB wrapper
}

// vkmax-mcp-service.ts line 136 — no circuit breaker
async getStatus(): Promise<VKMaxBotInfo> {
  // direct fetch, no CB wrapper
}
```

If the MCP endpoint is slow or unavailable, both methods will hang until the native fetch timeout (Node.js default is effectively infinite for HTTP). An operator hitting `GET /api/vkmax/status` could block the request handler.

**Fix:** Create `setWebhookBreaker` and `statusBreaker` CircuitBreaker instances, or extract a generic `callWithBreaker<T>()` helper and apply it to all three methods.

---

#### Issue 3: `random_id: Date.now()` is not a reliable deduplication key — MEDIUM

```typescript
// vkmax-mcp-service.ts line 105
body: JSON.stringify({
  peer_id: peerId,
  message: text,
  random_id: Date.now(),  // millisecond timestamp
})
```

VK Max uses `random_id` for server-side deduplication of outbound messages. Using `Date.now()` means two rapid calls within the same millisecond will share the same `random_id` and the second message will be silently dropped by VK Max. Under concurrent operator activity, this is a real scenario. The VK API specification recommends using a cryptographically random integer for this field.

**Fix:** Use `crypto.randomInt(0, 2147483647)` (Node.js crypto module) instead of `Date.now()`.

---

#### Issue 4: Webhook body is cast without Zod validation — MEDIUM

```typescript
// vkmax-routes.ts line 29
const update = req.body as VKMaxUpdate
```

The body is cast directly with no schema validation. The subsequent guard `if (!update || !update.type)` is a weak existence check, not a type-safe validation. A malicious actor could POST a body where `update.object.message.text` is a number instead of a string, which would pass the guard and potentially cause `String(vkMessage.peer_id)` to produce unexpected output.

The project's coding-style rules mandate: "Use zod for all API input validation." This is not followed here or in the Telegram routes.

**Fix:** Define a Zod schema for `VKMaxUpdate` and use `.safeParse()` with a proper error response.

---

#### Issue 5: Webhook tenantId from query parameter is unvalidated — MEDIUM

```typescript
// vkmax-routes.ts line 47
const tenantId = (req.query.tenantId as string) || process.env.VKMAX_DEFAULT_TENANT_ID
```

The `tenantId` comes from an unauthenticated query parameter on an unauthenticated endpoint. There is no validation that it is a valid UUID format. If an attacker sends a webhook with `?tenantId='; DROP TABLE conversations.dialogs; --`, the parameterized query in `findByExternalId` would prevent SQL injection, but the raw string would be passed as `tenant_id` to `dialogRepo.create()`, potentially creating a record with a non-UUID `tenant_id` that breaks the schema invariant.

Additionally, any external actor who knows a valid `tenantId` (which is a UUID exposed in various API responses) can inject messages into that tenant's workspace by sending crafted webhook payloads to the unauthenticated endpoint.

**Fix:** Validate `tenantId` is a valid UUID (e.g., with `zod.string().uuid()`) before using it. Additionally, consider a shared secret or per-tenant confirmation token to prevent cross-tenant webhook injection.

---

#### Issue 6: `forwardToVKMaxIfNeeded` creates a new DialogRepository instance per call — LOW

```typescript
// vkmax-outbound.ts lines 62-64
export async function forwardToVKMaxIfNeeded(...): Promise<void> {
  const dialogRepo = new DialogRepository(pool)
  const dialog = await dialogRepo.findById(dialogId)
```

Every REST call that uses `forwardToVKMaxIfNeeded` instantiates a new `DialogRepository`. This is not a connection pool leak (the pool is shared), but it does mean the same dialog lookup happens twice if the REST message path also queries the dialog. Minor inefficiency that compounds with volume.

---

#### Issue 7: Prior review report at docs/features/vk-max-messenger/review-report.md contains incorrect findings — LOW

Issue 3 in the prior review (`docs/features/vk-max-messenger/review-report.md`) states that `VKMaxMCPService.fromEnv()` is "called per request." This is factually wrong — `server.ts` line 76 creates the singleton at startup. The finding reflects a misread of the code. The review that validated this feature contained an error, reducing confidence in the review's thoroughness overall.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | Token in env var only |
| No SQL injection risk | PASS | Parameterized queries throughout |
| Zod validation on API input | FAIL | Webhook body cast without validation (Issue 4) |
| Tenant isolation via RLS | FAIL | SET app.tenant_id never called (Issue 1 — Critical) |
| No PII sent to foreign APIs | CONDITIONAL PASS | MCP URL is configurable; no enforcement |
| Webhook authentication (SH-04) | FAIL | No HMAC verification; any actor can POST to webhook |
| tenantId input validation | FAIL | Unvalidated UUID from unauthenticated query param (Issue 5) |
| Circuit breaker on all MCP calls | FAIL | setWebhook and getStatus unprotected (Issue 2) |
| CB timeout <= 3000ms | FAIL | 5000ms violates security rules specification |

The security posture of the unauthenticated webhook endpoint is the most significant concern. Any external actor with knowledge of the webhook URL and a valid tenant UUID can inject arbitrary messages into that tenant's workspace. The VK Max confirmation callback provides weak protection only during initial setup, not for ongoing message_new events.

---

## 4. Test Quality Review

14 tests pass. The tests are well-structured. However, the tested surface is thin:

| What is tested | Status |
|----------------|--------|
| `VKMaxAdapter.handleUpdate` happy path | Yes |
| `VKMaxAdapter.handleUpdate` new dialog creation | Yes |
| `VKMaxAdapter.handleUpdate` Socket.io emit | Yes |
| `VKMaxAdapter.handleUpdate` metadata storage | Yes |
| `VKMaxAdapter.handleUpdate` non-message_new skip | Yes |
| `VKMaxAdapter.sendReply` success | Yes |
| `VKMaxAdapter.sendReply` error throw | Yes |
| `VKMaxMCPService.fromEnv` null when unconfigured | Yes |
| `VKMaxMCPService` circuit breaker initial state | Yes |
| `VKMaxMCPService` mock mode send | Yes |

| What is NOT tested | Impact |
|--------------------|--------|
| Route-level webhook handling (confirmation, tenantId missing, error recovery) | HIGH — routes are the attack surface |
| Route-level setup endpoint | MEDIUM |
| Route-level status endpoint | MEDIUM |
| `registerVKMaxOutbound` Socket.io middleware | HIGH — dual outbound path entirely untested |
| `forwardToVKMaxIfNeeded` function | HIGH — REST outbound path entirely untested |
| `setWebhook` and `getStatus` in VKMaxMCPService | MEDIUM |
| Circuit breaker state transitions (open/half-open) | MEDIUM |
| RLS context not set (would be a regression test) | HIGH — critical gap uncovered |
| Webhook body with invalid/missing fields | HIGH — security edge case |
| tenantId from query parameter (invalid UUID, missing) | HIGH |

The tests cover the adapter layer well but leave two complete files (`vkmax-routes.ts` and the outbound paths in `vkmax-outbound.ts`) with zero route-level test coverage.

---

## 5. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architectural compliance | 5/10 | RLS never activated; CB incomplete; BC coupling unresolved |
| Code quality | 7/10 | Clean structure; dead-code mock; random_id flaw |
| Test coverage | 5/10 | Routes and outbound paths entirely untested |
| Security | 3/10 | Three FAIL items; unauthenticated webhook injection possible |
| Performance | 7/10 | CB timeout exceeds spec; no load test |
| Documentation | 8/10 | SPARC docs thorough; prior review report had incorrect finding |

**Overall: 35/60 (58%) — CONDITIONAL APPROVAL**

---

## 6. Blocking Issues Before Production

| # | Issue | Fitness Function | Fix Required |
|---|-------|-----------------|--------------|
| 1 | RLS session variable `SET app.tenant_id` never executed in webhook path | FF-03 (CRITICAL) | Yes — blocks deploy |
| 2 | Circuit breaker does not cover `setWebhook` and `getStatus` | FF-04 (HIGH) | Yes — blocks merge |
| 3 | `random_id: Date.now()` causes message deduplication collisions under concurrency | Production correctness | Yes — blocks merge |
| 4 | Webhook tenantId from unauthenticated query param with no UUID validation | Security | Yes — blocks merge |

## 7. Recommended Fixes Before v2

| # | Issue | Severity |
|---|-------|----------|
| 5 | Add Zod validation for VKMaxUpdate webhook body | MEDIUM |
| 6 | Reduce circuit breaker timeout from 5000ms to 3000ms | MEDIUM |
| 7 | Add route-level tests for vkmax-routes.ts | MEDIUM |
| 8 | Add tests for registerVKMaxOutbound and forwardToVKMaxIfNeeded | MEDIUM |
| 9 | Replace console.error/console.info with structured logger | LOW |
| 10 | Long-term: define repository ports in shared kernel to remove BC-01/BC-04 coupling | LOW (systemic) |
