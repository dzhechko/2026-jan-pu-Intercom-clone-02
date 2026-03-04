# FR-07: Operator Workspace
**Status:** Done | **BC:** BC-01 Conversation, BC-02 PQL Intelligence, BC-06 Notifications | **Priority:** MUST

## Summary
Implemented a full three-column operator workspace UI in Next.js 14 with real-time dialog management, message exchange, PQL score display, Memory AI (CRM context) sidebar, notification bell, keyboard shortcuts, quick replies, and operator presence tracking. The workspace connects via Socket.io for live updates and uses REST APIs for data fetching and mutations.

## User Stories
- US-01: As an operator, I want to see all open dialogs sorted by PQL tier priority so that I focus on the highest-value leads first.
- US-02: As an operator, I want to send and receive messages in real time so that I can respond to clients without page refreshes.
- US-03: As an operator, I want to see PQL score, tier, and detected signals for the selected dialog so that I understand the client's purchase intent.
- US-04: As an operator, I want to assign dialogs to myself, close them, and change their status so that I manage my workload.
- US-05: As an operator, I want keyboard shortcuts for common actions so that I can work faster without using the mouse.
- US-06: As an operator, I want to see CRM context (Memory AI) for the current client so that I have full account history before responding.
- US-07: As an operator, I want to receive real-time notifications when HOT/WARM PQL leads are detected so that I can act immediately.

## Technical Design

### Files Created

**Page and Layout:**
- `app/(workspace)/page.tsx` -- Main workspace page component. Three-column layout: DialogList (left), ChatArea (center), RightPanel (right). Top bar with connection status, shortcuts trigger, notification bell, operator email, logout. Manages auth state from localStorage, dialog selection, keyboard shortcuts wiring.
- `app/(workspace)/layout.tsx` -- Auth guard layout. Checks localStorage for token/operator, verifies via `/api/proxy/auth/me`, redirects to `/login` if unauthorized.
- `app/(workspace)/types.ts` -- Shared TypeScript types: Dialog, Message, OperatorProfile, QuickReply, ChannelType, DialogStatus, PQLTier, MessageDirection, SenderType.

**Components:**
- `app/(workspace)/components/DialogList.tsx` -- Scrollable dialog list with channel badge (Web/TG/VK), PQL tier badge (HOT/WARM/COLD), time-ago display, unread count badge, status dot (green=OPEN, yellow=ASSIGNED, gray=CLOSED).
- `app/(workspace)/components/ChatArea.tsx` -- Message display area with sender badges (Client/Operator/Bot), time formatting, typing indicator (animated dots), input form with send button. Supports Ctrl+Enter via sendMessageRef. Auto-scrolls to bottom on new messages.
- `app/(workspace)/components/RightPanel.tsx` -- Context sidebar with: PQL Score section (score value, tier badge, top signals list from API), Contact info (email, channel, status, assignment), Memory AI section (CRM context display with deals, tags, plans, enrichment score), Quick Replies (5 templates with Alt+N hints), Dialog Actions (assign, close, archive, unassign, reassign dropdown).
- `app/(workspace)/components/ShortcutHelp.tsx` -- Modal overlay listing all keyboard shortcuts grouped by category (Navigation, Messaging, Actions). Closes on Escape or overlay click.
- `app/(workspace)/components/NotificationBell.tsx` -- Bell icon with unread badge count, dropdown panel showing PQL notifications with tier badges, contact info, time-ago, read/unread state.
- `app/(workspace)/components/OperatorList.tsx` -- Operator list component for multi-operator features.

**Hooks:**
- `app/(workspace)/hooks/useSocket.ts` -- Socket.io connection hook for `/chat` namespace with JWT auth. Returns connected state, emit, and on (with cleanup).
- `app/(workspace)/hooks/useDialogs.ts` -- Fetches dialogs via REST, maintains sorted list (HOT > WARM > COLD > none, then by recency). Listens for `message:new`, `dialog:created`, `pql:detected`, `dialog:assigned` Socket.io events for real-time updates. Includes `sortDialogs()` function and `clearUnread()`.
- `app/(workspace)/hooks/useMessages.ts` -- Fetches message history per dialog, handles real-time `message:new` and `typing` events, provides `sendMessage` (REST + Socket.io dual emit) and `sendTyping`.
- `app/(workspace)/hooks/useMemoryAI.ts` -- Fetches CRM context from `/api/proxy/memory/{dialogId}`. Local cache by dialogId+email. Handles states: idle, loading, ok, not_configured, no_email, error. Supports manual refresh (cache-busting).
- `app/(workspace)/hooks/useKeyboardShortcuts.ts` -- Global keydown listener with 14 shortcut definitions across 3 categories. Skips shortcuts when typing in input/textarea/select/contentEditable (except Ctrl+Enter and Ctrl+K which always work).
- `app/(workspace)/hooks/useNotifications.ts` -- Fetches notifications from REST, listens for `notification:pql` Socket.io events. Manages unread count, mark-as-read via PATCH.
- `app/(workspace)/hooks/useOperators.ts` -- Operator list management hook.

**Constants:**
- `app/(workspace)/constants/quickReplies.ts` -- 5 Russian-language quick reply templates (connect specialist, request email, 24h follow-up, demo offer, transfer to sales).

### Key Decisions
- Three-column fixed layout (320px left sidebar, flex center, 288px right panel) for information density without scrolling.
- Dialog sorting prioritizes PQL tier over recency: HOT leads always appear at top regardless of when they last messaged.
- Dual message delivery: REST POST for persistence reliability, Socket.io emit for instant broadcast to widget clients.
- Memory AI results cached per dialog+email to avoid redundant CRM lookups when switching between dialogs.
- Keyboard shortcuts use `isTypingInInput()` guard to prevent interference with normal text input. Ctrl+Enter and Ctrl+K always fire (even in inputs) since they are explicit modifier-key combos.
- PQL signals fetched from `/api/proxy/pql/detections/{dialogId}` and aggregated across all detections, keeping highest-weight instance per signal type.
- Auth persisted in localStorage (`kommuniq_token`, `kommuniq_operator`); layout verifies token validity on mount.

## Socket.io Events (consumed by workspace)
| Event | Direction | Payload |
|-------|-----------|---------|
| `message:new` | Server -> Client | `{ message: Message, dialog?: Dialog }` |
| `dialog:created` | Server -> Client | `{ dialog: Dialog }` |
| `dialog:assigned` | Server -> Client | `{ dialog: Dialog }` |
| `pql:detected` | Server -> Client | `{ dialogId, score, tier, topSignals }` |
| `typing` | Bidirectional | `{ dialogId, isTyping, senderType }` |
| `notification:pql` | Server -> Client | `{ type, dialogId, score, tier, topSignals, contactEmail, timestamp }` |
| `dialog:assign` | Client -> Server | `{ dialogId, tenantId, operatorId }` |
| `operator:message` | Client -> Server | `{ dialogId, tenantId, content }` |

## Dependencies
- Depends on: IAM-01 (auth + JWT), BC-01 Conversation (dialog/message APIs + WebSocket), BC-02 PQL (detection API), BC-04 Integration (Memory AI / amoCRM MCP)
- Blocks: FR-09 Revenue Report (uses workspace as entry point), FR-10 PQL Feedback (feedback UI in RightPanel)

## Tests
- `tests/workspace/sort-dialogs.test.ts` -- 8 tests: HOT before WARM/COLD, undefined tier after COLD, recency within same tier, fallback to updatedAt, immutability, empty/single array, mixed scenario.
- `tests/workspace/keyboard-shortcuts.test.ts` -- 28 tests: shortcut registration (all keys, Alt+1-5, categories, uniqueness), action mapping (Ctrl+Enter, Alt+A, Alt+C, Escape, Alt+N), input field exclusion (INPUT, TEXTAREA, SELECT, contentEditable, DIV, BUTTON), Ctrl+Enter send, dialog navigation (prev/next/bounds/empty), quick reply dispatch (5 templates, bounds, unique IDs), help panel categories.
- `tests/workspace/message-formatting.test.ts` -- 16 tests: direction classification, sender type mapping, time-ago calculation, message truncation, channel type display, PQL tier ordering.

## Acceptance Criteria
- [x] Three-column layout: dialog list, chat area, context panel
- [x] Dialogs sorted by PQL tier (HOT > WARM > COLD > none) then by recency
- [x] Real-time message exchange via Socket.io + REST
- [x] PQL score and tier displayed with color-coded badges
- [x] PQL signals listed with weight percentages
- [x] Memory AI (CRM) context shown with deals, tags, plans, enrichment score
- [x] 14 keyboard shortcuts across navigation, messaging, and actions categories
- [x] 5 quick reply templates accessible via buttons and Alt+1-5
- [x] Notification bell with unread count and PQL alert dropdown
- [x] Typing indicator for client messages
- [x] Dialog actions: assign, close, archive, unassign, reassign
- [x] Auth guard redirects to /login when not authenticated
- [x] Connection status indicator in top bar
