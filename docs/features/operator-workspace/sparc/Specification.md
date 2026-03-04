# Specification: FR-07 Operator Workspace
**Feature ID:** FR-07
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. UI Component Hierarchy

```
WorkspacePage (app/(workspace)/page.tsx)
├── <header> — Top bar
│   ├── Brand + connection status dot
│   ├── ShortcutHelp trigger ("?" button)
│   ├── NotificationBell (FR-11)
│   ├── Operator email
│   └── Logout button
├── <aside> (w-80) — Left sidebar
│   └── DialogList
│       └── dialog-item[] (button, data-testid="dialog-item-{id}")
│           ├── contactName + channelBadge + pqlBadge
│           ├── lastMessagePreview + timeAgo + unreadCount badge
│           └── status dot
├── <main> (flex-1) — Center panel
│   └── ChatArea
│       ├── messages[]
│       │   └── message bubble (INBOUND=left/gray, OUTBOUND=right/blue)
│       │       ├── senderBadge (CLIENT/OPERATOR/BOT)
│       │       ├── timestamp
│       │       └── content text
│       ├── typing indicator (animated dots)
│       └── input form
│           ├── input[data-testid="message-input"]
│           └── button[data-testid="send-button"]
├── <aside> (w-72) — Right panel
│   └── RightPanel
│       ├── PQL Score section
│       │   ├── score number + tier badge
│       │   └── top signals list (up to 5)
│       ├── Contact Info section
│       ├── Memory AI section (FR-03)
│       │   └── MemoryAIDisplay (when status=ok)
│       │       ├── contactName, currentPlan, accountAge
│       │       ├── previousDialogCount, tags
│       │       ├── deals[] (title, value, status)
│       │       └── enrichment score progress bar
│       ├── Quick Replies section (5 templates, Alt+1..5)
│       └── Actions section
│           ├── "Assign to me" button (Alt+A)
│           ├── "Close dialog" button (Alt+C)
│           ├── "Archive" button (when CLOSED)
│           ├── "Unassign" button (when ASSIGNED)
│           └── Reassign dropdown (FR-13, online operators only)
└── ShortcutHelp modal (overlay, data-testid="shortcut-help-overlay")
    └── shortcuts table grouped by: navigation / messaging / actions
```

---

## 2. TypeScript Type Definitions

### Domain Types (`app/(workspace)/types.ts`)

```typescript
type ChannelType = 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
type DialogStatus = 'OPEN' | 'ASSIGNED' | 'CLOSED' | 'ARCHIVED'
type PQLTier = 'HOT' | 'WARM' | 'COLD'
type MessageDirection = 'INBOUND' | 'OUTBOUND'
type SenderType = 'CLIENT' | 'OPERATOR' | 'BOT'

interface Dialog {
  id: string
  tenantId: string
  channelType: ChannelType
  externalChannelId: string
  status: DialogStatus
  assignedOperatorId?: string
  contactEmail?: string
  pqlScore?: number
  pqlTier?: PQLTier
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  // Client-side computed fields:
  lastMessagePreview?: string
  lastMessageAt?: string
  unreadCount?: number
}

interface Message {
  id: string
  dialogId: string
  tenantId: string
  direction: MessageDirection
  senderType: SenderType
  content: string
  attachments: unknown[]
  pqlSignals: unknown[]
  createdAt: string
}

interface OperatorProfile {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'OPERATOR'
  tenantId: string
  status: string
}

interface QuickReply {
  id: string
  label: string
  content: string
}
```

### CRM Context Type (`app/(workspace)/hooks/useMemoryAI.ts`)

```typescript
interface CRMContactContextUI {
  contactEmail: string
  contactName?: string
  currentPlan?: string
  accountAge?: number
  deals: { id: string; title: string; value: number; status: string; closedAt?: string }[]
  previousDialogCount: number
  tags: string[]
  enrichmentScore: number   // 0–1
}

type MemoryAIStatus = 'idle' | 'loading' | 'ok' | 'not_configured' | 'error' | 'no_email'
```

---

## 3. State Management

All state is managed via React hooks. No global state library (Redux/Zustand). State is colocated and passed via props where needed.

### WorkspacePage state

```typescript
const [token, setToken] = useState<string>('')            // JWT from localStorage
const [operator, setOperator] = useState<OperatorProfile | null>(null)
const [selectedDialogId, setSelectedDialogId] = useState<string | null>(null)
const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
const searchInputRef = useRef<HTMLInputElement>(null)
const sendMessageRef = useRef<(() => void) | null>(null)  // FR-14: expose send fn to shortcut
```

### Hook: useSocket

```typescript
// Manages single Socket.io connection to /chat namespace
// Reconnects when token/tenantId/operatorId change
// Returns: { connected, emit, on }
```

**Auth payload:** `{ token, tenantId, operatorId }` passed in `socket.auth`

**Connection config:**
```
transports: ['websocket', 'polling']
reconnectionAttempts: 10
reconnectionDelay: 1000ms
```

### Hook: useDialogs

```typescript
// Internal state
const [dialogs, setDialogs] = useState<Dialog[]>([])  // sorted by PQL tier + recency
const [loading, setLoading] = useState(true)
const dialogsRef = useRef<Dialog[]>([])               // for closure-safe access

// Sort algorithm: tierOrder = { HOT: 0, WARM: 1, COLD: 2, undefined: 3 }
// Secondary sort: lastMessageAt or updatedAt descending
```

**Real-time event subscriptions:**
- `message:new` — update preview, increment unreadCount (INBOUND only), resort
- `dialog:created` — add new dialog if not already present
- `pql:detected` — update pqlScore + pqlTier on matching dialog, resort
- `dialog:assigned` — merge updated dialog data (preserve unreadCount)

### Hook: useMessages

```typescript
const [messages, setMessages] = useState<Message[]>([])
const [loading, setLoading] = useState(false)
const [typingIndicator, setTypingIndicator] = useState(false)
```

**Real-time events:**
- `message:new` — append if not duplicate (dedup by id)
- `typing` — set typingIndicator when `senderType === 'CLIENT'`; auto-clear after 5s

**Send flow:** REST POST → emit `operator:message` → optimistic append to local state

### Hook: useMemoryAI

```typescript
// Per-dialog cache: Map<`${dialogId}:${email}`, CRMContactContextUI>
const cacheRef = useRef<Map<string, CRMContactContextUI>>(new Map())
// Status machine:
//   idle → loading → ok | error | not_configured | no_email
```

**Trigger:** re-fetches on `dialogId` or `contactEmail` change via `useEffect`

**Cache key:** `"${dialogId}:${contactEmail}"`

**Refresh:** clears cache key then re-fetches

---

## 4. Socket.io Event Contract

### Client → Server (emitted)

| Event | Payload | Description |
|-------|---------|-------------|
| `dialog:assign` | `{ dialogId, tenantId, operatorId }` | Assign dialog to current operator |
| `operator:message` | `{ dialogId, tenantId, content }` | Broadcast outbound message |
| `typing` | `{ dialogId, tenantId, isTyping, senderType: 'OPERATOR' }` | Typing indicator |

### Server → Client (subscribed)

| Event | Payload | Description |
|-------|---------|-------------|
| `message:new` | `{ message: Message, dialog?: Dialog }` | New inbound or outbound message |
| `dialog:created` | `{ dialog: Dialog }` | New dialog started by client |
| `pql:detected` | `{ dialogId, score, tier, topSignals[] }` | PQL detection result |
| `dialog:assigned` | `{ dialog: Dialog }` | Assignment change |
| `typing` | `{ dialogId, isTyping, senderType }` | Typing indicator from client |
| `operator:online` | `{ operatorId }` | Operator came online (FR-13) |
| `operator:offline` | `{ operatorId }` | Operator went offline (FR-13) |
| `notification:pql` | `{ dialogId, score, tier, topSignals[], contactEmail, timestamp }` | PQL Pulse (FR-11) |

---

## 5. REST API Endpoints (consumed by workspace)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/me` | Token verification in layout guard |
| GET | `/dialogs` | Fetch all dialogs for tenant |
| GET | `/dialogs/:id/messages?limit=100` | Fetch message history |
| POST | `/dialogs/:id/messages` | Send operator message |
| PATCH | `/dialogs/:id/status` | Change dialog status (close/archive/unassign) |
| GET | `/pql/detections/:dialogId` | PQL detection details and signals |
| GET | `/memory/:dialogId` | Memory AI: CRM context for dialog contact |
| GET | `/operators` | All operators in tenant (FR-13) |
| GET | `/operators/online` | Online operators (FR-13) |
| GET | `/operators/:id/stats` | Operator active dialog count (FR-13) |
| GET | `/api/notifications?limit=20` | Initial notification list (FR-11) |
| GET | `/api/notifications/unread-count` | Unread notification count (FR-11) |
| PATCH | `/api/notifications/:id/read` | Mark notification as read (FR-11) |

All requests from the Next.js frontend are proxied through `/api/proxy/[...path]/route.ts` to the backend Express server.

---

## 6. Quick Reply Templates

Defined in `app/(workspace)/constants/quickReplies.ts`:

| Index | Label | Content |
|-------|-------|---------|
| 0 (Alt+1) | Connect specialist | "Спасибо за обращение! Подключаю специалиста." |
| 1 (Alt+2) | Request email | "Могу я уточнить ваш email для связи?" |
| 2 (Alt+3) | 24h follow-up | "Мы изучим ваш запрос и вернёмся в течение 24 часов." |
| 3 (Alt+4) | Demo offer | "Хотите назначить демо-встречу с нашей командой?" |
| 4 (Alt+5) | Transfer to sales | "Передаю ваш запрос в отдел продаж." |

---

## 7. Keyboard Shortcuts Specification

Defined in `app/(workspace)/hooks/useKeyboardShortcuts.ts`:

```typescript
// isTypingInInput() check — guards Alt/navigation shortcuts when cursor is in textarea
// Ctrl+Enter and Ctrl+K always fire regardless of input focus
```

**Shortcut handler priorities:**
1. `Ctrl+Enter` / `Cmd+Enter` — always intercepted (even in input)
2. `Ctrl+K` — always intercepted (overrides browser default)
3. Block remaining shortcuts when `isTypingInInput() === true`
4. `Alt+*`, `Escape`, `?` — only when not in input

**Quick reply ref pattern:** `sendMessageRef.current` is set by `ChatArea` to expose its internal send function. `WorkspacePage` stores this ref and passes it to `useKeyboardShortcuts` actions.

---

## 8. Authentication and Authorization

- JWT token stored in `localStorage` under key `kommuniq_token`
- Operator profile stored in `localStorage` under key `kommuniq_operator`
- Layout guard (`WorkspaceLayout`) verifies on every mount:
  1. Both keys must exist
  2. `GET /auth/me` must return 200
  3. On failure: clear storage, redirect to `/login`
- Token passed as `Authorization: Bearer {token}` on all REST requests
- Token passed in `socket.auth.token` for Socket.io authentication

---

## 9. Error Handling Matrix

| Scenario | Handling |
|----------|----------|
| Dialog fetch fails | Error state stored; loading=false; empty list shown |
| Message fetch fails | `console.error` logged; empty message list |
| Message send fails | Input content restored; error logged; `setSending(false)` |
| Memory AI fetch fails | Status set to 'error'; Retry button shown |
| PQL signals fetch fails | Empty signals list; no error displayed to operator |
| Socket.io disconnect | Red dot in top bar; auto-reconnect attempts begin |
| Token invalid | Layout guard redirects to `/login` |
| CRM not configured | Status 'not_configured'; instructional message shown |
| Dialog has no email | Status 'no_email'; explanatory message shown |
