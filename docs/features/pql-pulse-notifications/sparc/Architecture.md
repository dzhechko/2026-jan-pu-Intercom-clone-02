# FR-11: PQL Pulse Notifications -- Architecture

## System Context

PQL Pulse Notifications is a leaf feature within BC-06 (Notifications). It consumes `PQLDetected` events from BC-02 (PQL Intelligence) and delivers real-time alerts to operators via two channels: Socket.io push and email.

```
BC-02 PQL Intelligence                BC-06 Notifications
+------------------+                  +---------------------------+
| PQL Detection    |  PQLDetected     | NotificationService       |
| Rule Engine      | ───event───────> |   processNewPQLDetection()|
|                  |                  |   ├── tier routing         |
+------------------+                  |   ├── dedup check (repo)  |
                                      |   ├── push (Socket.io)    |
                                      |   └── email (stub SMTP)   |
                                      +---------------------------+
                                               │
                                      +--------┴──────────+
                                      │                   │
                                      v                   v
                              Socket.io Push      Email (Stub)
                              operator:{id}       operator email
                              tenant:{id}         admin fallback
```

## Bounded Context Placement

| Layer | Component | File |
|-------|-----------|------|
| Domain | Notification entity, types | `src/notifications/domain/notification.ts` |
| Application | NotificationService | `src/notifications/application/services/notification-service.ts` |
| Application | Tests | `src/notifications/application/services/notification-service.test.ts` |
| Infrastructure | PgNotificationRepository | `src/notifications/infrastructure/repositories/notification-repository.ts` |
| Infrastructure | Email service (stub) | `src/notifications/infrastructure/email-service.ts` |
| Infrastructure | REST routes | `src/notifications/infrastructure/notification-routes.ts` |
| Frontend | NotificationBell component | `app/(workspace)/components/NotificationBell.tsx` |
| Frontend | useNotifications hook | `app/(workspace)/hooks/useNotifications.ts` |

## Data Flow

### 1. PQL Detection -> Notification Processing

```
PQLDetected event (from BC-02)
  └─> NotificationService.processNewPQLDetection(payload)
        ├── Check tier
        │     COLD -> log and return []
        │     WARM/HOT -> continue
        ├── Dedup check: repo.findByDialogId(dialogId)
        │     Existing push found -> return []
        │     No existing -> continue
        ├── Build Socket.io payload
        ├── Emit to operator or tenant room
        ├── Persist push notification
        ├── If HOT:
        │     ├── Format email (HTML with score, tier, signals, link)
        │     ├── Send via EmailService
        │     └── Persist email notification
        └── Return created notifications
```

### 2. Client-Side Real-Time Integration

```
useNotifications hook
  ├── On mount: fetch GET /api/notifications + /unread-count
  ├── Subscribe to Socket.io 'notification:pql'
  │     └── Prepend to list, increment unread, cap at 50
  └── Expose: notifications, unreadCount, markAsRead(), refresh()

NotificationBell component
  ├── Renders bell icon + unread badge (9+ cap)
  ├── Dropdown: list of notifications with tier badge, title, body, time-ago
  ├── Click -> markAsRead + onSelectDialog
  └── Outside click -> close dropdown
```

## Database Schema

```sql
Table: notification_jobs
  id          UUID PRIMARY KEY
  tenant_id   UUID NOT NULL        -- RLS policy
  operator_id VARCHAR NOT NULL     -- 'all' for unassigned, 'admin' for admin emails
  type        VARCHAR NOT NULL     -- 'pql_detected', 'dialog_assigned', 'system'
  channel     VARCHAR NOT NULL     -- 'push', 'email'
  dialog_id   UUID NOT NULL
  title       VARCHAR NOT NULL
  body        TEXT NOT NULL
  metadata    JSONB NOT NULL       -- { score, tier, topSignals, contactEmail }
  read        BOOLEAN DEFAULT false
  created_at  TIMESTAMPTZ DEFAULT NOW()
```

Row-Level Security enabled on `tenant_id` per ADR-007.

## Integration Points

### Server Wiring (server.ts)

The notification system is wired in `src/server.ts`:
- `PgNotificationRepository` instantiated with the shared PostgreSQL pool.
- `StubEmailService` used for email sending (real SMTP deferred).
- `NotificationService` injected into the chat WebSocket namespace via `registerChatNamespace()`.
- REST routes mounted at `/api/notifications`.

### Worker Process (worker.ts)

A cron job runs every 30 seconds for pending notification processing (currently a TODO stub).

## Architectural Decisions

### AD-01: PushEmitter Interface Abstraction
NotificationService depends on a `PushEmitter` interface rather than Socket.io directly. This enables:
- Unit testing with mock emitters.
- Future transport swap (e.g., WebPush, Firebase) without domain changes.

### AD-02: Stub Email Service
Email sending is stubbed to console logging. Real SMTP/Resend integration is toggled via `SMTP_HOST` env var. This avoids external service dependency in development and testing.

### AD-03: Per-Dialog Dedup (Not Per-Detection)
Deduplication is keyed on `dialogId`, not `detectionId`. This means if a PQL score updates within the same dialog, no new notification is sent. This prevents notification spam during score refinement within ongoing conversations.

### AD-04: Operator-First, Tenant-Fallback Routing
Push notifications target the specific operator room when `assignedOperatorId` is set. Otherwise, they fall back to the tenant room, ensuring at least one operator in the tenant receives the alert.

## Cross-BC Isolation (FF-02)

The notifications BC has zero imports from other bounded contexts. It receives data through:
- `PQLNotificationPayload` interface (defined in BC-06 domain).
- REST API calls authenticated via shared JWT middleware.
- Socket.io events on the shared event bus.

No direct imports from `@conversation/*`, `@pql/*`, `@revenue/*`, `@integration/*`, or `@iam/*`.
