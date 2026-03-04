# PRD: FR-07 Operator Workspace
**Feature ID:** FR-07
**Status:** Implemented
**BC:** BC-01 Conversation Context
**Date:** 2026-03-04

---

## 1. Overview

The Operator Workspace is the primary interface for support operators at КоммуниК. It provides a unified inbox combining all incoming channels (Web Chat, Telegram, VK Max) in a single view, with real-time updates via Socket.io, integrated PQL Intelligence signals, Memory AI CRM context, quick replies, and keyboard shortcuts for high-velocity operation.

**Core Value Proposition:** Turn every support interaction into a revenue opportunity by surfacing PQL signals and CRM context at the moment the operator reads the message.

---

## 2. Problem Statement

Support operators working with multiple communication channels (web chat, Telegram, VK Max) must today switch between several tools. They have no visibility into a client's purchase intent or CRM history when they respond. Hot leads go unrecognized and cold. Context is manually looked up in amoCRM. Time-to-first-response suffers.

**КоммуниК solves this by:**
- Unifying all channels in one queue, sorted by PQL tier (HOT first)
- Auto-loading CRM context (Memory AI) before the operator types a word
- Displaying PQL score and matched signals inline
- Providing keyboard shortcuts so operators never leave the keyboard

---

## 3. User Stories

### US-04 [MUST] — Unified Inbox
```
As an operator,
I want to see messages from all channels (Web Chat, Telegram, VK Max) in a single queue,
So that I do not switch between tabs.
Acceptance: Unified inbox with priority sort (PQL HOT first). New dialog appears within 3 seconds.
```

### US-01 [MUST] — PQL Flag
```
As an operator,
I want to see a HOT/WARM badge on a dialog when the client shows purchase intent signals,
So that I can immediately involve sales without manual analysis.
Acceptance: PQL flag appears <2 seconds after the triggering message.
```

### US-03 [MUST] — Memory AI
```
As an operator,
I want to see the client's full amoCRM history (plan, open deals, previous dialogs)
before I type my first word,
So that I never ask the same question twice.
Acceptance: CRM panel loads <1 second after dialog selection.
```

### US-05 [SHOULD] — PQL Pulse Notifications
```
As an operator,
I want to receive a real-time notification when the system detects a hot lead in a dialog,
So that I can react while the client is still online.
Acceptance: PQL Pulse arrives <30 seconds after the trigger message.
```

### US-KB [MUST] — Keyboard Efficiency (FR-14)
```
As a high-volume operator,
I want keyboard shortcuts for all common actions (send message, navigate dialogs, quick replies),
So that I can handle 3x more dialogs per shift without mouse.
Acceptance: All 13 shortcuts function correctly; a help modal shows them on "?".
```

---

## 4. Functional Requirements

### FR-07.1 — Unified Inbox (Dialog List)
- Display all OPEN and ASSIGNED dialogs for the authenticated operator's tenant
- Sort order: HOT PQL first, then WARM, then COLD/unscored, then by last message time (most recent)
- Each row shows: contact name/email, channel badge (Web/TG/VK), PQL tier badge, last message preview, time-ago, unread count badge, status indicator dot
- Real-time updates: new dialogs and new messages appear without page refresh via Socket.io `message:new` and `dialog:created` events
- PQL tier updates arrive via `pql:detected` event and re-sort the list

### FR-07.2 — Message Panel (Chat Area)
- On dialog selection: fetch up to 100 messages from REST API (`GET /dialogs/:id/messages?limit=100`)
- Auto-scroll to bottom on new messages and on typing indicator
- Inbound messages (client) aligned left, gray bubble; outbound (operator) aligned right, blue bubble
- Sender badge: CLIENT / OPERATOR / BOT
- Typing indicator: animated dots when `typing` event received with `senderType: 'CLIENT'`
- Typing send: debounced — emit `typing` event 2s after operator stops typing
- Send message: REST POST + Socket.io emit `operator:message` for instant broadcast
- Input cleared when dialog changes

### FR-07.3 — Right Panel (PQL + Memory AI + Actions)
- **PQL Score Section:** displays numeric score (0–1) and colored tier label (HOT=red, WARM=orange, COLD=gray). Fetches top signals from `GET /pql/detections/:dialogId` on dialog selection; shows up to 5 signals with type and weight percentage
- **Contact Info:** email, channel, status, assigned operator
- **Memory AI (CRM Context):** fetches from `GET /memory/:dialogId`; handles states: idle, loading, ok, not_configured, no_email, error; shows contact name, current plan, account age, previous dialog count, tags, deals with status/value; enrichment score progress bar; manual refresh button
- **Quick Replies:** 5 templates (Alt+1..5) — "Connect specialist", "Request email", "24h follow-up", "Demo offer", "Transfer to sales"
- **Actions:** Assign to me (when OPEN and not assigned to current operator), Close dialog, Archive (when CLOSED), Unassign (when ASSIGNED), Reassign dropdown (FR-13, shows online operators only)

### FR-07.4 — Top Bar
- КоммуниК branding, "Operator Workspace" label
- Socket.io connection indicator: green dot (connected) / red dot (disconnected)
- "?" button to open keyboard shortcuts help modal
- Notification bell (FR-11): badge with unread PQL notification count, dropdown with list
- Operator email display
- Logout button

### FR-07.5 — Keyboard Shortcuts (FR-14)
| Shortcut | Action |
|----------|--------|
| Ctrl+Enter | Send current message |
| Ctrl+K | Focus search/filter input |
| Alt+ArrowUp | Previous dialog |
| Alt+ArrowDown | Next dialog |
| Alt+N | Jump to next unassigned dialog |
| Alt+A | Assign current dialog to me |
| Alt+C | Close current dialog |
| Alt+1..5 | Send quick reply #1..5 |
| Escape | Deselect dialog / close panels |
| ? | Toggle keyboard shortcuts help modal |

### FR-07.6 — Authentication Guard
- Layout checks localStorage for JWT token and operator profile
- Verifies token via `GET /auth/me` on mount
- Redirects to `/login` if token missing or invalid

### FR-07.7 — Operator Presence (FR-13)
- `useOperators` hook fetches all operators and cross-references with online list
- Real-time updates via `operator:online` and `operator:offline` Socket.io events
- `OperatorList` component shows online (green dot) and offline (gray dot) operators with active dialog count

### FR-07.8 — Notifications (FR-11)
- `useNotifications` hook fetches initial list from `GET /api/notifications?limit=20`
- Real-time: `notification:pql` Socket.io event creates an in-memory notification entry
- `NotificationBell` shows bell icon with red badge for unread count
- Dropdown lists recent PQL notifications with tier badge, title, body, contact email, time-ago
- Click on notification: marks as read (PATCH) + selects the dialog

---

## 5. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-03 | Message delivery latency | <500ms p95 via WebSocket |
| NFR-W01 | Dialog list load | <1 second on initial fetch |
| NFR-W02 | Memory AI CRM panel load | <1 second after dialog select |
| NFR-W03 | Socket.io reconnect | Auto-reconnect, up to 10 attempts, 1s delay |
| NFR-W04 | Quick reply send | <200ms perceived (optimistic UI) |
| NFR-W05 | Auth guard check | <500ms before showing workspace |

---

## 6. Out of Scope (FR-07 v1)

- Full-text search across messages
- Dialog filters (by channel, date, operator)
- File/image attachment sending
- Audio/video messages
- Canned responses management UI (currently hardcoded)
- AI auto-reply draft (FR-16, future)
- Confluence KB suggestions (FR-15, future)
- Email channel

---

## 7. Acceptance Criteria (BDD Summary)

From `docs/test-scenarios.feature` — Operator Workspace section:

1. New Telegram message appears in workspace queue within 3 seconds
2. PQL dialogs sort above regular dialogs (HOT > WARM > rest)
3. Dialog assignment sets status to ASSIGNED, broadcasts to other operators
4. WebSocket reconnects automatically after 10-second interruption; no messages lost

---

## 8. Dependencies

| Dependency | Type | Detail |
|------------|------|--------|
| BC-01 Conversation | Domain | Provides Dialog and Message aggregates, WebSocket events |
| BC-02 PQL Intelligence | Consumer | Provides `pql:detected` events and `/pql/detections/:id` endpoint |
| BC-04 Integration (amoCRM MCP) | Consumer | Provides `/memory/:dialogId` CRM context endpoint |
| BC-05 IAM | Consumer | JWT auth, operator profiles, presence service |
| BC-06 Notifications | Consumer | PQL Pulse notifications via REST and Socket.io |
| Socket.io `/chat` namespace | Infrastructure | Real-time bidirectional communication |
| Next.js API proxy `/api/proxy/` | Infrastructure | Routes frontend requests to backend Express server |
