# Architecture: FR-07 Operator Workspace
**Feature ID:** FR-07
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. C4 Level 3 — Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser (Next.js 14 App Router)  — app/(workspace)/                        │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │  WorkspacePage (page.tsx)                                        │       │
│  │                                                                  │       │
│  │  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐    │       │
│  │  │ useSocket  │  │ useDialogs   │  │ useMessages           │    │       │
│  │  │            │  │              │  │                       │    │       │
│  │  │ emit()     │  │ sortDialogs()│  │ sendMessage()         │    │       │
│  │  │ on()       │  │ clearUnread()│  │ sendTyping()          │    │       │
│  │  └─────┬──────┘  └──────┬───────┘  └──────────┬────────────┘    │       │
│  │        │                │                     │                 │       │
│  │  ┌─────▼──────┐  ┌──────▼───────┐  ┌──────────▼────────────┐    │       │
│  │  │ DialogList │  │ ChatArea     │  │ RightPanel            │    │       │
│  │  │            │  │              │  │  ├─ useMemoryAI        │    │       │
│  │  │ HOT>WARM>  │  │ messages[]   │  │  ├─ PQL score/signals  │    │       │
│  │  │ COLD sort  │  │ typing dot   │  │  ├─ MemoryAIDisplay    │    │       │
│  │  │ unread dot │  │ input form   │  │  ├─ QuickReplies       │    │       │
│  │  └────────────┘  └──────────────┘  │  └─ Actions           │    │       │
│  │                                    └───────────────────────┘    │       │
│  │  ┌────────────────────┐  ┌────────────────────────────────────┐  │       │
│  │  │ useKeyboardShortcuts│  │ useNotifications + NotificationBell│  │       │
│  │  │ 13 shortcuts       │  │ (FR-11)                            │  │       │
│  │  └────────────────────┘  └────────────────────────────────────┘  │       │
│  │                                                                  │       │
│  │  ┌────────────────────┐  ┌────────────────────────────────────┐  │       │
│  │  │ useOperators       │  │ ShortcutHelp modal (FR-14)         │  │       │
│  │  │ OperatorList (FR-13│  │                                    │  │       │
│  │  └────────────────────┘  └────────────────────────────────────┘  │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  ┌─────────────────────────────────┐                                        │
│  │  WorkspaceLayout (layout.tsx)   │                                        │
│  │  Auth guard: verify JWT on mount│                                        │
│  └─────────────────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────────────┘
         │ REST (via /api/proxy/)           │ WebSocket (Socket.io)
         ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Next.js API Proxy  app/api/proxy/[...path]/route.ts                        │
│  — Forwards all /api/proxy/* requests to backend Express server             │
│  — Passes Authorization header unchanged                                    │
└─────────────────────────────────────────────────────────────────────────────┘
         │ HTTP
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Express Backend  (src/server.ts)                                           │
│                                                                             │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ BC-01         │  │ BC-02        │  │ BC-04        │  │ BC-05         │  │
│  │ Conversation  │  │ PQL Intel.   │  │ Integration  │  │ IAM           │  │
│  │               │  │              │  │              │  │               │  │
│  │ chat-routes   │  │ pql-routes   │  │ amoCRM MCP   │  │ auth-routes   │  │
│  │ ws-handler    │  │ memory-ai-   │  │ Adapter      │  │ operator-     │  │
│  │ dialog-repo   │  │ routes       │  │              │  │ routes        │  │
│  │ message-repo  │  │ pql-detect.  │  │              │  │               │  │
│  └───────┬───────┘  └──────────────┘  └──────────────┘  └───────────────┘  │
│          │                                                                  │
│  ┌───────▼──────────────────────────────┐                                  │
│  │  Socket.io /chat namespace           │                                  │
│  │  ws-handler.ts — event routing       │                                  │
│  └───────────────────────────────────────┘                                  │
│                     │                                                       │
│  ┌──────────────────▼────────────────────────────────────────────────────┐  │
│  │  Redis Streams (async event bus)                                      │  │
│  │  MessageReceived → PQLDetector → PQLDetected → WS push + Attribution │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌──────────────┐    ┌─────────────────────────┐
│ PostgreSQL   │    │ Cloud.ru MCP Servers     │
│ (RLS active) │    │ amoCRM MCP (Memory AI)   │
│              │    │ Grafana MCP (monitoring) │
└──────────────┘    └─────────────────────────┘
```

---

## 2. Data Flow — Dialog Selection

```
User clicks dialog in DialogList
    │
    ▼
handleSelectDialog(id) called in WorkspacePage
    │
    ├─► setSelectedDialogId(id)
    ├─► clearUnread(id)          — useDialogs: set unreadCount=0 for this dialog
    │
    ▼
useMessages reacts to dialogId change
    │
    ├─► setMessages([])          — clear stale messages
    ├─► setLoading(true)
    └─► fetch /dialogs/:id/messages?limit=100
           │
           ▼
        setMessages(data.messages)
        setLoading(false)

useMemoryAI reacts to dialogId change
    │
    ├─► check cache (dialogId:email)
    │       ├─ HIT: setState({ status: 'ok', data: cached })
    │       └─ MISS: fetch /memory/:dialogId
    │                   ├─ ok: cache + setState({ status: 'ok', data })
    │                   ├─ not_configured: setState({ status: 'not_configured' })
    │                   └─ error: setState({ status: 'error' })

RightPanel reacts to dialog.id change
    │
    └─► fetch /pql/detections/:id
            ├─ aggregate signals across all detections
            ├─ deduplicate by type (keep highest weight)
            └─ sort by weight descending, slice top 5
```

---

## 3. Data Flow — Real-time PQL Detection

```
Client message arrives (any channel)
    │
    ▼
Backend: MessageReceived event → Redis Stream
    │
    ▼
PQL Detector worker (src/worker.ts)
    ├─► RuleEngine.evaluate(message) → signals[]
    ├─► MemoryAI.fetchContext(contactEmail) via amoCRM MCP
    └─► PQLDetected { dialogId, score, tier, topSignals }
           │
           ├─► persist to pql_detections table
           ├─► Socket.io emit 'pql:detected' to tenant namespace
           │       │
           │       ▼
           │   useDialogs.on('pql:detected') in browser
           │       └─► update dialog.pqlScore + pqlTier
           │           re-sort dialogs (HOT floats to top)
           │
           └─► Socket.io emit 'notification:pql' to operator
                   │
                   ▼
               useNotifications.on('notification:pql') in browser
                   └─► prepend to notifications[], increment unreadCount
                       NotificationBell badge updates
```

---

## 4. Data Flow — Message Send

```
Operator types in ChatArea input
    │
    ├─► handleInputChange: emit 'typing' { isTyping: true }
    │   (debounced: emit { isTyping: false } after 2s idle)
    │
Operator submits (Enter / Ctrl+Enter / Send button)
    │
    ├─► setInput('')
    ├─► setSending(true)
    ├─► emit 'typing' { isTyping: false }
    └─► POST /dialogs/:id/messages { content, senderType: 'OPERATOR' }
            │
            ├─ Success:
            │   ├─► emit 'operator:message' { dialogId, tenantId, content }
            │   └─► setMessages(prev => [...prev, data.message])  (dedup guard)
            │
            └─ Failure:
                └─► setInput(content)  — restore input
                    setSending(false)
```

---

## 5. Layout Architecture (CSS)

```
WorkspacePage: flex flex-col h-screen
├── <header> h-12 (fixed height, shrink-0)
└── <div> flex flex-1 overflow-hidden
    ├── <aside> w-80 shrink-0  (Dialog list — fixed width)
    ├── <main>  flex-1 min-w-0 (Chat area — fills remaining space)
    └── <aside> w-72 shrink-0  (Right panel — fixed width)
```

The `overflow-hidden` on the row container prevents layout bleed. Individual scrollable regions (`DialogList`, messages area, `RightPanel`) use `overflow-y-auto`.

---

## 6. Cross-BC Dependencies

| BC | Interaction | Direction | Contract |
|----|------------|-----------|---------|
| BC-01 Conversation | Dialog + Message aggregates, REST API, Socket.io events | FR-07 consumes | `GET /dialogs`, `POST /dialogs/:id/messages`, `dialog:assigned` event |
| BC-02 PQL Intelligence | PQL detection results and signals | FR-07 consumes | `GET /pql/detections/:id`, `pql:detected` Socket.io event |
| BC-04 Integration | Memory AI (amoCRM CRM context) | FR-07 consumes | `GET /memory/:dialogId` (proxied from amoCRM MCP adapter) |
| BC-05 IAM | Authentication, operator profiles, presence | FR-07 consumes | `GET /auth/me`, `GET /operators`, `operator:online/offline` events |
| BC-06 Notifications | PQL Pulse push notifications | FR-07 consumes | `GET /api/notifications`, `notification:pql` Socket.io event |

**Cross-BC import rule (FF-02):** The frontend workspace code imports ONLY from `app/(workspace)/` itself. It does NOT import from `src/` backend modules. All communication is through REST API and Socket.io events (loose coupling, ACL via API contract).

---

## 7. Auth Guard Flow (WorkspaceLayout)

```
WorkspaceLayout mounts
    │
    ├─► localStorage.getItem('kommuniq_token') — missing?
    │       └─► router.replace('/login')
    │
    ├─► localStorage.getItem('kommuniq_operator') — missing?
    │       └─► router.replace('/login')
    │
    └─► fetch /auth/me with Bearer token
            ├─ res.ok === false:
            │   ├─► localStorage.removeItem('kommuniq_token')
            │   ├─► localStorage.removeItem('kommuniq_operator')
            │   └─► router.replace('/login')
            │
            └─ res.ok === true:
                └─► setAuthorized(true) → render children
```

---

## 8. Next.js API Proxy Pattern

File: `app/api/proxy/[...path]/route.ts`

The proxy forwards all requests from `/api/proxy/*` to the Express backend. This pattern:
- Avoids CORS configuration complexity
- Allows the backend URL to be server-side env only (`NEXT_PUBLIC_API_URL`)
- Enables future authentication injection at proxy layer

---

## 9. ADR Compliance Checklist

| ADR | Requirement | Compliance |
|-----|------------|-----------|
| ADR-002 | Never call external APIs directly from domain code | Compliant: workspace calls only `/api/proxy/*`; MCP calls happen in backend BC-04 |
| ADR-006 | Redis Streams for async events | Compliant: PQL detection is async; workspace receives result via `pql:detected` event, not synchronous call |
| ADR-007 | JWT + RLS — always set tenant_id | Compliant: JWT passed on all requests; backend middleware sets `app.tenant_id` |
| FF-02 | No cross-BC imports | Compliant: frontend imports nothing from `src/`; communication via API only |
| FF-03 | Tenant RLS isolation | Compliant: token scopes all API responses to operator's tenantId |
| FF-10 | Data residency | Compliant: workspace calls only internal backend; no external API from browser |
