# Brutal Honesty Review: FR-04 Chat Widget

**Feature ID:** FR-04
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** APPROVED WITH CONDITIONS

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports -- FAIL (soft)

`ws-handler.ts` has four direct cross-BC imports:

```typescript
// ws-handler.ts lines 27-31
import { PQLDetectorService, MessageEvent } from '@pql/application/services/pql-detector-service'
import { analyzePQLInline } from '@pql/infrastructure/message-consumer'
import { NotificationService } from '@notifications/application/services/notification-service'
import { forwardToTelegramIfNeeded } from '@integration/adapters/telegram-outbound'
import { forwardToVKMaxIfNeeded } from '@integration/adapters/vkmax-outbound'
```

`chat-routes.ts` has two direct cross-BC imports:

```typescript
// chat-routes.ts lines 14-15
import { forwardToTelegramIfNeeded } from '@integration/adapters/telegram-outbound'
import { forwardToVKMaxIfNeeded } from '@integration/adapters/vkmax-outbound'
```

**Total: 6 cross-BC imports from 3 different bounded contexts (BC-02, BC-04, BC-06).**

The Architecture.md claims "BC-01 does NOT import domain types from other BCs" and notes these are "infrastructure-level imports." This is technically true -- the imports are from application/infrastructure layers, not domain layers. However, FF-02 states "No cross-BC imports" without qualification. The pattern creates hard compile-time coupling between BC-01 and three other bounded contexts.

**Severity:** MEDIUM. These are fire-and-forget integrations and the coupling is directional (BC-01 depends on others, not vice versa). A port/adapter pattern with dependency injection at the composition root would resolve this.

---

### FF-03: Tenant RLS Isolation -- FAIL (CRITICAL)

Two separate issues compound into a serious RLS integrity gap:

#### Issue 1: RLS Context on Wrong Connection (chat-routes.ts)

The tenant middleware (`tenant.middleware.ts`) acquires a dedicated `PoolClient` via `pool.connect()`, sets `SET app.tenant_id` on that client, and stores it as `req.dbClient`. However, `chat-routes.ts` instantiates repositories with the raw `pool`:

```typescript
// chat-routes.ts lines 34-35
const dialogRepo = new DialogRepository(pool)
const messageRepo = new MessageRepository(pool)
```

All repository methods call `this.pool.query(...)`, which acquires a **random connection from the pool** -- a different connection than `req.dbClient`. The RLS context set by the middleware exists only on the dedicated client, not on whatever connection the pool hands to the repository.

**Impact:** Every REST endpoint in `chat-routes.ts` executes queries without effective RLS enforcement. The `WHERE tenant_id = $1` clause in `findOpenByTenant` provides application-level filtering, but `findById`, `updateStatus`, and `assignOperator` operate by primary key with no tenant filter and no RLS context. An authenticated operator from tenant A could potentially access tenant B's dialogs by ID.

**Severity:** CRITICAL. This is a tenant isolation violation (FF-03 = "block deploy").

#### Issue 2: SQL Injection in SET LOCAL (ws-handler.ts)

Three instances of string interpolation in SQL:

```typescript
// ws-handler.ts lines 99, 162, 210
await pool.query(`SET LOCAL app.tenant_id = '${tenantId}'`)
```

The same pattern exists in `tenant.middleware.ts` line 44:

```typescript
await client.query(`SET app.tenant_id = '${payload.tenantId}'`)
```

While `tenantId` is Zod-validated as UUID format on WebSocket events and JWT-decoded on REST routes, this is still a dangerous anti-pattern. The Zod UUID regex does not prevent all injection vectors (e.g., edge cases in UUID parsing). Additionally, `SET LOCAL` only applies within a transaction block -- outside a transaction, it has no effect. The repositories do not wrap queries in transactions.

**Severity:** CRITICAL. String interpolation in SQL is a class-one vulnerability per OWASP. Even with Zod validation as a defense layer, the pattern must be replaced with parameterized calls: `SELECT set_config('app.tenant_id', $1, true)`.

#### Issue 3: SET LOCAL Without Transaction (ws-handler.ts)

`SET LOCAL` is scoped to the current transaction. If the pool connection is not inside a `BEGIN/COMMIT` block, `SET LOCAL` is equivalent to `SET` but automatically reverts at the next transaction boundary. Since the repositories call `pool.query()` (which auto-commits each statement), the `SET LOCAL` on line 99 and the `dialogRepo.findByExternalId()` on line 102 may execute on **different connections** from the pool.

**Impact:** Even if the `SET LOCAL` executes correctly, the RLS context is not guaranteed to be active when the repository query runs on a different pool connection.

**Severity:** CRITICAL. This is the same class of bug as Issue 1 but on the WebSocket path.

---

### SH-03: Rate Limiting -- FAIL

**Chat Widget rate limit (10 msg/min per session) is not implemented.**

- No `express-rate-limit` configuration found in `src/conversation/`.
- No per-socket message counter in `ws-handler.ts`.
- No Redis-based rate limiter for WebSocket events.
- The Refinement document (section 2) explicitly documents this gap and recommends a Redis INCR+EXPIRE approach.
- The Final Summary lists this as "Known Gap #2."

A malicious client can send unlimited messages via the `client:message` WebSocket event. Each message triggers:
1. A DB INSERT (message)
2. A potential DB INSERT (dialog creation)
3. A PQL analysis pipeline invocation
4. A broadcast to all connected operators

**Severity:** HIGH. An attacker with a tenant UUID could overwhelm the database and PQL pipeline with thousands of messages per minute. This is a denial-of-service vector.

---

### WebSocket Security -- FAIL

#### No Authentication on Widget Connections

Widget connections authenticate with a raw `tenantId` in `socket.handshake.auth`:

```typescript
// Widget connection
{ tenantId: string }
```

There is no token verification, no domain allowlist check, and no CAPTCHA. Anyone who discovers or guesses a tenant UUID (they are v4 UUIDs, but could be leaked in browser network logs, support emails, etc.) can:

1. Open unlimited WebSocket connections
2. Create dialogs under that tenant
3. Send messages that appear in the operator workspace
4. Trigger PQL analysis on arbitrary content

The Refinement document (S-W1) explicitly flags this risk and recommends a widget-specific token.

**Severity:** HIGH. This is a spam and impersonation vector.

#### No Connection Rate Limiting

There is no limit on the number of Socket.io connections per IP, per tenant, or per session. A script could open thousands of connections to the `/chat` namespace.

**Severity:** MEDIUM. Socket.io itself has some protection (transport negotiation), but no application-level guard exists.

---

## 2. Code Quality Review

### Strengths

1. **Comprehensive Zod validation.** All five inbound events/bodies have Zod schemas with proper UUID validation, string length limits, and optional field handling. Error responses include flattened Zod errors for debugging.

2. **Clean domain model.** `dialog.ts` and `message.ts` are properly modeled as domain types with factory functions and business rule predicates (`canAssign`, `canClose`). The domain layer has zero infrastructure imports.

3. **Fire-and-forget pattern consistently applied.** PQL analysis and channel forwarding use `.catch(err => console.error(...))` consistently across both `ws-handler.ts` and `chat-routes.ts`. Message delivery is never blocked by downstream processing.

4. **Idempotent dialog resumption.** The find-or-create pattern using `externalChannelId` prevents duplicate dialogs on widget reconnection. The `dialogId` in `socket.handshake.auth` correctly re-joins the room on reconnect.

5. **Paginated queries with bounds.** Both `ListDialogsQuerySchema` and `MessagesQuerySchema` use `z.coerce.number().int().min(1).max(100)` to prevent unbounded queries.

6. **Dual-path message delivery.** REST for persistence reliability + WebSocket for real-time broadcast is a sound architectural choice for operator sends.

7. **Clean row-to-domain mapping.** `rowToDialog` and `rowToMessage` functions handle type coercion, null-to-undefined mapping, and default values correctly.

---

### Issues Found

#### Issue 1: Business Rule `canAssign` Not Enforced (MEDIUM)

The domain layer defines `canAssign(dialog): boolean` (returns true only for OPEN status), but `DialogRepository.assignOperator()` does not check this:

```typescript
// dialog-repository.ts lines 117-126
async assignOperator(id: string, operatorId: string): Promise<Dialog | null> {
  const { rows } = await this.pool.query(
    `UPDATE conversations.dialogs
     SET operator_id = $1, status = 'ASSIGNED', updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [operatorId, id],
  )
  return rows.length ? rowToDialog(rows[0]) : null
}
```

The SQL has no `AND status = 'OPEN'` guard. An operator could re-assign an already-assigned, closed, or archived dialog. The `ws-handler.ts` `dialog:assign` handler also does not call `canAssign()` before `assignOperator()`.

**Severity:** MEDIUM. Violates the documented state machine (OPEN -> ASSIGNED). Could lead to inconsistent state if operators race to assign.

---

#### Issue 2: DB Double-Write on Operator Send (MEDIUM)

When an operator sends a message, the `useMessages` hook does both:
1. `POST /api/dialogs/:id/messages` (creates message row via REST)
2. `emit('operator:message', ...)` (creates a second message row via ws-handler)

Both paths call `MessageRepository.create()` with a new UUID. The database ends up with two rows for the same logical message. The UI deduplicates by `message.id`, but since each row has a different UUID, deduplication only works because the REST response adds the message to state before the socket broadcast arrives (race condition dependent).

**Severity:** MEDIUM. Data integrity issue. Every operator message is stored twice in the database.

---

#### Issue 3: No `dialog:closed` WebSocket Event (LOW)

The `updateStatus` handler in `chat-routes.ts` updates the database but does not emit any WebSocket event. The widget has no way to know a dialog has been closed. Connected widget clients will continue to accept user input and attempt to send messages to a closed dialog.

**Severity:** LOW. Functional gap, not a security or data issue. Tracked as LIM-W5.

---

#### Issue 4: Repositories Not Using Dedicated Client (HIGH)

Both `ws-handler.ts` and `chat-routes.ts` instantiate repositories with the `Pool` object:

```typescript
const dialogRepo = new DialogRepository(pool)
const messageRepo = new MessageRepository(pool)
```

Repository methods call `this.pool.query()`, which grabs a random connection from the pool. But `SET LOCAL app.tenant_id` is called on a different connection (either via `pool.query()` in ws-handler or via `req.dbClient` in the middleware). The RLS context and the data queries execute on different connections.

**Fix:** Either pass `req.dbClient` to repository methods for REST routes, or wrap the entire handler in `pool.connect()` + `BEGIN` + `SET LOCAL` + queries + `COMMIT` + `release()` for WebSocket handlers.

**Severity:** HIGH. Root cause of the RLS enforcement gap described in section 1.

---

#### Issue 5: `pool.query('SET LOCAL ...')` Outside Transaction (MEDIUM)

`SET LOCAL` only persists within a transaction block. When called via `pool.query()` outside a `BEGIN/COMMIT`, the setting is immediately lost. The ws-handler calls:

```typescript
await pool.query(`SET LOCAL app.tenant_id = '${tenantId}'`)  // line 99
let dialog = await dialogRepo.findByExternalId(...)           // line 102 — different connection
```

These are two independent `pool.query()` calls. PostgreSQL auto-wraps each in an implicit transaction. The `SET LOCAL` from line 99 expires when that implicit transaction completes, before line 102 executes.

**Severity:** MEDIUM (subsumes into the HIGH-severity Issue 4 above, but worth noting as a distinct conceptual error).

---

#### Issue 6: Error Logging Without Type Narrowing (LOW)

All catch blocks log the raw `err` object:

```typescript
} catch (err) {
  console.error('[ws-handler] client:message error', err)
```

In TypeScript strict mode, `err` is `unknown`. The code works at runtime (console.error accepts `unknown`), but it prevents structured error logging. `err` could be a string, an object, or an Error instance.

**Severity:** LOW. Functional but not best practice.

---

## 3. Security Review

| Check | Status | Finding |
|-------|--------|---------|
| SQL injection risk | **FAIL** | String interpolation in `SET LOCAL app.tenant_id = '${tenantId}'` across 4 locations (ws-handler x3, tenant.middleware x1). Zod UUID validation mitigates but does not eliminate risk. |
| Parameterized queries in repositories | PASS | All repository queries use `$1, $2...` placeholders. No SQL injection risk in data queries. |
| Authentication on REST routes | PASS | JWT verified by `tenant.middleware`. Returns 401 on missing/invalid token. |
| Authentication on WebSocket (operator) | PASS | Operators provide `token` in handshake auth (validated by JWT). |
| Authentication on WebSocket (widget) | **FAIL** | Widget provides only `tenantId` (UUID). No token, no secret, no domain check. |
| Rate limiting (REST) | PARTIAL | `express-rate-limit` may be configured at server.ts level but not visible in chat-routes. |
| Rate limiting (WebSocket) | **FAIL** | Zero rate limiting on `client:message` or any other socket event. |
| Tenant isolation (RLS) | **FAIL** | RLS context (`SET LOCAL`) is set on a different connection than the one used by repositories. See Architecture Compliance FF-03. |
| XSS protection | PASS | React renders message content as text nodes (JSX `{msg.content}`), not `dangerouslySetInnerHTML`. |
| Input validation | PASS | Zod schemas enforce content length (1-10000), UUID format, enum values. |
| PII handling | PASS | No PII sent to external APIs. `contactEmail` stored locally. |
| Data residency (FF-10) | PASS | All data in PostgreSQL. No external API calls for WEB_CHAT channel. |
| No secrets in code | PASS | JWT_SECRET loaded from environment variable. |

---

## 4. Test Coverage Assessment

| Component | File | Tests | Coverage |
|-----------|------|:-----:|:--------:|
| ws-handler.ts | `src/conversation/infrastructure/ws-handler.ts` | 0 | 0% |
| chat-routes.ts | `src/conversation/infrastructure/chat-routes.ts` | 0 | 0% |
| dialog-repository.ts | `src/conversation/infrastructure/repositories/dialog-repository.ts` | 0 | 0% |
| message-repository.ts | `src/conversation/infrastructure/repositories/message-repository.ts` | 0 | 0% |
| dialog.ts (domain) | `src/conversation/domain/aggregates/dialog.ts` | 0 | 0% |
| message.ts (domain) | `src/conversation/domain/aggregates/message.ts` | 0 | 0% |
| sortDialogs (UI utility) | `tests/workspace/sort-dialogs.test.ts` | 8 | 100% |
| message-formatting (UI utility) | `tests/workspace/message-formatting.test.ts` | 13 | 100% |

**Total: 21 tests across 2 test files.** All tests cover UI utility logic. Zero backend tests for the 6 core implementation files.

The `sort-dialogs.test.ts` suite is well-written with edge cases (empty array, single item, mixed scenario). The `message-formatting.test.ts` tests are mostly trivial (testing static lookups and simple string operations).

**Domain layer (`canAssign`, `canClose`, `createDialog`, `createMessage`) has zero tests despite being pure functions that are trivial to test.** The Refinement document defines 32+ test scenarios across unit, integration, WebSocket, REST, and E2E levels -- none of which have been implemented.

---

## 5. Summary Scorecard

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| Architecture Compliance | 4/10 | FF-03 RLS violated (connection mismatch); FF-02 has 6 cross-BC imports; SET LOCAL outside transactions |
| Code Quality | 7/10 | Clean domain model, good Zod validation, but business rules not enforced, DB double-write |
| Test Coverage | 3/10 | 0% backend coverage. Only UI utility tests exist. 32+ defined scenarios unimplemented |
| Security | 3/10 | SQL injection in SET LOCAL, no widget auth, no WebSocket rate limiting, RLS not effective |
| Performance | 7/10 | Fire-and-forget pattern correct. No benchmarks or load tests. Paginated queries bounded |
| Documentation | 9/10 | Excellent SPARC docs. Honest about limitations. Matches implementation. Validation report thorough |

**Overall: 33/60 (55%)**

---

## 6. Blocking Issues (Must Fix Before Production)

### CRITICAL-01: RLS Context Not Applied to Repository Queries

**Location:** `src/conversation/infrastructure/ws-handler.ts` lines 99-102, `src/conversation/infrastructure/chat-routes.ts` lines 34-35
**Problem:** `SET LOCAL app.tenant_id` is executed on one pool connection; repository queries execute on a different pool connection. RLS is not effective.
**Fix:** Acquire a dedicated client per handler invocation. Pass it to repositories. Wrap in a transaction:

```typescript
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
  // pass client to repo methods instead of pool
  await client.query('COMMIT')
} finally {
  client.release()
}
```

For REST routes, use `req.dbClient` (already acquired by tenant middleware) instead of `pool`.

### CRITICAL-02: SQL Injection in SET LOCAL / SET Statements

**Location:** `ws-handler.ts` lines 99, 162, 210; `tenant.middleware.ts` line 44
**Problem:** String interpolation: `` `SET LOCAL app.tenant_id = '${tenantId}'` ``
**Fix:** Replace all instances with parameterized form: `SELECT set_config('app.tenant_id', $1, true)` using `[tenantId]` as parameter.

### HIGH-01: No WebSocket Rate Limiting (SH-03)

**Location:** `ws-handler.ts` -- `client:message` handler
**Problem:** Unlimited messages per socket. DoS vector via message spam.
**Fix:** Implement per-socket rate counter. Example with in-memory Map:

```typescript
const messageCounts = new Map<string, { count: number; resetAt: number }>()

socket.on('client:message', async (payload) => {
  const key = socket.id
  const now = Date.now()
  const entry = messageCounts.get(key) || { count: 0, resetAt: now + 60000 }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000 }
  entry.count++
  messageCounts.set(key, entry)
  if (entry.count > 10) {
    socket.emit('error', { code: 'RATE_LIMITED' })
    return
  }
  // ... proceed
})
```

For production, use Redis INCR + EXPIRE keyed on `externalChannelId`.

### HIGH-02: No Widget Authentication

**Location:** `ws-handler.ts` lines 70-74 -- connection handler
**Problem:** Widget sends raw `tenantId` with no verification. Anyone with a UUID can create dialogs.
**Fix:** Issue a short-lived widget token via a tenant settings endpoint. Verify the token on Socket.io connection using `nsp.use()` middleware.

---

## 7. Non-Blocking Issues (Should Fix)

1. **Enforce `canAssign()` business rule** in `assignOperator()` -- add `AND status = 'OPEN'` to the UPDATE WHERE clause.
2. **Fix DB double-write** on operator message send -- remove `MessageRepository.create()` from the `operator:message` socket handler; use socket emit for broadcast only.
3. **Add UNIQUE constraint** on `(tenant_id, external_id)` in `conversations.dialogs` to prevent race condition duplicates (EC-W2).
4. **Emit `dialog:status:changed`** from the `updateStatus` REST handler to notify connected widgets.
5. **Add unit tests** for `canAssign()`, `canClose()`, `createDialog()`, `createMessage()` -- pure functions, trivial to test.
6. **Add integration tests** for ws-handler and chat-routes covering the 32 scenarios defined in Refinement.

---

## 8. Overall Verdict

**APPROVED WITH CONDITIONS**

The feature delivers core functionality correctly: real-time bidirectional messaging, dialog lifecycle management, operator workspace integration, and PQL trigger pipeline. The SPARC documentation is thorough and honest about limitations. The domain model is clean and well-structured.

However, the feature has **two critical blocking issues** (RLS connection mismatch and SQL injection) and **two high-severity issues** (no rate limiting, no widget auth) that must be resolved before production deployment. The test coverage gap (0% backend) further compounds risk -- these security and isolation bugs would have been caught by the integration tests defined in the Refinement document.

**Conditions for full approval:**
1. Fix CRITICAL-01 (RLS connection mismatch) -- estimated 2-4 hours
2. Fix CRITICAL-02 (SQL injection in SET LOCAL) -- estimated 30 minutes
3. Fix HIGH-01 (WebSocket rate limiting) -- estimated 1-2 hours
4. Add at minimum: domain unit tests + RLS isolation integration test -- estimated 2-3 hours

Until these conditions are met, the feature should not be deployed to production with real tenant data.
