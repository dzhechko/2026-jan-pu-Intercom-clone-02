# Refinement: FR-04 Chat Widget
**Feature:** FR-04 Chat Widget
**BC:** BC-01 Conversation Context
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. Edge Cases

### EC-W1: Widget Reconnection — Dialog Room Rejoin

**Scenario:** Widget disconnects (network drop) and reconnects. The socket is new; the `dialog:{id}` room membership is lost.

**Risk:** Operator replies after reconnect are not delivered to the widget.

**Mitigation:**
- Widget stores `dialogId` in `localStorage` after first message.
- On reconnect, widget passes `dialogId` in `socket.handshake.auth`.
- `ws-handler` calls `socket.join(`dialog:${dialogId}`)` on connect if `dialogId` is present in auth.
- Socket.io exponential backoff (10 retries, 1s base delay) covers transient drops.

**Implemented:** `ws-handler.ts` line 83–85: `if (dialogId) { socket.join(`dialog:${dialogId}`) }`.

---

### EC-W2: Concurrent Messages — Race Condition on Dialog Create

**Scenario:** Two messages sent from the same widget session nearly simultaneously before the first `findOrExist` query returns. Two concurrent `findByExternalId` calls both return `null`, triggering two `create` calls with the same `externalChannelId`.

**Risk:** Duplicate dialogs created for the same session.

**Mitigation:**
- DB-level `UNIQUE` constraint or `INSERT ... ON CONFLICT` on `(tenant_id, external_id)` would be ideal.
- Current implementation uses sequential Socket.io event processing (Node.js event loop) which reduces but does not eliminate the race on high concurrency.
- Recommendation: add `UNIQUE(tenant_id, external_id)` index to `conversations.dialogs` and use `ON CONFLICT DO NOTHING RETURNING *` or application-level retry.

**Status:** Partial — Node.js single-threaded event loop mitigates in practice; DB constraint not yet added.

---

### EC-W3: Long Messages (> 10,000 chars)

**Scenario:** Client pastes a very long text.

**Mitigation:**
- Zod schema enforces `content: z.string().min(1).max(10_000)` on both `ClientMessageSchema` and `SendMessageSchema`.
- Server emits `error { code: 'INVALID_PAYLOAD' }` for violations.
- Widget UI should add a character counter and disable send button when limit is exceeded.

**Implemented:** Schema validation in `ws-handler.ts` and `chat-routes.ts`.

---

### EC-W4: Unicode and Emoji Content

**Scenario:** Messages contain emoji, RTL text, or multi-byte Unicode.

**Mitigation:**
- PostgreSQL `TEXT` column handles arbitrary Unicode natively.
- `content.length` in JS counts UTF-16 code units, not grapheme clusters. A single emoji like `🧑‍💻` may count as 5 length units. The 10,000 limit is generous enough.
- Widget and workspace render content with `whitespace-pre-wrap break-words` CSS to handle wrapping.

**Implemented:** `ChatArea.tsx` line 157.

---

### EC-W5: XSS via Message Content

**Scenario:** Client sends `<script>alert('xss')</script>` or similar as message content.

**Risk:** If content is rendered as raw HTML in the operator workspace or future widget UI, script execution occurs.

**Mitigation:**
- React renders all content as text nodes by default (JSX `{msg.content}` — not `dangerouslySetInnerHTML`).
- Content stored as plain text in PostgreSQL `TEXT` column.
- Widget must also use text rendering, not innerHTML.
- Recommendation: add server-side DOMPurify sanitization as defense-in-depth before storage.

**Implemented:** React text rendering in `ChatArea.tsx`. DOMPurify not yet added.

---

### EC-W6: Message Deduplication

**Scenario:** Operator sends via REST and simultaneously emits `operator:message` via socket. Two separate `message:new` events arrive with different IDs; or REST response and socket broadcast carry the same message ID.

**Current behavior:**
- REST `POST /:id/messages` persists message and returns `{ message }`.
- `useMessages.sendMessage()` also emits `operator:message` via socket.
- Socket broadcast carries the same content but triggers a second persist in `ws-handler`.

**Risk:** Duplicate messages stored in DB and shown in UI.

**Mitigation (UI):**
- `useMessages` deduplicates by `message.id` before appending: `if (prev.some(m => m.id === data.message.id)) return prev`.

**Mitigation (DB):**
- The `operator:message` socket path also calls `MessageRepository.create`, which generates a new UUID. Two rows are created.
- Recommendation: on operator send, use REST only for persistence; socket emit should be for broadcast only (no DB write on `operator:message`). This is a known architectural debt.

**Status:** UI deduplication implemented. DB double-write risk exists — tracked as architectural debt.

---

### EC-W7: Stale Dialog State After Status Change

**Scenario:** Dialog is CLOSED via REST PATCH while the widget socket is still connected.

**Risk:** Widget continues to allow sending messages to a CLOSED dialog.

**Mitigation:**
- Widget should listen for `dialog:assigned` / a future `dialog:closed` event and update its UI state.
- Server does not currently emit a `dialog:closed` event; the PATCH endpoint updates DB only.
- Recommendation: emit `dialog:status:changed` from `updateStatus` handler to `dialog:{id}` room.

**Status:** Not implemented — tracked as enhancement for v1.1.

---

### EC-W8: Widget Sending Messages to Non-Existent Dialog (Resuming Stale dialogId)

**Scenario:** Client reconnects with a `dialogId` from a previous session that has been CLOSED or ARCHIVED.

**Risk:** `socket.join` succeeds, but any new `client:message` finds the existing dialog (closed) and creates a new one. The widget room assignment may be inconsistent.

**Mitigation:**
- `findOrCreateDialog` uses `externalChannelId` (not `dialogId`) to look up the dialog.
- Even if a closed dialog exists, a new message creates a new dialog with the same `externalChannelId` (subject to uniqueness constraints — see EC-W2).
- The `dialogId` in auth is only used for room membership, not for dialog lookup on `client:message`.

---

## 2. Rate Limiting

**Requirement (SH-03):** 10 messages per minute per widget session.

**Implementation target:**
```typescript
// express-rate-limit with Redis store, keyed on externalChannelId
// Apply to WebSocket message events at the session level
rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.externalChannelId,
  store: new RedisStore({ client: redisClient }),
})
```

**Current status:** Rate limit defined in SH-03 but not yet applied to WebSocket events (REST API uses express-rate-limit at route level). WebSocket-level rate limiting requires custom middleware on Socket.io events.

**Recommendation:** Add a per-socket message counter with a 60-second sliding window reset using `ioredis` INCR + EXPIRE.

---

## 3. Security Edge Cases

### S-W1: Unauthorized tenantId in Client Message

**Scenario:** Malicious widget sends a `client:message` with an arbitrary `tenantId` to write data into another tenant's dialog.

**Mitigation:**
- For operator actions: JWT middleware enforces `tenantId` from token.
- For widget `client:message`: `tenantId` is passed in payload (unauthenticated). RLS (`SET LOCAL app.tenant_id`) protects the DB, but data is written under the provided `tenantId`.
- A malicious actor could create dialogs under any `tenantId` they know.
- **Recommendation:** Widget connections should use a short-lived widget token (issued by tenant settings API) rather than a raw `tenantId`. The token verifies that the embedding domain is allowed for the tenant.

**Status:** Not implemented in v1 — tracked as SH-W1 security enhancement.

### S-W2: PII in Metadata

**Scenario:** Widget passes sensitive PII (SSN, bank account) in `metadata`.

**Mitigation:**
- `metadata` is stored as JSONB and is visible to operators.
- Widget documentation must specify which metadata fields are allowed.
- v2 enhancement: SpaCy NER masking on metadata values before storage (SH-02).

---

## 4. Testing Strategy

### Unit Tests

| Test | Target | Assertion |
|------|--------|-----------|
| Dialog aggregate: `canAssign` | Returns true only for OPEN | Status = ASSIGNED → false |
| Dialog aggregate: `canClose` | Returns true for OPEN, ASSIGNED | Returns false for CLOSED, ARCHIVED |
| Dialog factory: `createDialog` | Defaults to OPEN status | Default status is 'OPEN' |
| Message factory: `createMessage` | Default empty arrays | attachments=[], pqlSignals=[] |
| `sortDialogs` | HOT before WARM before COLD | Correct tier order |
| `sortDialogs` | Same tier: newest first | Time-based secondary sort |

### Integration Tests (DB)

| Test | Assertion |
|------|-----------|
| Create dialog, find by external ID | Returns same record |
| Create two dialogs with same externalId, different tenant | Both found; RLS isolates |
| Assign operator on OPEN dialog | Status becomes ASSIGNED, operator_id set |
| Update dialog status to CLOSED | Status updated, updatedAt refreshed |
| Message pagination | `hasMore: true` when offset + limit < total |
| RLS isolation (FF-03) | Tenant A cannot see tenant B dialogs |

### WebSocket Integration Tests

| Test | Assertion |
|------|-----------|
| `client:message` with valid payload | message:new emitted to sender + tenant room |
| `client:message` with invalid payload | error emitted with INVALID_PAYLOAD |
| `client:message` — second message same session | No new dialog created; existing dialog found |
| `operator:message` to non-existent dialog | error emitted with DIALOG_NOT_FOUND |
| `dialog:assign` | dialog:assigned emitted to tenant + dialog rooms |
| `typing CLIENT` | Forwarded to tenant room only |
| `typing OPERATOR` | Forwarded to dialog room only |

### REST API Tests

| Endpoint | Test | Expected |
|----------|------|----------|
| GET /api/dialogs | No auth | 401 |
| GET /api/dialogs | Valid token | 200 + dialogs array |
| GET /api/dialogs/:id/messages | Unknown dialog | 404 |
| POST /api/dialogs/:id/messages | Empty content | 400 |
| POST /api/dialogs/:id/messages | Content > 10000 chars | 400 |
| PATCH /api/dialogs/:id/status | Invalid status value | 400 |
| PATCH /api/dialogs/:id/status | Unknown dialog | 404 |

### E2E Tests

| Journey | Assertion |
|---------|-----------|
| Widget sends first message → operator sees dialog | dialog:created received in tenant room < 500ms |
| Operator replies → widget receives | message:new received in dialog room < 500ms |
| Widget reconnects with dialogId → operator reply still delivered | Socket joins dialog room on reconnect |
| Dialog closed → status = CLOSED | PATCH returns updated dialog |

---

## 5. Performance Considerations

| Concern | Target | Mitigation |
|---------|--------|------------|
| Dialog list query | < 50 ms | `idx_dialogs_tenant_status` covers `WHERE tenant_id = $1 AND status IN (...)` |
| Message history query | < 50 ms | `idx_messages_dialog` covers `WHERE dialog_id = $1` |
| WebSocket broadcast | < 10 ms | Socket.io in-memory rooms; no DB on broadcast |
| Find-or-create dialog | < 100 ms | `idx_dialogs_tenant_status` + unique external_id lookup |
| PQL analysis (non-blocking) | < 2000 ms p95 | Fire-and-forget; does not affect message delivery latency |

---

## 6. Known Limitations (v1)

| ID | Limitation | Planned Fix |
|----|-----------|-------------|
| LIM-W1 | No file/attachment support in widget | v2 — S3/MinIO upload endpoint |
| LIM-W2 | No offline message queue (client) | v2 — IndexedDB buffer |
| LIM-W3 | No bot auto-reply | v2 — RAG MCP integration |
| LIM-W4 | Widget embed is conceptual (no widget.js build) | v1.1 — dedicated widget bundle |
| LIM-W5 | No `dialog:closed` WS event from PATCH endpoint | v1.1 — emit from updateStatus |
| LIM-W6 | No widget-level auth token | v1.1 — SH-W1 security enhancement |
| LIM-W7 | WS rate limiting not enforced | v1.1 — Redis-based per-session counter |
| LIM-W8 | DB double-write on operator send | v1.1 — socket broadcast without DB on operator:message |
