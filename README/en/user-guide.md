# Operator Guide

## Overview

This guide is for support operators who use KommuniK daily to handle dialogs, identify purchase-ready clients (PQLs), and leverage Memory AI for contextual responses.

## Operator Workspace

The workspace is a three-panel layout:

```
+------------------+------------------------+-------------------+
|                  |                        |                   |
|  Dialog List     |  Chat Panel            |  Right Panel      |
|                  |                        |                   |
|  - Active        |  - Message history     |  - Client info    |
|  - Unassigned    |  - Reply input         |  - PQL status     |
|  - Closed        |  - Attachments         |  - Memory AI      |
|  - Search        |  - Quick replies       |  - CRM context    |
|                  |                        |  - Deal history   |
+------------------+------------------------+-------------------+
```

### Dialog List (Left Panel)

- **Active:** Dialogs assigned to you, sorted by last message time.
- **Unassigned:** New dialogs waiting for an operator. Click to assign to yourself.
- **Closed:** Completed dialogs (read-only).
- **PQL badges:** Colored dots indicate PQL tier (red = HOT, yellow = WARM).
- **Unread counter:** Shows number of unread messages per dialog.
- **Channel icon:** Shows the source channel (widget, Telegram, VK Max).

### Chat Panel (Center)

- Full message history with timestamps and sender labels.
- Real-time updates via WebSocket.
- Rich text input with markdown support.
- File attachment support (images, documents).
- Quick reply buttons (Alt+1 through Alt+5).

### Right Panel

- **Client Info:** Name, email, company, previous dialog count.
- **PQL Status:** Current PQL tier, score, matched signals.
- **Memory AI:** Automatically loaded CRM context from amoCRM.
- **Deal History:** Past and active deals associated with the client.
- **Notes:** Operator notes for this dialog.

## Dialog Handling

### Assign a dialog

1. Click on an unassigned dialog in the left panel.
2. Click **Assign to me** or press `Ctrl+Enter`.
3. The dialog moves to your Active list.

### Reply to a client

1. Type your response in the message input field.
2. Press `Enter` to send (or `Shift+Enter` for a new line).
3. Messages are delivered through the same channel the client used (widget, Telegram, or VK Max).

### Close a dialog

1. Click the **Close** button in the chat header, or press `Ctrl+W`.
2. Optionally add a closing note.
3. The dialog moves to the Closed section.
4. If a PQL was detected, revenue attribution is triggered automatically.

### Transfer a dialog

1. Click the **Transfer** button in the chat header.
2. Select the target operator from the dropdown.
3. Optionally add a transfer note visible to the receiving operator.

## PQL Indicators

### Tier display

| Tier | Badge Color | Score Range | Meaning |
|------|:-----------:|:-----------:|---------|
| HOT | Red | >= 0.80 | Client is ready to buy. Prioritize this dialog. |
| WARM | Yellow | 0.65 - 0.79 | Client shows purchase interest. Monitor closely. |
| COLD | Gray | < 0.65 | No significant purchase signals detected. |

### Where PQL indicators appear

- **Dialog list:** Colored dot next to the dialog title.
- **Chat header:** PQL tier badge with score.
- **Right panel:** Detailed breakdown of matched signals with individual weights.

### PQL signal details

Click on the PQL badge in the right panel to see which signals were matched:

```
PQL Score: 0.85 (HOT)
Matched Signals:
  - "how much does it cost"      → Pricing   (0.20)
  - "can we get a trial"         → Trial     (0.18)
  - "need 50 user seats"         → Scaling   (0.20)
  - "ready to purchase"          → Buying    (0.25)
```

### PQL feedback

If the PQL detection is incorrect, provide feedback:

1. Click the thumbs up/down icon next to the PQL badge.
2. Select the reason (false positive, wrong tier, missed signal).
3. Feedback is used to improve future detection accuracy.

## Memory AI

Memory AI automatically loads CRM context when you open a dialog, giving you relevant information before you type a single word.

### What Memory AI shows

- **Contact details** from amoCRM (name, company, position, phone).
- **Active deals** with stage, value, and responsible manager.
- **Recent interactions** (calls, emails, meetings from CRM).
- **Previous support dialogs** summary.
- **Custom fields** configured in amoCRM.

### How it works

1. When a dialog is assigned, KommuniK identifies the client (by email or phone).
2. The amoCRM MCP adapter fetches the client's CRM profile.
3. Context is displayed in the right panel within 1-2 seconds.
4. If no CRM match is found, Memory AI shows "No CRM context available."

### Using Memory AI effectively

- Check deal stage before responding to pricing questions.
- Reference past interactions to personalize your response.
- Note the responsible sales manager for warm handoffs.

## Quick Replies

Quick replies are pre-configured response templates accessible via keyboard shortcuts.

### Using quick replies

- Press `Alt+1` through `Alt+5` to insert a quick reply template.
- The template is inserted into the message input (not sent automatically).
- Edit the template before sending if needed.

### Default quick replies

| Shortcut | Template |
|----------|----------|
| Alt+1 | "Thank you for reaching out! Let me look into this for you." |
| Alt+2 | "Could you please provide more details about the issue?" |
| Alt+3 | "I'll transfer you to our specialist who can help with this." |
| Alt+4 | "Is there anything else I can help you with?" |
| Alt+5 | "Thank you for contacting us! Have a great day." |

Quick replies can be customized by administrators via Settings.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Assign selected dialog to yourself |
| `Enter` | Send message |
| `Shift+Enter` | New line in message input |
| `Ctrl+W` | Close current dialog |
| `Ctrl+K` | Open search |
| `Ctrl+/` | Show keyboard shortcuts help |
| `Alt+1..5` | Insert quick reply template |
| `Ctrl+Up` | Previous dialog in list |
| `Ctrl+Down` | Next dialog in list |
| `Ctrl+Shift+U` | Toggle unassigned dialogs filter |
| `Ctrl+Shift+P` | Toggle PQL filter (show only PQL dialogs) |
| `Esc` | Close right panel / cancel action |
| `Ctrl+N` | Focus on message input |
| `Ctrl+Shift+T` | Transfer dialog |

## Filtering and Search

### Search

Press `Ctrl+K` to open the search bar. Search across:

- Client name or email.
- Message content.
- Dialog ID.

### Filters

Use the filter bar above the dialog list:

| Filter | Options |
|--------|---------|
| Status | Active, Unassigned, Closed, All |
| Channel | Widget, Telegram, VK Max, All |
| PQL Tier | HOT, WARM, COLD, Any |
| Assigned to | Me, Unassigned, Specific operator, All |
| Date range | Today, Last 7 days, Last 30 days, Custom |

Filters can be combined. Active filters are shown as removable chips above the dialog list.

### Sorting

Dialogs can be sorted by:

- **Last message** (default) — most recent activity first.
- **PQL score** — highest PQL score first.
- **Created date** — newest dialogs first.
- **Unread count** — most unread messages first.
