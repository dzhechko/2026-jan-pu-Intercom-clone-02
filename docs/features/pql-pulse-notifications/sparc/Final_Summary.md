# FR-11: PQL Pulse Notifications -- Final Summary

## Implementation Status: COMPLETE

FR-11 PQL Pulse Notifications is fully implemented across backend (BC-06 Notifications) and frontend (Operator Workspace). The feature delivers real-time, tier-based notifications to operators when PQL leads are detected in support dialogs.

## Files Implemented

### Backend (BC-06 Notifications)

| File | Purpose | Lines |
|------|---------|-------|
| `src/notifications/domain/notification.ts` | Domain types: Notification entity, NotificationType, NotificationChannel, PQLNotificationPayload | 37 |
| `src/notifications/application/services/notification-service.ts` | Core service: tier-based routing, dedup, push + email, persistence | 169 |
| `src/notifications/application/services/notification-service.test.ts` | 11 unit tests: all tiers, dedup, formatting, payload structure | 275 |
| `src/notifications/infrastructure/repositories/notification-repository.ts` | Repository interface + PgNotificationRepository (CRUD, RLS) | 138 |
| `src/notifications/infrastructure/notification-routes.ts` | REST API: GET list, GET unread-count, PATCH mark-as-read | 87 |
| `src/notifications/infrastructure/email-service.ts` | EmailService interface, StubEmailService, formatPQLNotificationEmail() | 82 |

### Frontend (Operator Workspace)

| File | Purpose | Lines |
|------|---------|-------|
| `app/(workspace)/components/NotificationBell.tsx` | Bell icon, unread badge, dropdown, tier badges, time-ago | 164 |
| `app/(workspace)/hooks/useNotifications.ts` | React hook: REST fetch, Socket.io listener, real-time merge, markAsRead | 146 |

### Integration Points

| File | Integration |
|------|-------------|
| `src/server.ts` | Wires NotificationService, mounts /api/notifications routes, injects into WebSocket namespace |
| `src/worker.ts` | Cron job stub for notification processing (30s interval) |

## Key Design Decisions

1. **Tier-Based Routing:** HOT = push + email, WARM = push only, COLD = log only. Simple, predictable, zero configuration.
2. **Per-Dialog Deduplication:** Prevents notification spam when PQL scores update within the same dialog.
3. **PushEmitter Abstraction:** Decouples NotificationService from Socket.io, enabling clean unit testing and future transport swap.
4. **Stub Email Service:** Email is logged, not sent. Production SMTP toggled via SMTP_HOST env var.
5. **Client-Side Real-Time Merge:** Hook combines REST history with live Socket.io events, capping at 50 notifications.
6. **Operator-First Routing:** Push targets specific operator room; falls back to tenant room if unassigned.

## Test Coverage

11 unit tests in `notification-service.test.ts`:
- HOT tier: 2 tests (push+email sent; tenant room fallback)
- WARM tier: 1 test (push only, no email)
- COLD tier: 1 test (no notifications)
- Duplicate prevention: 2 tests (same dialog skipped; different dialogs independent)
- Notification formatting: 3 tests (title/body content; contactEmail present; contactEmail null)
- Push payload structure: 1 test (exact Socket.io payload shape)
- All tests use mocked repository, email service, and push emitter.

## Architectural Compliance

| Fitness Function | Status | Notes |
|------------------|--------|-------|
| FF-02: No cross-BC imports | PASS | Zero imports from other BCs; uses only @notifications/* and @shared/* |
| FF-03: Tenant RLS isolation | PASS | notification_jobs table uses RLS on tenant_id |
| FF-04: Circuit Breaker | N/A | No external MCP calls in notification BC |
| FF-10: Data residency | PASS | All data in PostgreSQL on Russian VPS |

## API Surface

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notifications` | GET | Paginated notification list (Zod-validated limit/offset) |
| `/api/notifications/unread-count` | GET | Unread count for current operator |
| `/api/notifications/:id/read` | PATCH | Mark notification as read |

| Socket.io Event | Direction | Description |
|-----------------|-----------|-------------|
| `notification:pql` | Server -> Client | Real-time PQL notification payload |

## Known Limitations (v1)

1. Email service is a stub -- requires SMTP_HOST configuration for production.
2. Email recipient resolution uses placeholder addresses (`operator-{id}@kommuniq.local`).
3. Worker cron for batch notification processing is a TODO.
4. No operator notification preferences (mute, digest mode).
5. Per-dialog dedup prevents re-notification on tier upgrades (WARM -> HOT).
6. No retry mechanism for failed notification persistence.
