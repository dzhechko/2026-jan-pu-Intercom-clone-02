# FR-11: PQL Pulse Notifications
**Status:** Done | **BC:** BC-06 Notifications | **Priority:** SHOULD

## Summary
Tier-based notification system that alerts operators when PQL leads are detected in dialogs. HOT leads trigger both push (Socket.io) and email notifications; WARM leads trigger push only; COLD leads are logged but produce no notifications. Includes duplicate prevention, a bell icon with unread badge in the operator workspace, and REST API for notification management.

## User Stories
- US-01: As an Operator, I want to receive real-time push notifications when a HOT or WARM PQL lead is detected so that I can respond quickly.
- US-02: As an Operator, I want to receive an email for HOT PQL leads so that I do not miss high-value opportunities even when offline.
- US-03: As an Operator, I want to see a notification bell with unread count so that I know there are new PQL leads at a glance.
- US-04: As an Operator, I want to click a notification to navigate to the relevant dialog so that I can take action immediately.

## Technical Design

### Files Created
- `src/notifications/domain/notification.ts` — Domain types: Notification entity, NotificationType (`pql_detected | dialog_assigned | system`), NotificationChannel (`push | email`), PQLNotificationPayload.
- `src/notifications/application/services/notification-service.ts` — Core service: tier-based routing (HOT=push+email, WARM=push, COLD=skip), duplicate prevention via repo lookup, Socket.io push via PushEmitter interface, notification persistence.
- `src/notifications/application/services/notification-service.test.ts` — 11 tests covering all tiers, duplicate prevention, operator/tenant room routing, notification formatting, payload structure.
- `src/notifications/infrastructure/repositories/notification-repository.ts` — NotificationRepository interface + PgNotificationRepository: save, findByDialogId, findByOperatorId (paginated), countUnread, markAsRead. Uses `notification_jobs` table with RLS.
- `src/notifications/infrastructure/notification-routes.ts` — Express router: GET `/api/notifications` (paginated list), GET `/api/notifications/unread-count`, PATCH `/api/notifications/:id/read`. Zod validation for pagination params.
- `src/notifications/infrastructure/email-service.ts` — EmailService interface + StubEmailService (logs to console). formatPQLNotificationEmail() generates HTML email with tier badge, score, signals list, and dialog link.
- `app/(workspace)/components/NotificationBell.tsx` — Bell icon with unread badge (red circle, 9+ cap), dropdown with notification list showing tier badge, title, body, contact email, time-ago, and unread dot. Outside-click to close.
- `app/(workspace)/hooks/useNotifications.ts` — React hook: fetches notifications from REST API, listens for `notification:pql` Socket.io events, prepends real-time notifications, manages unread count, provides markAsRead() and refresh().

### Key Decisions
- **Tier-based routing:** Notification behavior is entirely determined by PQL tier. This keeps the logic simple and predictable: HOT=push+email, WARM=push, COLD=nothing.
- **Duplicate prevention per dialog:** Before sending, the service checks if a `pql_detected` push notification already exists for the dialogId. Prevents notification spam when PQL score updates within the same dialog.
- **PushEmitter abstraction:** NotificationService depends on a PushEmitter interface (not Socket.io directly), making it testable and allowing future transport swaps.
- **Stub email service:** Email sending is stubbed (logs to console). Real SMTP/Resend integration is deferred, toggled via SMTP_HOST env var.
- **Client-side real-time merge:** useNotifications hook merges REST-fetched history with live Socket.io events, capping at 50 notifications to prevent memory growth.
- **Operator-targeted routing:** If assignedOperatorId exists, push goes to `operator:{id}` room; otherwise falls back to `tenant:{id}` room for all operators.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | List operator's notifications (pagination: limit, offset) |
| GET | `/api/notifications/unread-count` | Count of unread notifications for current operator |
| PATCH | `/api/notifications/:id/read` | Mark a single notification as read |

## Socket.io Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `notification:pql` | Server -> Client | `{ type, dialogId, score, tier, topSignals, contactEmail, timestamp }` |

## Dependencies
- Depends on: FR-02 (PQL Detection emits PQLDetected events that trigger notifications), FR-01 (IAM/JWT for REST API auth), BC-01 (Dialog context for contactEmail)
- Blocks: None (leaf feature)

## Tests
- `src/notifications/application/services/notification-service.test.ts` — 11 tests covering:
  - **HOT tier (2 tests):** push + email sent, 2 notifications persisted; tenant room fallback when no operator assigned
  - **WARM tier (1 test):** push only, no email, 1 notification persisted
  - **COLD tier (1 test):** no notifications sent, no persistence, no push/email calls
  - **Duplicate prevention (2 tests):** skip when push notification already exists for dialog; allow different dialogs
  - **Notification formatting (3 tests):** title contains tier label, body contains score% and signal types, metadata includes contactEmail (or null gracefully)
  - **Push payload structure (1 test):** validates exact Socket.io payload shape (type, dialogId, score, tier, topSignals, contactEmail, timestamp)

## Acceptance Criteria
- [x] HOT PQL detection sends both push notification and email to assigned operator
- [x] WARM PQL detection sends push notification only (no email)
- [x] COLD PQL detection is logged but triggers no notifications
- [x] Duplicate push notifications are prevented for the same dialog
- [x] Push notification targets operator room if assigned, tenant room otherwise
- [x] Notification bell shows unread count badge (caps at 9+)
- [x] Clicking a notification navigates to the relevant dialog
- [x] Notifications can be marked as read via PATCH API
- [x] Real-time notifications appear instantly via Socket.io without page refresh
- [x] Notification list supports pagination (limit/offset with zod validation)
- [x] Email includes PQL score, tier, top signals, contact info, and direct link to dialog
