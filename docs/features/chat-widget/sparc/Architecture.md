# Architecture: FR-04 Chat Widget
**Feature:** FR-04 Chat Widget
**BC:** BC-01 Conversation Context
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. C4 Level 1 — System Context

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
│                                                              │
│  ┌──────────────┐    WebSocket (wss)    ┌────────────────┐  │
│  │  Client      │◀────────────────────▶│                │  │
│  │  Browser     │    HTTPS REST        │   КоммуниК      │  │
│  │  (Widget)    │◀────────────────────▶│   Platform      │  │
│  └──────────────┘                      │                │  │
│                                        │  (Russian VPS) │  │
│  ┌──────────────┐    HTTPS REST        │                │  │
│  │  Operator    │◀────────────────────▶│                │  │
│  │  Browser     │    WebSocket (wss)   │                │  │
│  │  (Workspace) │◀────────────────────▶└────────────────┘  │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. C4 Level 2 — Container View

```
┌─────────────────────────────────────────────────────────────┐
│                    КоммуниК Platform (VPS)                   │
│                                                              │
│  ┌───────────────────┐       ┌───────────────────────────┐  │
│  │  Next.js Frontend  │       │  Express API (port 4000)  │  │
│  │  (port 3000)       │       │                           │  │
│  │                    │──────▶│  /api/dialogs  (REST)     │  │
│  │  /app/(workspace)  │       │  /chat         (WS)       │  │
│  │  /app/api/proxy    │       │                           │  │
│  └───────────────────┘       └───────────────┬───────────┘  │
│                                               │               │
│                               ┌───────────────▼───────────┐  │
│                               │  PostgreSQL 16             │  │
│                               │  schema: conversations     │  │
│                               │    dialogs + messages      │  │
│                               │  RLS enabled               │  │
│                               └───────────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Redis 7 (Streams + Pub/Sub)                         │    │
│  │  Stream: MessageReceived → PQL Consumer              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. C4 Level 3 — Component View (BC-01 Conversation)

```
BC-01 Conversation Context
──────────────────────────────────────────────────────────────

┌──────────────────────────────────────────────────────────┐
│  Infrastructure Layer                                     │
│                                                           │
│  ┌────────────────────┐   ┌────────────────────────────┐ │
│  │  ws-handler.ts      │   │  chat-routes.ts             │ │
│  │  (Socket.io /chat)  │   │  (REST /api/dialogs)        │ │
│  │                     │   │                             │ │
│  │  registerChat       │   │  GET /                      │ │
│  │  Namespace()        │   │  GET /:id/messages          │ │
│  │                     │   │  POST /:id/messages         │ │
│  │  Events:            │   │  PATCH /:id/status          │ │
│  │  client:message     │   └──────────┬──────────────────┘ │
│  │  operator:message   │              │                    │
│  │  dialog:assign      │              │                    │
│  │  typing             │              │                    │
│  └────────┬────────────┘              │                    │
│           │                           │                    │
│  ┌────────▼───────────────────────────▼──────────────────┐ │
│  │  Repositories                                          │ │
│  │  DialogRepository   MessageRepository                  │ │
│  │  ─────────────────  ──────────────────                 │ │
│  │  create()           create()                           │ │
│  │  findById()         findByDialogId()                   │ │
│  │  findByExternalId() findLatestByDialogId()             │ │
│  │  findOpenByTenant()                                    │ │
│  │  updateStatus()                                        │ │
│  │  assignOperator()                                      │ │
│  │  updatePQLScore()                                      │ │
│  └────────┬───────────────────────────────────────────────┘ │
└───────────┼───────────────────────────────────────────────┘
            │
┌───────────▼───────────────────────────────────────────────┐
│  Domain Layer                                              │
│                                                            │
│  ┌────────────────────┐   ┌─────────────────────────────┐ │
│  │  Dialog aggregate   │   │  Message value object       │ │
│  │  ─────────────────  │   │  ────────────────────────── │ │
│  │  ChannelType        │   │  MessageDirection            │ │
│  │  DialogStatus       │   │  SenderType                 │ │
│  │  PQLTier            │   │  Message interface           │ │
│  │  Dialog interface   │   │  CreateMessageParams        │ │
│  │  createDialog()     │   │  createMessage()            │ │
│  │  canAssign()        │   └─────────────────────────────┘ │
│  │  canClose()         │                                   │
│  └────────────────────┘                                   │
└────────────────────────────────────────────────────────────┘
```

---

## 4. WebSocket Architecture

### Room Strategy (ADR-005, PO-03)

```
Socket.io Namespace: /chat
│
├─ Room: tenant:{tenantId}
│    Members: all operators of a tenant
│    Events received: message:new, dialog:created, dialog:assigned, typing (CLIENT), pql:detected
│
├─ Room: operator:{operatorId}
│    Members: a single operator's socket(s)
│    Events received: direct operator notifications
│
└─ Room: dialog:{dialogId}
     Members: the client widget socket for this dialog
     Events received: message:new (operator reply), dialog:assigned, typing (OPERATOR)
```

### Message Flow (Widget → Operator)

```
Widget Browser              Express Server              Operator Browser
─────────────               ──────────────              ─────────────────
emit('client:message')
      │
      ├─ Zod validate
      ├─ RLS: SET LOCAL app.tenant_id
      ├─ findOrCreate dialog
      ├─ MessageRepository.create()
      ├─ socket.join(dialog:{id})
      ├─ emit('message:new') ──────────────────────────▶ [dialog room] widget ACK
      ├─ emit('message:new') ──────────────────────────▶ [tenant room] operator sees
      └─ analyzePQLInline() (fire-and-forget)
                                                                │
                                                         operator selects dialog
                                                         emit('operator:message')
                                │                               │
                                ├─ Zod validate                │
                                ├─ findById dialog             │
                                ├─ MessageRepository.create()  │
                                ├─ emit('message:new') ────────▶ [dialog room] widget
                                └─ emit('message:new') ─▶ [tenant room] other operators
```

### Connection Auth Flow

```
Operator:  io('/chat', { auth: { token, tenantId, operatorId } })
           → join tenant:{tenantId}, operator:{operatorId}

Widget:    io('/chat', { auth: { tenantId } })
           → no rooms initially; joins dialog:{id} after first message

Widget     io('/chat', { auth: { tenantId, dialogId } })
resume:    → joins dialog:{dialogId} immediately on connect
```

---

## 5. Layer Dependency Map

```
Next.js UI (app/(workspace)/)
  │
  ├── useSocket.ts         → Socket.io client → Express /chat namespace
  ├── useDialogs.ts        → REST GET /api/proxy/dialogs
  ├── useMessages.ts       → REST GET/POST /api/proxy/dialogs/:id/messages
  │                           + listens to message:new, typing via socket
  └── WorkspacePage.tsx    → orchestrates hooks, renders 3-column layout

Express API (src/conversation/infrastructure/)
  │
  ├── ws-handler.ts        → Socket.io, uses DialogRepository + MessageRepository
  │                           → fires analyzePQLInline (BC-02, non-blocking)
  │                           → fires forwardToTelegramIfNeeded (BC-04)
  │                           → fires forwardToVKMaxIfNeeded (BC-04)
  │
  ├── chat-routes.ts       → REST handlers, uses DialogRepository + MessageRepository
  │                           → fires forwardToTelegramIfNeeded (BC-04)
  │                           → fires forwardToVKMaxIfNeeded (BC-04)
  │
  ├── DialogRepository     → PostgreSQL conversations.dialogs (RLS)
  └── MessageRepository    → PostgreSQL conversations.messages (RLS)
```

---

## 6. Cross-BC Dependencies

| From (BC-01) | To | Mechanism | Pattern |
|---|---|---|---|
| ws-handler | BC-02 PQL Intelligence | `analyzePQLInline()` call | Fire-and-forget; no BC import — imported from `@pql/infrastructure/message-consumer` |
| ws-handler | BC-04 Integration | `forwardToTelegramIfNeeded()` | Fire-and-forget; no-op for WEB_CHAT |
| ws-handler | BC-04 Integration | `forwardToVKMaxIfNeeded()` | Fire-and-forget; no-op for WEB_CHAT |
| ws-handler | BC-06 Notifications | `notificationService.notify()` | Via injected `NotificationService` |
| All handlers | BC-05 IAM | `tenant.middleware` JWT check | Conformist — middleware applied at router level |

Note: BC-01 does NOT import domain types from other BCs. Cross-BC communication passes through shared ports and injected services, per FF-02.

---

## 7. API Proxy Architecture

The Next.js frontend and Express backend run as separate processes. The proxy route avoids CORS issues:

```
Browser → Next.js /api/proxy/[...path] → Express /api/[path]
```

- `GET /api/proxy/dialogs` → `GET http://localhost:4000/api/dialogs`
- `POST /api/proxy/dialogs/:id/messages` → `POST http://localhost:4000/api/dialogs/:id/messages`

Headers forwarded: `Authorization`, `Content-Type`.
Query params forwarded verbatim.
On Express error (502): NextResponse returns `{ error: 'API server unavailable' }`.

Socket.io connections are direct (`NEXT_PUBLIC_API_URL` env var → `http://localhost:4000`) because WebSocket upgrades cannot be proxied through a Next.js API route.

---

## 8. Reconnection Strategy

Socket.io client (`useSocket.ts`):
```typescript
{
  transports: ['websocket', 'polling'],  // WebSocket preferred; falls back to polling
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,              // 1s base delay (exponential by socket.io)
}
```

On reconnect:
- Operator: re-joins `tenant:{tenantId}` and `operator:{operatorId}` rooms automatically.
- Widget: must re-emit `client:message` or pass `dialogId` in auth to re-join dialog room.

---

## 9. Fitness Function Compliance

| FF | Requirement | How Chat Widget Satisfies |
|----|-------------|--------------------------|
| FF-01 | PQL detection < 2000 ms p95 | `analyzePQLInline` is fire-and-forget; does not block message delivery |
| FF-02 | No cross-BC imports | BC-01 only imports `@pql` via injected service; `@integration` adapters are imported but are infrastructure-level, not domain |
| FF-03 | Tenant RLS isolation 100% | `SET LOCAL app.tenant_id` before every DB query; RLS policy on dialogs + messages |
| FF-04 | Circuit Breaker on MCP adapters | Channel forwarding (Telegram, VK Max) goes through BC-04 adapters with Circuit Breaker |
| FF-08 | Redis Stream lag < 1000 | WebSocket events are synchronous; Redis Streams used for async PQL events only |
| FF-10 | Data residency | All data written to PostgreSQL on Russian VPS; no external API calls for WEB_CHAT |
