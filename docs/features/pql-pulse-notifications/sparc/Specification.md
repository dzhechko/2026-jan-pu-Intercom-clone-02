# FR-11: PQL Pulse Notifications -- Specification

## User Stories

### US-01: Real-Time Push Notification on PQL Detection
**As an** Operator,
**I want to** receive a real-time push notification when a HOT or WARM PQL lead is detected in a dialog I am handling,
**So that** I can respond to high-value opportunities immediately without polling or refreshing.

**Acceptance Criteria:**
- AC-01.1: When a HOT PQL is detected, a push notification is emitted via Socket.io to the operator's room.
- AC-01.2: When a WARM PQL is detected, a push notification is emitted via Socket.io to the operator's room.
- AC-01.3: When a COLD PQL is detected, no push notification is sent.
- AC-01.4: If no operator is assigned, the push notification is sent to the tenant-wide room.

### US-02: Email Notification for HOT Leads
**As an** Operator,
**I want to** receive an email when a HOT PQL lead is detected,
**So that** I do not miss high-value opportunities even when I am offline or away from the workspace.

**Acceptance Criteria:**
- AC-02.1: HOT tier triggers an email with PQL score, tier, top signals, contact email, and a link to the dialog.
- AC-02.2: WARM tier does not trigger an email.
- AC-02.3: COLD tier does not trigger an email.
- AC-02.4: Email is sent to the assigned operator's address, or admin fallback if unassigned.

### US-03: Notification Bell with Unread Badge
**As an** Operator,
**I want to** see a notification bell icon with an unread count badge in my workspace,
**So that** I know at a glance whether there are new PQL leads to review.

**Acceptance Criteria:**
- AC-03.1: Bell icon displays a red badge with the unread count.
- AC-03.2: Unread count caps at "9+" for counts above 9.
- AC-03.3: Clicking the bell opens a dropdown with the notification list.
- AC-03.4: Outside click closes the dropdown.

### US-04: Navigate to Dialog from Notification
**As an** Operator,
**I want to** click a notification to navigate directly to the relevant dialog,
**So that** I can take action on the PQL lead immediately.

**Acceptance Criteria:**
- AC-04.1: Clicking a notification calls `onSelectDialog(dialogId)` and closes the dropdown.
- AC-04.2: Unread notifications are marked as read upon click.
- AC-04.3: Each notification displays the tier badge, title, body, contact email (if available), and relative time.

### US-05: Notification Management
**As an** Operator,
**I want to** view my notifications with pagination and mark them as read,
**So that** I can manage my notification queue efficiently.

**Acceptance Criteria:**
- AC-05.1: `GET /api/notifications` returns paginated results (limit 1-100, offset >= 0, validated with Zod).
- AC-05.2: `GET /api/notifications/unread-count` returns the number of unread notifications.
- AC-05.3: `PATCH /api/notifications/:id/read` marks a notification as read and returns success.
- AC-05.4: Non-existent notification ID returns 404.

### US-06: Duplicate Prevention
**As an** Operator,
**I want** the system to prevent duplicate notifications for the same dialog,
**So that** I am not spammed when a PQL score updates within an ongoing conversation.

**Acceptance Criteria:**
- AC-06.1: If a `pql_detected` push notification already exists for a dialogId, no new notifications are created.
- AC-06.2: Different dialogs produce independent notifications.

## Domain Types

| Type | Fields | Description |
|------|--------|-------------|
| `Notification` | id, tenantId, operatorId, type, channel, dialogId, title, body, metadata, read, createdAt | Persisted notification entity |
| `NotificationType` | `'pql_detected' \| 'dialog_assigned' \| 'system'` | Type discriminator |
| `NotificationChannel` | `'push' \| 'email'` | Delivery channel |
| `PQLNotificationPayload` | detectionId, dialogId, tenantId, score, tier, topSignals, contactEmail, assignedOperatorId | Input from PQL detection |

## API Contract

### GET /api/notifications
- **Query:** `{ limit: number (1-100, default 50), offset: number (>=0, default 0) }`
- **Response:** `{ notifications: Notification[] }`
- **Auth:** Bearer JWT

### GET /api/notifications/unread-count
- **Response:** `{ count: number }`
- **Auth:** Bearer JWT

### PATCH /api/notifications/:id/read
- **Response:** `{ success: true }` or `{ error: "Notification not found" }` (404)
- **Auth:** Bearer JWT

## Socket.io Event

### `notification:pql` (Server -> Client)
```json
{
  "type": "pql_detected",
  "dialogId": "string",
  "score": 0.92,
  "tier": "HOT",
  "topSignals": [{ "type": "PURCHASE", "weight": 0.6 }],
  "contactEmail": "lead@example.com",
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```
