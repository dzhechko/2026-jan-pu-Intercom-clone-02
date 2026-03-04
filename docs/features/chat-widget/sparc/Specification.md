# Specification: FR-04 Chat Widget
**Feature:** FR-04 Chat Widget
**BC:** BC-01 Conversation Context
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. Scope

This document specifies the technical contract for FR-04: the real-time chat widget, its Socket.io event protocol, REST API endpoints, widget embedding mechanism, and the dialog lifecycle managed by BC-01.

---

## 2. Component Inventory

| Component | Path | Role |
|-----------|------|------|
| WebSocket handler | `src/conversation/infrastructure/ws-handler.ts` | Socket.io namespace `/chat` |
| Chat REST routes | `src/conversation/infrastructure/chat-routes.ts` | REST API mounted at `/api/dialogs` |
| Dialog aggregate | `src/conversation/domain/aggregates/dialog.ts` | Domain model + business rules |
| Message aggregate | `src/conversation/domain/aggregates/message.ts` | Value object + factory |
| Dialog repository | `src/conversation/infrastructure/repositories/dialog-repository.ts` | PostgreSQL persistence |
| Message repository | `src/conversation/infrastructure/repositories/message-repository.ts` | PostgreSQL persistence |
| Operator Workspace | `app/(workspace)/` | Next.js operator UI (uses the widget API) |
| Socket hook | `app/(workspace)/hooks/useSocket.ts` | Manages Socket.io connection in Next.js |
| Messages hook | `app/(workspace)/hooks/useMessages.ts` | Fetch history + real-time updates |
| Dialogs hook | `app/(workspace)/hooks/useDialogs.ts` | Fetch dialog list + real-time updates |
| API Proxy | `app/api/proxy/[...path]/route.ts` | Next.js → Express proxy (avoids CORS) |

---

## 3. Socket.io Protocol

### Namespace

```
/chat
```

### Connection Authentication

Clients connect with `socket.handshake.auth`:

```typescript
// Operator connection
{ token: string, tenantId: string, operatorId: string }

// Widget (client) connection — new dialog
{ tenantId: string }

// Widget (client) connection — resuming dialog
{ tenantId: string, dialogId: string }
```

Room membership on connect:
- Operator: joins `tenant:{tenantId}` and `operator:{operatorId}`
- Widget resuming: joins `dialog:{dialogId}`

---

### Events: Client (Widget) → Server

#### `client:message`

Sent by the widget when the end-user submits a message.

```typescript
// Payload (Zod-validated)
{
  tenantId: string          // UUID — which tenant's widget
  content: string           // 1–10,000 chars
  externalChannelId: string // stable widget session ID (min 1 char)
  contactEmail?: string     // optional — used for Memory AI CRM lookup
  metadata?: Record<string, unknown> // optional — page URL, product plan, etc.
}
```

Server behavior:
1. Validate payload with `ClientMessageSchema` (Zod).
2. `SET LOCAL app.tenant_id` for RLS.
3. `DialogRepository.findByExternalId(tenantId, externalChannelId)` — find or create dialog.
4. If new: `DialogRepository.create({ channelType: 'WEB_CHAT', ... })` → emit `dialog:created` to `tenant:{tenantId}`.
5. `MessageRepository.create({ direction: 'INBOUND', senderType: 'CLIENT', ... })`.
6. `socket.join(`dialog:{dialog.id}`)`.
7. Emit `message:new` to widget (receipt confirmation).
8. Emit `message:new` to `tenant:{tenantId}` (operator workspace update).
9. Fire-and-forget: `analyzePQLInline(pqlDetector, nsp, pqlEvent, notificationService)`.

---

#### `operator:message`

Sent by the operator workspace when the operator types a reply.

```typescript
// Payload (Zod-validated)
{
  dialogId: string   // UUID
  tenantId: string   // UUID
  content: string    // 1–10,000 chars
}
```

Server behavior:
1. Validate. Find dialog. If not found → emit `error { code: 'DIALOG_NOT_FOUND' }`.
2. `MessageRepository.create({ direction: 'OUTBOUND', senderType: 'OPERATOR', ... })`.
3. Emit `message:new` to `dialog:{dialogId}` (widget receives reply).
4. Emit `message:new` to `tenant:{tenantId}` (all operators see it).
5. Fire-and-forget: `forwardToTelegramIfNeeded` (no-op for WEB_CHAT).
6. Fire-and-forget: `forwardToVKMaxIfNeeded` (no-op for WEB_CHAT).

---

#### `dialog:assign`

Sent by an operator to claim a dialog.

```typescript
// Payload (Zod-validated)
{
  dialogId: string   // UUID
  tenantId: string   // UUID
  operatorId: string // UUID
}
```

Server behavior:
1. Validate. `DialogRepository.assignOperator(dialogId, operatorId)` — sets `status = ASSIGNED`.
2. Emit `dialog:assigned` to `tenant:{tenantId}`.
3. Emit `dialog:assigned` to `dialog:{dialogId}` (widget can optionally display "Agent assigned").

---

#### `typing`

Bidirectional typing indicator.

```typescript
// Payload (Zod-validated)
{
  dialogId: string
  tenantId: string
  isTyping: boolean
  senderType: 'CLIENT' | 'OPERATOR'
}
```

Server behavior:
- `senderType = CLIENT`: forward to `tenant:{tenantId}`.
- `senderType = OPERATOR`: forward to `dialog:{dialogId}`.

---

### Events: Server → Client

| Event | Room Target | Payload |
|-------|-------------|---------|
| `message:new` | `dialog:{id}` and `tenant:{id}` | `{ message: Message, dialogId?: string, dialog?: Dialog }` |
| `dialog:created` | `tenant:{tenantId}` | `{ dialog: Dialog }` |
| `dialog:assigned` | `tenant:{id}` and `dialog:{id}` | `{ dialog: Dialog }` |
| `typing` | `tenant:{id}` or `dialog:{id}` | `{ dialogId, isTyping, senderType }` |
| `pql:detected` | `tenant:{tenantId}` | `{ dialogId, score, tier, topSignals }` |
| `error` | sender socket | `{ code: string, details?: object }` |

---

## 4. REST API Specification

Base path: `/api/dialogs` (Express router mounted in `server.ts`)
Authentication: `Authorization: Bearer {JWT}` — validated by `tenant.middleware`.

### GET `/api/dialogs`

List open/assigned dialogs for the authenticated operator's tenant.

**Query params:**
```
limit:  integer 1–100, default 50
offset: integer >= 0, default 0
```

**Response 200:**
```json
{
  "dialogs": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "channelType": "WEB_CHAT",
      "externalChannelId": "session-abc-123",
      "status": "OPEN",
      "assignedOperatorId": null,
      "contactEmail": "user@example.com",
      "pqlScore": 0.72,
      "pqlTier": "WARM",
      "metadata": {},
      "createdAt": "2026-03-04T10:00:00Z",
      "updatedAt": "2026-03-04T10:01:00Z"
    }
  ]
}
```

**Filtering:** Only `status IN ('OPEN', 'ASSIGNED')`, ordered by `updated_at DESC`. RLS enforces tenant isolation.

---

### GET `/api/dialogs/:id/messages`

Paginated message history for a dialog.

**Query params:**
```
limit:  integer 1–100, default 50
offset: integer >= 0, default 0
```

**Response 200:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "dialogId": "uuid",
      "tenantId": "uuid",
      "direction": "INBOUND",
      "senderType": "CLIENT",
      "content": "Do you have an Enterprise plan?",
      "attachments": [],
      "pqlSignals": [],
      "createdAt": "2026-03-04T10:00:00Z"
    }
  ],
  "total": 42,
  "hasMore": false
}
```

Messages sorted `created_at ASC` (chronological order for display).

---

### POST `/api/dialogs/:id/messages`

Operator sends a message (REST path — used for reliable delivery alongside Socket.io emit).

**Request body:**
```json
{
  "content": "Yes, we have Enterprise plans starting at ₽15,000/mo.",
  "senderType": "OPERATOR"
}
```

Validation: `SendMessageSchema` — `content` 1–10,000 chars; `senderType` in `['OPERATOR', 'BOT']`, default `OPERATOR`.

**Response 201:**
```json
{
  "message": { ...Message }
}
```

Side effects (fire-and-forget):
- `forwardToTelegramIfNeeded` — forwards if dialog is `TELEGRAM` channel.
- `forwardToVKMaxIfNeeded` — forwards if dialog is `VK_MAX` channel.

---

### PATCH `/api/dialogs/:id/status`

Update dialog status.

**Request body:**
```json
{ "status": "CLOSED" }
```

Valid values: `OPEN | ASSIGNED | CLOSED | ARCHIVED`.

**Response 200:**
```json
{ "dialog": { ...Dialog } }
```

---

## 5. Dialog Lifecycle State Machine

```
                    ┌─────────┐
     [first message]│         │
  ──────────────────▶  OPEN   │
                    │         │
                    └────┬────┘
                         │ dialog:assign (operator claims)
                         ▼
                    ┌─────────┐
                    │ASSIGNED │
                    └────┬────┘
                         │ PATCH /status CLOSED
                    ┌────▼────┐
                    │ CLOSED  │
                    └────┬────┘
                         │ admin archive
                    ┌────▼────┐
                    │ARCHIVED │
                    └─────────┘
```

Business rules (domain layer):
- `canAssign(dialog)`: returns true only when `status === 'OPEN'`
- `canClose(dialog)`: returns true when `status !== 'CLOSED' && status !== 'ARCHIVED'`

---

## 6. Data Models

### Dialog (conversations.dialogs)

```sql
id             UUID PRIMARY KEY
tenant_id      UUID NOT NULL → iam.tenants(id)
channel_type   VARCHAR(20)  -- 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
external_id    VARCHAR(255) -- widget session ID / Telegram chat_id / VK peer_id
status         VARCHAR(20)  -- 'OPEN' | 'ASSIGNED' | 'CLOSED' | 'ARCHIVED'
operator_id    UUID         -- nullable → iam.operators(id)
contact_email  VARCHAR(255) -- nullable, used for Memory AI
pql_score      NUMERIC(3,2) -- 0.00–1.00
pql_tier       VARCHAR(10)  -- 'HOT' | 'WARM' | 'COLD'
metadata       JSONB
created_at     TIMESTAMPTZ
updated_at     TIMESTAMPTZ
```

Indexes:
- `idx_dialogs_tenant_status ON (tenant_id, status)`
- `idx_dialogs_pql_tier ON (tenant_id, pql_tier) WHERE pql_tier IS NOT NULL`

RLS policy: `tenant_id = current_setting('app.tenant_id')::UUID`

---

### Message (conversations.messages)

```sql
id           UUID PRIMARY KEY
dialog_id    UUID NOT NULL → conversations.dialogs(id)
tenant_id    UUID NOT NULL
direction    VARCHAR(10)  -- 'INBOUND' | 'OUTBOUND'
sender_type  VARCHAR(10)  -- 'CLIENT' | 'OPERATOR' | 'BOT'
content      TEXT NOT NULL
attachments  JSONB DEFAULT '[]'
pql_signals  JSONB DEFAULT '[]'  -- [{signalId, type, weight}]
created_at   TIMESTAMPTZ
```

Index: `idx_messages_dialog ON (dialog_id)`
RLS policy: `tenant_id = current_setting('app.tenant_id')::UUID`

---

## 7. Rate Limiting

Per SH-03, the widget's inbound message rate is limited to **10 messages per minute per session**. Implementation target: `express-rate-limit` with Redis store keyed on `externalChannelId`. This protects the DB and PQL pipeline from spam.

---

## 8. Widget Embedding (Conceptual)

The widget is served by the Next.js frontend. Tenant embedding uses a JS snippet:

```html
<!-- Add to tenant's website -->
<script>
  window.KommuniQConfig = {
    tenantId: 'YOUR_TENANT_UUID',
    contactEmail: currentUser?.email,       // optional
    metadata: { plan: currentUser?.plan }   // optional
  };
</script>
<script async src="https://app.kommuniq.ru/widget.js"></script>
```

The widget JS:
1. Generates a stable `externalChannelId` (stored in `localStorage` / `sessionStorage`).
2. Connects to `/chat` Socket.io namespace with `tenantId` from config.
3. Optionally passes `dialogId` if resuming a previous session.
4. Applies `customBranding` fetched from tenant settings API.

---

## 9. Zod Validation Schemas (Implemented)

```typescript
// client:message
ClientMessageSchema = z.object({
  tenantId: z.string().uuid(),
  content: z.string().min(1).max(10_000),
  externalChannelId: z.string().min(1),
  contactEmail: z.string().email().optional(),
  metadata: z.record(z.unknown()).optional(),
})

// operator:message
OperatorMessageSchema = z.object({
  dialogId: z.string().uuid(),
  tenantId: z.string().uuid(),
  content: z.string().min(1).max(10_000),
})

// dialog:assign
DialogAssignSchema = z.object({
  dialogId: z.string().uuid(),
  tenantId: z.string().uuid(),
  operatorId: z.string().uuid(),
})

// typing
TypingSchema = z.object({
  dialogId: z.string().uuid(),
  tenantId: z.string().uuid(),
  isTyping: z.boolean(),
  senderType: z.enum(['CLIENT', 'OPERATOR']),
})

// REST SendMessage
SendMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
  senderType: z.enum(['OPERATOR', 'BOT']).default('OPERATOR'),
})
```
