# Brutal Honesty Review: FR-05 Telegram Channel

**Feature ID:** FR-05
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Files Reviewed:**
- `src/integration/adapters/telegram-adapter.ts`
- `src/integration/adapters/telegram-outbound.ts`
- `src/integration/services/telegram-bot-service.ts`
- `src/integration/infrastructure/telegram-routes.ts`
- `src/integration/adapters/telegram-adapter.test.ts`
- `migrations/003_conversations_tables.sql`
- `src/shared/middleware/tenant.middleware.ts`
- `src/conversation/infrastructure/chat-routes.ts`
- `src/conversation/infrastructure/ws-handler.ts`

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — FAIL

The feature introduces bidirectional cross-BC imports, explicitly violating FF-02.

**BC-04 imports BC-01 (expected for adapter pattern):**

| File | Import | Assessment |
|------|--------|------------|
| `telegram-adapter.ts` | `DialogRepository` from `@conversation/...` | Pragmatic ACL |
| `telegram-adapter.ts` | `MessageRepository` from `@conversation/...` | Pragmatic ACL |
| `telegram-outbound.ts` | `DialogRepository` from `@conversation/...` | Pragmatic ACL |

The above imports are defensible in v1 as an Anti-Corruption Layer pattern.

**BC-01 imports BC-04 (indefensible direction):**

| File | Import | Assessment |
|------|--------|------------|
| `src/conversation/infrastructure/chat-routes.ts:14` | `forwardToTelegramIfNeeded` from `@integration/adapters/telegram-outbound` | VIOLATION |
| `src/conversation/infrastructure/ws-handler.ts:30` | `forwardToTelegramIfNeeded` from `@integration/adapters/telegram-outbound` | VIOLATION |

The reverse direction — BC-01 (Conversation) importing from BC-04 (Integration) — is architecturally unjustifiable. BC-01 is a core domain context. It must not depend on infrastructure adapters. This creates a circular dependency risk and contaminates domain code with channel-specific knowledge. The correct pattern is to publish a `MessagePersisted` domain event to a Redis Stream and have BC-04 consume it.

**Severity:** HIGH — violates FF-02. The validation report acknowledges these as "PRAGMATIC" but this is self-justification for a real architectural violation.

---

### FF-04: Circuit Breaker on Every MCP Adapter — PARTIAL FAIL

`TelegramBotService` implements a circuit breaker (`sendBreaker`) only on the `sendMessage` method.

`setWebhook()` and `getMe()` make raw, unguarded `fetch()` calls with no circuit breaker:

```typescript
// telegram-bot-service.ts lines 105-119
async setWebhook(url: string): Promise<TelegramWebhookResult> {
  const response = await fetch(`${this.apiBase}/setWebhook`, ...)  // No breaker
  return response.json() as Promise<TelegramWebhookResult>
}

async getMe(): Promise<TelegramBotInfo> {
  const response = await fetch(`${this.apiBase}/getMe`)  // No breaker
  return response.json() as Promise<TelegramBotInfo>
}
```

If Telegram's API is down, `/api/telegram/setup` and `/api/telegram/status` will hang for up to Node.js default timeout (minutes) with no protection. The fitness function requires circuit breakers on **every** MCP adapter call.

**Severity:** MEDIUM — `sendMessage` is protected (the hot path). The admin-facing methods are cold paths, but they still violate FF-04.

---

### ADR-002: No Direct External API Calls from Domain — PASS

Telegram Bot API calls are confined to `TelegramBotService` in BC-04 infrastructure. Domain code (BC-01 aggregates, value objects) makes no external calls.

---

### FF-03 + ADR-007: Tenant RLS Isolation — CRITICAL FAIL

This is the most serious finding in this review.

The RLS policy on `conversations.dialogs` and `conversations.messages` relies on `current_setting('app.tenant_id')::UUID`. This setting is established by `createTenantMiddleware` via `SELECT set_config(...)` on a **dedicated pool client** attached to `req.dbClient`.

The webhook route is explicitly mounted **before** auth middleware:

```typescript
// server.ts line 90
app.use('/api/webhooks/telegram', createTelegramWebhookRouter(pool, io, telegramBotService))
```

No tenant middleware runs. `TelegramAdapter` receives the raw `pool` and creates `DialogRepository(pool)`. Every `pool.query()` in the repository runs on an arbitrary pool connection that has **never had `app.tenant_id` set**.

**Consequence:** `current_setting('app.tenant_id')` will throw `ERROR: unrecognized configuration parameter "app.tenant_id"` (unless `app.tenant_id` has a default, which it does not in PostgreSQL unless explicitly configured). In practice:

- PostgreSQL may throw an error on every inbound Telegram webhook DB call, OR
- If the setting was set on a previous request that returned this connection to the pool, a prior tenant's ID may persist — cross-tenant data access.

The `DialogRepository` comment even states the contract explicitly:

```
// dialog-repository.ts line 7
// Caller must have SET app.tenant_id in the session before calling any method.
```

The webhook path violates this contract on every single request. This is a **FF-03 fitness function failure**.

**Severity:** CRITICAL — Every inbound Telegram message either fails with a PostgreSQL error or risks cross-tenant data access depending on connection pool state.

---

### SH-04: Webhook HMAC Verification — FAIL

The Telegram webhook endpoint performs zero verification of incoming requests. Anyone who discovers the URL (it is not secret) can POST arbitrary payloads.

Telegram supports `secret_token` in `setWebhook` which populates the `X-Telegram-Bot-Api-Secret-Token` header on every genuine update. This header is not read or validated anywhere in `telegram-routes.ts`.

The team documents this as R-01 (MEDIUM risk) in `Refinement.md`, but SH-04 in the project security rules explicitly requires webhook HMAC/signature verification. Classifying an unimplemented security requirement as "v2" does not make it compliant.

**Severity:** HIGH — unauthenticated webhook endpoint accepting arbitrary JSON, contrary to SH-04.

---

## 2. Code Quality Review

### Strengths

1. **Retry-storm prevention is correctly implemented.** The webhook handler always returns HTTP 200 even on internal errors (catch block in `telegram-routes.ts`). This is the single most operationally important design decision and it is done correctly.

2. **Circuit breaker on `sendMessage` is well-structured.** The `sendBreaker` in `TelegramBotService` uses correct opossum options (timeout=3000ms, errorThresholdPercentage=50, resetTimeout=30000) and emits meaningful log events on state transitions.

3. **`TelegramBotService.fromEnv()` singleton pattern.** Instantiated once at server startup (`server.ts:75`), reused across requests. This is correct — the circuit breaker state is preserved across requests. Per-request instantiation would destroy circuit breaker effectiveness.

4. **Callback query handling.** Converting `callback_query.data` into a synthetic `TelegramMessage` is clean and routes button presses through the identical pipeline as text messages. The fallback when `callback_query.message` is absent is handled correctly.

5. **Sender name extraction is defensive.** Null-safe chaining for `from`, `last_name`, `username` fields handles anonymous and channel messages without crashing.

---

### Issues Found

#### Issue 1: RLS Context Not Set in Webhook Path (CRITICAL)

Already described under FF-03 above. The `TelegramAdapter` calls `DialogRepository` and `MessageRepository` through a pool connection that has never had `app.tenant_id` set. Fix requires either:

a) Acquiring a dedicated client within the adapter and calling `SET LOCAL app.tenant_id = $1` before queries, OR
b) Modifying `DialogRepository` to accept a `tenantId` override and use it in a `SET LOCAL` call, OR
c) Creating a utility `withTenantClient(pool, tenantId, fn)` wrapping the pattern from `tenant.middleware.ts`.

The safest fix for v1:

```typescript
// In telegram-adapter.ts handleIncomingMessage()
const client = await this.pool.connect()
try {
  await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', this.tenantId])
  // all repository calls use client, not pool
} finally {
  client.release()
}
```

---

#### Issue 2: No Input Validation on tenantId Query Parameter (HIGH)

```typescript
// telegram-routes.ts line 43
const tenantId = (req.query.tenantId as string) || process.env.TELEGRAM_DEFAULT_TENANT_ID
```

`tenantId` is accepted verbatim from the URL query string and passed directly to the adapter. There is no UUID format validation. A non-UUID string (e.g., `' OR 1=1`) would reach `SET app.tenant_id = ' OR 1=1'` — while PostgreSQL `::UUID` cast would then fail and throw, this still means:

- Any string is accepted and attempted as tenant context
- No validation prevents enumeration or spoofing of tenant IDs
- An attacker who knows any valid tenant UUID can inject messages for that tenant

Fix: validate with `uuid` or a UUID regex before use:

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
if (!UUID_RE.test(tenantId)) {
  return res.status(400).json({ error: 'Invalid tenantId format' })
}
```

---

#### Issue 3: Per-Request `TelegramAdapter` Instantiation Creates New Repository Instances (MEDIUM)

```typescript
// telegram-routes.ts line 49
const adapter = new TelegramAdapter(pool, io, botService, tenantId)
```

A new `TelegramAdapter` is constructed per webhook request, which creates new `DialogRepository` and `MessageRepository` instances inside the constructor:

```typescript
// telegram-adapter.ts lines 68-69
this.dialogRepo = new DialogRepository(pool)
this.messageRepo = new MessageRepository(pool)
```

While the repositories themselves are stateless wrappers around `pool`, this pattern adds unnecessary object allocation on every webhook call. More importantly, it obscures the dependency graph and makes testing harder (constructor side effects). A cleaner pattern injects pre-built repositories.

---

#### Issue 4: Race Condition on Concurrent Dialog Creation (MEDIUM)

The `findByExternalId` → `create` pattern in `handleIncomingMessage` is not atomic:

```typescript
let dialog = await this.dialogRepo.findByExternalId(this.tenantId, chatId)
if (!dialog) {
  dialog = await this.dialogRepo.create({ ... })
}
```

If two simultaneous Telegram updates arrive from the same chat (burst messages), both will find `null`, both will call `create`, and two dialogs will be created for the same Telegram chat. Subsequent messages will land in the dialog created by whichever request wins. No UNIQUE constraint exists on `(tenant_id, external_id)` in `migrations/003_conversations_tables.sql`.

This is acknowledged in `Refinement.md` ("Testing Gaps: No test for concurrent messages from same chat") but not fixed.

Fix: Add a DB-level constraint:

```sql
CREATE UNIQUE INDEX uidx_dialogs_tenant_external
  ON conversations.dialogs(tenant_id, external_id)
  WHERE external_id IS NOT NULL;
```

And use `INSERT ... ON CONFLICT DO NOTHING RETURNING *` or `ON CONFLICT DO UPDATE` in the repository.

---

#### Issue 5: Circuit Breaker Open — No Fallback Value Returned (MEDIUM)

When `sendBreaker` trips to OPEN state and `sendMessage()` is called, opossum throws a `CircuitBreakerOpenError`. The callers in `telegram-outbound.ts` catch this and log it, which is correct for outbound. However, `TelegramAdapter.sendReply()` does not catch this case:

```typescript
// telegram-adapter.ts lines 155-161
async sendReply(chatId: string, text: string): Promise<void> {
  const result = await this.botService.sendMessage(chatId, text)  // may throw CircuitBreakerOpenError
  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description}`)
  }
}
```

If the circuit is open, `this.botService.sendMessage()` throws before returning a result. The error propagates to the caller. The test "should throw on Telegram API error" tests a Telegram API error response (`ok: false`), not an open circuit breaker. These are different failure modes with different exception types.

---

#### Issue 6: Bot Token Embedded in API Base URL — Log Exposure Risk (MEDIUM)

```typescript
// telegram-bot-service.ts line 52
this.apiBase = `${TELEGRAM_API_BASE}/bot${botToken}`
```

The `apiBase` string contains the bot token in the URL path. If any logging middleware, Node.js unhandled rejection handler, or error monitoring tool (e.g., Sentry) captures `fetch()` request URLs, the token will be logged in plaintext. This is a SH-01 violation (token must not be logged).

The fetch calls use `this.apiBase` directly. If `fetch` throws a network error, the error object in some environments includes the request URL.

Fix: keep the base URL token-free and use a header-based auth approach, or at minimum ensure error messages never include `apiBase` in logged output.

---

#### Issue 7: `setWebhook` and `getMe` Have No Timeout (LOW)

`setWebhook()` and `getMe()` use raw `fetch()` with no `AbortController` timeout. Node.js 20 native fetch has a default timeout, but it is not bounded to the 3000ms requirement stated in the security rules (`SH-04`: MCP timeout ≤ 3000ms). Under slow network conditions these calls can hang indefinitely.

---

#### Issue 8: No Zod Validation on Webhook Body (LOW)

```typescript
// telegram-routes.ts line 29
const update = req.body as TelegramUpdate
```

The request body is directly cast to `TelegramUpdate`. The only validation is:

```typescript
if (!update || !update.update_id) { return res.status(400) }
```

This is insufficient. A malformed `message.chat.id` (non-number), missing `from` in unexpected positions, or other structural deviations will surface as runtime errors deep in the adapter rather than being rejected at the boundary with a meaningful error. A Zod schema would make this contract explicit and testable.

---

#### Issue 9: Message Content Not Capped at Known Limit (LOW)

Telegram messages can be up to 4096 characters. The adapter stores `tgMessage.text ?? ''` directly without truncation:

```typescript
const text = tgMessage.text ?? ''
// ...
content: text,
```

The project's `conversations.messages.content` column is `TEXT` (unlimited in PostgreSQL), but the PQL RuleEngine applies a 2000-character truncation (`EC-02` from the PQL docs). Since the adapter bypasses the PQL truncation guard, excessively long messages will be stored in full. This inconsistency means PQL analysis of Telegram messages truncates to 2000 chars while the stored content is untruncated. Not a crash risk, but a data consistency issue.

---

## 3. Security Review

| Check | Status | Detail |
|-------|--------|--------|
| SH-04: Webhook HMAC/signature verification | FAIL | No `X-Telegram-Bot-Api-Secret-Token` validation |
| FF-03: RLS tenant isolation | FAIL | `app.tenant_id` not set in webhook path |
| Input validation on tenantId | FAIL | No UUID format check on query parameter |
| Bot token in code | PASS | Token from env var only |
| Bot token in logs | RISK | Token embedded in `apiBase` URL; log exposure possible |
| Parameterized SQL queries | PASS | All queries use `$1`, `$2` placeholders |
| No foreign LLM API calls | PASS | Direct Telegram Bot API only |
| Data residency (FF-10) | PASS | Telegram messages stored on local PostgreSQL |
| Rate limiting on webhook | FAIL | No rate limiter on `/api/webhooks/telegram` (R-04 known, still a gap) |
| JWT on management routes | PASS | `/api/telegram/setup` and `/api/telegram/status` require valid JWT |
| PII in logs | PASS | Message content not logged, only error metadata |

---

## 4. Test Coverage Assessment

**What is tested (15 tests):**
- Inbound text message parsing and persistence
- New dialog creation vs. existing dialog reuse
- Socket.io event emission for new dialogs and messages
- Sender name extraction (first_name + last_name)
- Callback query handling
- Non-text update rejection
- `sendReply` success and API error paths
- `TelegramBotService` HTTP endpoint calls
- `fromEnv()` presence/absence behavior

**Critical gaps not tested:**
- Circuit breaker state transitions (CLOSED → OPEN → HALF-OPEN → CLOSED)
- Circuit breaker OPEN state behavior in `sendReply` (different from API error)
- `setWebhook` and `getMe` under network failure (no circuit breaker, no timeout test)
- Webhook with invalid or missing `tenantId` — only the happy path for missing tenantId (returns 400) is implicitly covered
- Concurrent dialog creation race condition
- RLS context not being set (would require integration test against real PostgreSQL)
- HMAC header validation (not implemented, thus not testable yet)
- Malformed `TelegramUpdate` body with valid `update_id` but corrupt inner structure
- Message content exceeding Telegram's 4096-character limit

The test count of 15 is misleading because it does not cover the most failure-prone paths: circuit breaker behavior, concurrent writes, and security controls.

---

## 5. Summary Scorecard

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Architecture Compliance | 4/10 | CRITICAL RLS bypass in webhook path; bidirectional cross-BC imports; HMAC not implemented per SH-04 |
| Code Quality | 6/10 | Core adapter logic is clean; race condition on dialog creation; per-request object allocation; no input schema validation |
| Test Coverage | 5/10 | 15 tests cover happy paths; no circuit breaker tests; no concurrent write tests; no integration tests for RLS or race conditions |
| Security | 3/10 | Two CRITICAL/HIGH failures: RLS not enforced on webhook path; no webhook signature validation; tenantId not validated; bot token URL exposure risk |
| Performance | 7/10 | Synchronous DB writes in webhook handler work for v1 load; no Redis Stream async processing; no load test; race condition risk at scale |
| Documentation | 8/10 | SPARC docs are thorough; known risks are honestly documented in Refinement.md; cross-BC violations are acknowledged but underweighted |

**Overall: 33/60 (55%)**

---

## 6. Overall Verdict

**REJECTED**

The feature cannot be approved for production deployment in its current state due to two blocking issues:

**BLOCKER 1 — FF-03 Violation (RLS not enforced on webhook path):**
Every inbound Telegram message creates dialog and message records via a database connection that has never had `app.tenant_id` set. Depending on connection pool state, this either fails with a PostgreSQL error (service unavailable) or inherits a previous request's tenant context (cross-tenant data write). Both outcomes are unacceptable. This is a fitness function violation that blocks deploy per project rules.

**BLOCKER 2 — SH-04 Violation (no webhook authentication):**
The `/api/webhooks/telegram` endpoint accepts arbitrary unauthenticated POST requests. Per SH-04, all webhook endpoints must perform signature verification. Telegram provides the `secret_token` mechanism for exactly this purpose. Any actor who knows the URL (easily discoverable via port scan or log leak) can inject fabricated messages into any tenant's dialog queue.

**Required before re-review:**

1. Add `withTenantClient(pool, tenantId, fn)` utility and use it in `TelegramAdapter.handleIncomingMessage()` to set `app.tenant_id` before all DB operations
2. Implement `X-Telegram-Bot-Api-Secret-Token` header validation in `createTelegramWebhookRouter` (requires passing `secret_token` to `setWebhook`)
3. Validate `tenantId` query parameter as a valid UUID before use

**Recommended (not blocking re-review, but fix before v1 release):**

4. Add UNIQUE constraint on `(tenant_id, external_id)` in `conversations.dialogs` and use `INSERT ... ON CONFLICT`
5. Add circuit breaker to `setWebhook()` and `getMe()` methods (FF-04 completeness)
6. Add `AbortController` timeout (3000ms) to `setWebhook` and `getMe` fetch calls
7. Move BC-01 → BC-04 imports to a domain event pattern (Redis Stream) to resolve FF-02 reverse dependency
8. Add circuit breaker OPEN state test and concurrent dialog creation test
