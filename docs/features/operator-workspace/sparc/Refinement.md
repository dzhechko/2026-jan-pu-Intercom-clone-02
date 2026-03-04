# Refinement: FR-07 Operator Workspace
**Feature ID:** FR-07
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. Edge Cases

### EC-WS-01: Socket.io Disconnect Mid-Session

**Scenario:** Operator has dialogs open. Network drops for 10–30 seconds.

**Risk:** Missing messages during disconnect window. Dialog list goes stale.

**Mitigation:**
- Socket.io configured with `reconnectionAttempts: 10`, `reconnectionDelay: 1000ms`
- On reconnect, Socket.io re-joins the tenant namespace and receives buffered events
- Connection status dot (green/red) in top bar provides immediate feedback
- Operator can see "Disconnected" state and knows to wait or refresh

**Residual risk:** If reconnect exceeds Socket.io buffer (default 30s), events in that window are silently lost. Mitigation v2: on reconnect, re-fetch dialog list and last N messages for selected dialog.

**Test:** `Scenario: WebSocket reconnects after 10-second interruption` in test-scenarios.feature

---

### EC-WS-02: Concurrent Operators on Same Dialog

**Scenario:** Two operators open the same dialog simultaneously and both send messages.

**Risk:** Message ordering confusion, conflicting assignment actions.

**Mitigation:**
- `dialog:assigned` event is broadcast to all operator sockets in the tenant namespace
- When operator A assigns, operator B's workspace updates via `dialog:assigned` event
- Assignment button only shows when `dialog.assignedOperatorId !== currentOperator.id`
- Message deduplication in `useMessages`: `if (prev.some(m => m.id === msg.id)) return prev`

**Residual risk:** Race condition between two operators simultaneously clicking "Assign to me". Server-side: first write wins (DB unique constraint or optimistic lock). Second operator sees the dialog status change via websocket and the button disappears.

---

### EC-WS-03: Dialog Created Before Socket Connected

**Scenario:** A new dialog arrives in the backend before the operator's Socket.io connection is established (e.g., slow browser or delayed auth).

**Mitigation:**
- `useDialogs` performs an initial REST fetch on mount, which includes all existing OPEN dialogs
- The initial fetch runs regardless of Socket.io connection state
- Therefore dialogs created before socket connection are captured in the initial fetch

---

### EC-WS-04: PQL Score Update Race with Dialog Selection

**Scenario:** Operator selects dialog at T=0. PQL detected at T=1. Right panel loads old data.

**Risk:** Signals shown in right panel are stale relative to the `pql:detected` event just received.

**Mitigation:**
- `useEffect` in `RightPanel` triggers re-fetch of PQL signals when `dialog.pqlScore` changes
- The `pql:detected` event updates `dialog.pqlScore` in `useDialogs`, which propagates to `selectedDialog` prop, which triggers the `useEffect` dependency
- Cache is not used for PQL signals (no stale data concern)

---

### EC-WS-05: Memory AI — CRM Not Configured

**Scenario:** Tenant has not connected amoCRM credentials.

**Handling:** Backend returns `{ status: 'not_configured' }`. Frontend `useMemoryAI` sets `status: 'not_configured'`. RightPanel shows: "CRM not configured. Connect amoCRM in Settings to see customer context." No retry is offered (configuration change required).

---

### EC-WS-06: Long Message Content (>5000 chars)

**Risk:** Extremely long messages break layout or cause performance issues in the messages list.

**Mitigation:**
- `lastMessagePreview` is sliced to 100 characters in `useDialogs` (`msg.content.slice(0, 100)`)
- Message bubble uses `whitespace-pre-wrap break-words` CSS — long words wrap correctly
- Max width of bubble: `max-w-[70%]`
- Server-side: messages are validated by Zod schema; very long content may be truncated at API level

---

### EC-WS-07: Token Expiry During Active Session

**Scenario:** JWT expires while operator is in the workspace (e.g., after 8 hours).

**Symptoms:** REST API calls return 401. Socket.io connection may drop.

**Current handling:** Errors are caught and logged. The workspace does not auto-refresh the token (no refresh token flow in v1). Operator sees errors accumulating (e.g., failed message sends, empty updates).

**Mitigation v1:** The layout guard checks token on mount only. If token expires mid-session, the operator must manually reload (they will be redirected to `/login`).

**Mitigation v2:** Intercept 401 responses in the API proxy layer and trigger `router.replace('/login')`.

---

### EC-WS-08: Quick Reply Sent to Closed Dialog

**Scenario:** Operator uses Alt+1..5 keyboard shortcut on a dialog that was closed by another operator.

**Risk:** Attempting to POST a message to a CLOSED dialog.

**Mitigation:** Backend rejects message POST to CLOSED dialogs with 400. The `handleQuickReply` function checks `selectedDialogId` is truthy, but does not check dialog status. Error is caught in `sendMessage` and input would be restored. Operator sees sending state reset.

**Mitigation v2:** Check `selectedDialog.status !== 'CLOSED'` before triggering quick reply.

---

### EC-WS-09: Operator List Shows Stale Online Status

**Scenario:** Network partition causes `operator:offline` event to not be delivered.

**Risk:** Operator appears online in the reassign dropdown after they've actually disconnected.

**Mitigation:** `useOperators` initial fetch queries `/operators/online` which reflects server-side presence. If a socket disconnect event is missed, the stale state persists until next `fetchOperators()` call. v2: periodic refresh every 30s.

---

### EC-WS-10: Notification Bell with 50+ Notifications

**Scenario:** High-volume tenant generates many PQL detections over several hours.

**Mitigation:**
- In-memory: `setNotifications(prev => [newNotification, ...prev].slice(0, 50))` — hard cap at 50
- REST fetch: `GET /api/notifications?limit=20` — initial load capped at 20
- Dropdown uses `max-h-96 overflow-y-auto` — scrollable list

---

## 2. Concurrency Notes

### Message Deduplication

Two code paths can add the same message to the messages list:
1. REST POST response (in `sendMessage`)
2. Socket.io `message:new` event (via `useMessages`)

Both check: `if (prev.some(m => m.id === data.message.id)) return prev`

This prevents duplicate message bubbles when the operator sends a message.

### Dialog Deduplication

Three code paths can add a dialog to the list:
1. Initial REST fetch
2. `dialog:created` event
3. `message:new` event (when `payload.dialog` is present and dialog is new)

Both event handlers check: `if (prev.some(d => d.id === data.dialog.id)) return prev`

---

## 3. Performance Considerations

### Dialog List Re-renders

`sortDialogs` creates a new array on every `message:new` event. For tenants with many dialogs (hundreds), this runs frequently. Mitigation: the sort is O(n log n) and the array is bounded by business logic (one operator can realistically handle ~50 open dialogs).

### Memory AI Cache

The per-dialog CRM context is cached in a `Map` ref to avoid re-fetching when the operator revisits a dialog. Cache is NOT invalidated on dialog updates (only on explicit refresh). For a dialog open for hours, CRM data could be stale. The refresh button handles this manually.

### useSocket on() Closure Issue

The `on()` callback returned by `useSocket` captures `socketRef.current` at call time. If the socket reconnects, the ref is updated but existing `on()` subscriptions from before the reconnect need to be re-registered. Current mitigation: `useEffect` cleanup returns the unsubscribe function (`socketRef.current?.off(event, handler)`), and React re-runs effects when dependencies change. The token/tenantId/operatorId changing causes a new socket and new effect registrations.

---

## 4. Testing Strategy

### Unit Tests (per hook)

```typescript
describe('sortDialogs', () => {
  it('places HOT dialogs before WARM')
  it('places WARM dialogs before COLD')
  it('breaks ties by lastMessageAt descending')
  it('handles undefined pqlTier (sorts last)')
  it('handles undefined lastMessageAt (falls back to updatedAt)')
})

describe('useDialogs', () => {
  it('fetches dialogs on mount')
  it('updates dialog preview on message:new event')
  it('increments unreadCount for INBOUND messages only')
  it('does not increment unreadCount for OUTBOUND messages')
  it('deduplicates dialogs on dialog:created')
  it('updates pqlTier on pql:detected and re-sorts')
  it('clearUnread sets unreadCount to 0 for target dialog')
})

describe('useMessages', () => {
  it('fetches messages on dialogId change')
  it('clears messages when dialogId becomes null')
  it('appends message:new event to list')
  it('deduplicates messages by id')
  it('shows typing indicator on CLIENT typing event')
  it('hides typing indicator on isTyping:false')
  it('auto-clears typing indicator after 5 seconds')
  it('restores input content on send failure')
})

describe('useMemoryAI', () => {
  it('returns idle status when no dialogId')
  it('returns no_email status when contactEmail is absent')
  it('returns loading then ok on successful fetch')
  it('uses cache on repeated access to same dialog+email')
  it('clears cache on refresh()')
  it('returns not_configured when backend reports it')
  it('returns error on network failure')
})

describe('useKeyboardShortcuts', () => {
  it('calls onSendMessage on Ctrl+Enter')
  it('calls onSendMessage on Cmd+Enter')
  it('calls onFocusSearch on Ctrl+K')
  it('does NOT call onPreviousDialog when typing in input')
  it('calls onPreviousDialog on Alt+ArrowUp when not in input')
  it('calls onNextDialog on Alt+ArrowDown')
  it('calls onNextUnassigned on Alt+N')
  it('calls onAssignDialog on Alt+A')
  it('calls onCloseDialog on Alt+C')
  it('calls onQuickReply(0) on Alt+1')
  it('calls onQuickReply(4) on Alt+5')
  it('calls onEscape on Escape key')
  it('calls onToggleHelp on ? key')
  it('does NOT call onToggleHelp when in input field')
})
```

### Integration Tests

```typescript
describe('WorkspacePage integration', () => {
  it('loads dialog list on mount with valid token')
  it('redirects to /login when token missing')
  it('selects dialog and loads messages')
  it('clears unread count when dialog selected')
  it('sends message via REST and appends to list')
  it('shows PQL tier badge in dialog list after pql:detected event')
  it('opens shortcut help modal on ? key')
  it('closes shortcut help modal on Escape')
})
```

### BDD Scenarios (from test-scenarios.feature)

1. New Telegram message appears in workspace queue within 3 seconds
2. PQL dialogs sort above regular (HOT > WARM > others)
3. Dialog assignment updates status and broadcasts to other operators
4. WebSocket reconnects after 10-second network interruption

### Manual Testing Checklist

- [ ] Assign dialog via button → status changes to ASSIGNED
- [ ] Assign dialog via Alt+A → same result
- [ ] Send quick reply via button click
- [ ] Send quick reply via Alt+1..5
- [ ] Close dialog via button → status changes to CLOSED
- [ ] Close dialog via Alt+C
- [ ] Navigate dialogs via Alt+ArrowUp/Down
- [ ] Jump to next unassigned via Alt+N
- [ ] Open shortcut help via ?
- [ ] Close shortcut help via Escape
- [ ] Notification bell shows unread count badge
- [ ] Clicking notification selects the dialog
- [ ] Memory AI shows CRM context for dialog with email
- [ ] Memory AI shows "No contact email" for dialog without email
- [ ] Memory AI Refresh button clears cache and re-fetches
- [ ] PQL signals list shows top 5 signals with weight percentages
- [ ] Connection dot shows red on socket disconnect

---

## 5. Known Limitations (v1)

| ID | Limitation | Planned Fix |
|----|-----------|------------|
| LIM-01 | No dialog search/filter in inbox | v2: search bar with Ctrl+K focus |
| LIM-02 | Quick reply templates are hardcoded | v2: tenant-configurable via admin UI |
| LIM-03 | No file attachment support in message input | v2: FR-16 AI auto-reply draft |
| LIM-04 | Token expiry not handled mid-session | v2: 401 interceptor in proxy |
| LIM-05 | No missed-message recovery on reconnect | v2: re-fetch on socket reconnect |
| LIM-06 | Operator list stats refresh not periodic | v2: 30s polling interval |
| LIM-07 | No dialog status filter in inbox | v2: tab UI (All / Unassigned / Mine) |
