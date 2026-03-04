# FR-11: PQL Pulse Notifications -- Refinement

## Edge Cases

### EC-01: Rapid PQL Score Updates in Same Dialog
**Scenario:** PQL score for a dialog changes from 0.70 (WARM) to 0.85 (HOT) within seconds.
**Current Behavior:** Only the first detection (WARM) triggers a notification. The second detection (HOT) is suppressed by the per-dialog dedup check.
**Risk:** Medium -- operator misses the tier upgrade from WARM to HOT.
**Mitigation (v2):** Consider allowing re-notification when tier upgrades (WARM -> HOT) by checking the existing notification's tier before suppressing.

### EC-02: Operator Not Connected to Socket.io
**Scenario:** Operator is assigned but not connected to their Socket.io room.
**Current Behavior:** Push notification is emitted to the room but no client receives it. The notification is persisted and will appear in the REST API list on next load.
**Risk:** Low -- email fallback exists for HOT leads, and the notification bell will show it on next page load.
**Mitigation:** Already handled by email for HOT tier. WARM tier has no fallback (acceptable for SHOULD priority).

### EC-03: No Operator Assigned to Dialog
**Scenario:** PQL is detected in a dialog with no assigned operator.
**Current Behavior:** Push notification falls back to `tenant:{tenantId}` room, reaching all operators in the tenant. Email goes to `admin@kommuniq.local`.
**Risk:** Low -- all operators see the notification.
**Mitigation:** None needed; tenant-wide broadcast is the correct fallback.

### EC-04: Concurrent PQL Detections for Same Dialog
**Scenario:** Two PQL detection events arrive simultaneously for the same dialog (race condition).
**Current Behavior:** Both check `findByDialogId()` before either persists. Both may proceed past the dedup check, resulting in duplicate notifications.
**Risk:** Low -- requires exact timing and is unlikely with Redis Stream sequential processing.
**Mitigation (v2):** Add a unique constraint on `(dialog_id, type, channel)` in the database, using `ON CONFLICT DO NOTHING` (already in the INSERT query).

### EC-05: Email Service Failure
**Scenario:** StubEmailService (or future SMTP) throws an error during send.
**Current Behavior:** The error propagates up. Push notification has already been sent and persisted, but email notification is not persisted.
**Risk:** Medium -- partial notification delivery (push succeeds, email fails).
**Mitigation (v2):** Wrap email sending in try/catch, log the failure, and optionally persist a failed email notification for retry.

### EC-06: Very High Notification Volume
**Scenario:** A tenant receives 100+ HOT PQL detections in a short period (e.g., marketing campaign).
**Current Behavior:** Each unique dialog generates a notification. The frontend caps at 50 in-memory.
**Risk:** Low-medium -- operator may be overwhelmed.
**Mitigation (v2):** Consider notification batching or digest mode for high-volume tenants.

### EC-07: Missing or Null Contact Email
**Scenario:** PQL detection has no `contactEmail`.
**Current Behavior:** `contactEmail` is set to `null` in metadata. The NotificationBell conditionally renders contact email only when present.
**Risk:** None -- handled gracefully.

### EC-08: Invalid Pagination Parameters
**Scenario:** Client sends `limit=-1` or `offset=abc` to the notifications API.
**Current Behavior:** Zod validation catches invalid parameters and returns HTTP 400 with error details.
**Risk:** None -- handled by Zod schema validation.

## Risks

### R-01: Stub Email Service in Production
**Severity:** Medium
**Description:** The email service is currently a stub that logs to console. In production, HOT lead emails will not actually be delivered until SMTP is configured.
**Mitigation:** Feature is gated by `SMTP_HOST` env var. Document the requirement for SMTP configuration before production deployment.

### R-02: No Retry Mechanism for Failed Notifications
**Severity:** Low
**Description:** If notification persistence fails, the notification is lost. There is no retry queue.
**Mitigation (v2):** Implement a dead-letter queue in Redis for failed notification deliveries.

### R-03: Worker Cron Stub
**Severity:** Low
**Description:** The worker process has a 30-second cron job for notification processing, but the handler is a TODO stub.
**Mitigation:** The primary notification path (synchronous via NotificationService) works. The cron is for future batch processing.

### R-04: Real-Time Notification ID Collisions
**Severity:** Low
**Description:** Client-side real-time notifications use `rt-{Date.now()}` as ID, which could collide if two notifications arrive in the same millisecond.
**Mitigation:** Probability is extremely low. When the user refreshes, server-generated UUIDs replace the temporary IDs.

## Technical Debt

- **TD-01:** Email recipient resolution is hardcoded (`operator-{id}@kommuniq.local`). Needs integration with IAM to resolve actual operator email addresses.
- **TD-02:** Worker cron for notification processing is a stub (TODO in `worker.ts`).
- **TD-03:** No notification preferences per operator (e.g., mute WARM notifications).
- **TD-04:** No notification grouping/batching for high-volume scenarios.
- **TD-05:** `recipients` variable in NotificationService (line 111-113) contains dead code that should be cleaned up.
