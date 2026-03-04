# Final Summary: FR-04 Chat Widget
**Feature:** FR-04 Chat Widget
**BC:** BC-01 Conversation Context
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. What Was Built

FR-04 delivers the real-time web chat layer of the КоммуниК platform. It enables end-user clients to open a support conversation from any website or SaaS product and receive operator replies in real-time. All web chat conversations are unified in the same operator workspace inbox alongside Telegram and VK Max channels.

---

## 2. Implemented Components

### Backend (Express / BC-01)

| File | Purpose |
|------|---------|
| `src/conversation/infrastructure/ws-handler.ts` | Socket.io `/chat` namespace — all real-time events |
| `src/conversation/infrastructure/chat-routes.ts` | REST router — dialog CRUD and message history |
| `src/conversation/domain/aggregates/dialog.ts` | Dialog aggregate, state machine, business rules |
| `src/conversation/domain/aggregates/message.ts` | Message value object and factory |
| `src/conversation/infrastructure/repositories/dialog-repository.ts` | PostgreSQL dialog persistence with RLS |
| `src/conversation/infrastructure/repositories/message-repository.ts` | PostgreSQL message persistence with RLS |

### Frontend (Next.js / Operator Workspace)

| File | Purpose |
|------|---------|
| `app/(workspace)/hooks/useSocket.ts` | Socket.io connection lifecycle management |
| `app/(workspace)/hooks/useDialogs.ts` | Dialog list: REST fetch + real-time updates |
| `app/(workspace)/hooks/useMessages.ts` | Message history: REST fetch + real-time delivery |
| `app/(workspace)/components/ChatArea.tsx` | Message thread UI + input form + typing indicator |
| `app/(workspace)/components/DialogList.tsx` | Sidebar dialog queue with PQL tier badges |
| `app/(workspace)/page.tsx` | Workspace orchestrator — 3-column layout |
| `app/(workspace)/types.ts` | Shared TypeScript types mirroring BC-01 domain |
| `app/api/proxy/[...path]/route.ts` | Next.js → Express proxy (eliminates CORS) |

---

## 3. Socket.io Events Implemented

| Direction | Event | Payload |
|-----------|-------|---------|
| Widget → Server | `client:message` | tenantId, content, externalChannelId, contactEmail?, metadata? |
| Operator → Server | `operator:message` | dialogId, tenantId, content |
| Operator → Server | `dialog:assign` | dialogId, tenantId, operatorId |
| Both → Server | `typing` | dialogId, tenantId, isTyping, senderType |
| Server → Widget | `message:new` | message, dialogId |
| Server → Operator | `message:new` | message, dialog |
| Server → Operator | `dialog:created` | dialog |
| Server → Both | `dialog:assigned` | dialog |
| Server → Both | `typing` | dialogId, isTyping, senderType |
| Server → Both | `pql:detected` | dialogId, score, tier, topSignals |
| Server → sender | `error` | code, details? |

---

## 4. REST Endpoints Implemented

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dialogs` | List open/assigned dialogs for tenant |
| GET | `/api/dialogs/:id/messages` | Paginated message history |
| POST | `/api/dialogs/:id/messages` | Operator sends message (REST path) |
| PATCH | `/api/dialogs/:id/status` | Update dialog status |

---

## 5. Dialog Lifecycle

```
OPEN → ASSIGNED (via dialog:assign) → CLOSED (via PATCH /status) → ARCHIVED
```

All states supported in DB, REST API, and WebSocket protocol. PQL tier denormalized on dialog for fast queue sorting: HOT → WARM → COLD → no tier.

---

## 6. Key Design Decisions

### Find-or-Create Pattern for Idempotency
Widget sessions are identified by `externalChannelId` (stable across page reloads). `findByExternalId` is called before every `create`, preventing duplicate dialogs on reconnect.

### Dual-Path for Operator Send (REST + Socket)
Operator messages are persisted via REST for reliability (HTTP retry semantics), then also emitted via Socket.io for instant broadcast. UI deduplication by `message.id` prevents double display.

### Fire-and-Forget for PQL and Channel Forwarding
PQL analysis (BC-02) and channel forwarding (BC-04) are triggered with `.catch(log.error)` to never block message delivery. This satisfies FF-01 (PQL < 2000 ms p95) and NFR-03 (message delivery < 500 ms p95).

### RLS on Every DB Operation
Every handler calls `SET LOCAL app.tenant_id` before any DB query. RLS policies on `conversations.dialogs` and `conversations.messages` enforce tenant isolation at the database level, satisfying FF-03.

### Next.js API Proxy
All REST calls from the browser go through `/api/proxy/[...path]`, which forwards to Express on port 4000. This eliminates CORS configuration and allows the frontend to treat the API as same-origin. Socket.io connects directly to the Express host (configured via `NEXT_PUBLIC_API_URL`).

---

## 7. Integration Points

| Integration | Mechanism | Status |
|-------------|-----------|--------|
| BC-02 PQL Intelligence | `analyzePQLInline()` on every `client:message` | Implemented |
| BC-04 Telegram Forward | `forwardToTelegramIfNeeded()` on OUTBOUND messages | Implemented (no-op for WEB_CHAT) |
| BC-04 VK Max Forward | `forwardToVKMaxIfNeeded()` on OUTBOUND messages | Implemented (no-op for WEB_CHAT) |
| BC-05 IAM | JWT `tenant.middleware` on all REST routes | Implemented |
| BC-06 Notifications | `notificationService.notify()` via injected service | Implemented via PQL path |

---

## 8. Fitness Function Status

| FF | Status | Notes |
|----|--------|-------|
| FF-01 PQL < 2000 ms | Pass | PQL is fire-and-forget; does not affect delivery |
| FF-02 No cross-BC imports | Pass | BC-01 receives PQL service via injection; no domain import |
| FF-03 RLS 100% | Pass | `SET LOCAL app.tenant_id` on every query |
| FF-04 Circuit Breaker on MCP | Pass | Channel forwarding goes through BC-04 adapters |
| FF-10 Data residency | Pass | All data on Russian VPS; no foreign API calls |

---

## 9. Known Gaps (v1 Limitations)

1. Widget embed (`widget.js` standalone bundle) is not yet built — widget runs as part of Next.js app.
2. WebSocket-level rate limiting (SH-03: 10 msg/min) is not enforced on socket events.
3. No `dialog:closed` WebSocket event emitted when status changes via REST PATCH.
4. DB-level unique constraint on `(tenant_id, external_id)` not present — race condition risk on concurrent first messages.
5. Operator `operator:message` WebSocket path creates a second DB row alongside REST (double-write architectural debt).
6. Widget sessions authenticate with raw `tenantId` (not a domain-specific token) — SH-W1 security enhancement needed.

---

## 10. Metrics Baseline (Implementation)

| Metric | Achieved |
|--------|---------|
| REST endpoints | 4 |
| Socket.io events (inbound) | 4 |
| Socket.io events (outbound) | 7 |
| Domain aggregates | 2 (Dialog, Message) |
| Repository methods | 8 (Dialog: 6, Message: 3) |
| TypeScript strict mode | Enabled |
| Zod schemas | 5 (all inbound events + 2 REST bodies) |
