# Brutal Honesty Review: FR-11 PQL Pulse Notifications

**Feature ID:** FR-11
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** CONDITIONAL APPROVAL — 2 critical gaps before production

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — FAIL (in caller, not in BC-06)

BC-06 itself is clean — zero imports from other bounded contexts. The notifications BC correctly defines its own `PQLNotificationPayload` interface and accepts data through it.

**However**, the caller in BC-02 (`src/pql/infrastructure/message-consumer.ts` line 3) imports `NotificationService` directly from `@notifications/application/services/notification-service`. This cross-BC import was flagged in the FR-01 review and is still present in FR-11. The situation has not improved.

**Severity:** LOW — BC-06 is isolated; the violation is in BC-02's caller. But this is the second feature that has shipped with this known issue. At some point "known technical debt" becomes "ignored architectural constraint."

**Fix:** Define a `PQLNotificationPort` interface in `src/pql/domain/ports/notification.port.ts`. Have `NotificationService` implement it via an adapter. Inject the port — not the concrete class — into `message-consumer.ts`.

---

### FF-03: Tenant RLS Isolation — PARTIAL FAIL

This is the most significant finding in this review.

The tenant middleware (`createTenantMiddleware`) correctly acquires a dedicated `PoolClient`, calls `SET app.tenant_id` on it, and attaches it as `req.dbClient`. This is the RLS-scoped client.

**The notification repository (`PgNotificationRepository`) does not use `req.dbClient`. It uses `this.pool.query()` directly.** Pool queries get arbitrary connections from the pool. The RLS GUC set on `req.dbClient` does NOT apply to other pool connections. Every repository call — `findByDialogId`, `findByOperatorId`, `countUnread`, `markAsRead` — runs on a connection where `app.tenant_id` may be unset or set to a different tenant's value.

The practical consequence: **if RLS policies are enforced via `current_setting('app.tenant_id')`, they will not work reliably with pool connections**. Tenant A could potentially read Tenant B's notifications.

This is the same pattern used in `src/conversation/infrastructure/repositories/dialog-repository.ts` and `src/pql/infrastructure/repositories/pql-detection-repository.ts`, so it appears to be a systemic gap across the entire codebase — not unique to FR-11. But that does not make it correct, and it is especially serious for a notification table that contains PQL intelligence signals (business-sensitive data).

**Severity:** CRITICAL — FF-03 is listed as a deploy-blocking fitness function.

**Fix:** `PgNotificationRepository` constructor should accept `Pool | PoolClient`. The `createNotificationRouter` function receives `pool` and passes it straight to the repository — but it should be updated to accept the RLS-scoped `req.dbClient` per request. The simplest approach: make the router accept the pool (for instantiation), then pass `req.dbClient` to repository methods that need RLS isolation, or restructure repository construction per-request using the dedicated client.

---

### FF-03 (continued): `processNewPQLDetection` called from Redis Stream — No RLS at all

The primary notification write path is called from `message-consumer.ts` via Redis Stream, which has no HTTP request context and therefore no `req.dbClient`. The `PgNotificationRepository` is instantiated with the global pool. For this path:

1. No `SET app.tenant_id` is ever called before the INSERT.
2. No tenant isolation exists on the persistence write.

The `findByDialogId` dedup check (also using the pool directly) could return results from other tenants if RLS is not configured as permissive for unset sessions. If RLS is configured to block unset sessions, the INSERT would fail silently (the code swallows the error and rethrows, but the silent-swallow pattern in `findByDialogId` — which returns `[]` on error — could mask RLS rejections and bypass dedup).

**Severity:** CRITICAL — This is not theoretical. The Redis Stream path is the primary path. HOT PQL writes happen here without any tenant context.

**Fix:** For the Redis Stream path, the tenantId is available in the `PQLNotificationPayload`. Before repository operations, acquire a client from the pool, call `SET app.tenant_id`, perform the operations, then release. Wrap this in a helper: `withTenantContext(pool, tenantId, async (client) => ...)`.

---

### FF-04: Circuit Breaker — N/A

BC-06 makes no external MCP calls. No circuit breaker needed. Correct assessment.

---

### FF-10: Data Residency — PASS

StubEmailService logs to console, no external API calls. All notification data goes to PostgreSQL (configured for Russian VPS). When real SMTP is wired, the email will go to a configured SMTP host — this needs a data residency check before enabling in production, but the v1 stub is compliant.

---

## 2. Code Quality Review

### Strengths

1. **PushEmitter abstraction is genuinely good.** Decoupling from Socket.io through an interface enables clean unit testing. This is the right pattern.

2. **Tier-based routing is clear and readable.** The `processNewPQLDetection` method reads like the pseudocode. No hidden complexity.

3. **Zod validation on REST API.** The `PaginationSchema` correctly validates limit and offset. HTTP 400 responses are well-formed.

4. **Email template is production-quality.** Inline CSS, tier emoji, direct CTA link — this is not a placeholder. It would render correctly in real email clients.

5. **`useNotifications` hook correctly avoids double-fetch.** The `initialFetchDone` ref prevents duplicate REST calls on re-renders.

6. **Outside-click handling in NotificationBell is correct.** Uses `mousedown` (not `click`) to catch events before state changes. The cleanup function is returned properly.

---

### Issues Found

#### Issue 1: Dead code in `notification-service.ts` lines 111-113 (LOW)

```typescript
const recipients = [
  detection.contactEmail ? undefined : undefined, // Operator email would come from user service
].filter(Boolean) as unknown as string[]
```

This code is not just dead — it is actively misleading. It suggests that recipients are being computed but they are not. The `as unknown as string[]` cast is a code smell. The variable `recipients` is never used.

The original intent (resolve operator email from IAM service) was never implemented. Instead, a hardcoded placeholder email is used two lines later. This should either be implemented or removed.

**Fix:** Delete lines 111-113. Add a `// TODO(FR-11): resolve actual operator email via IAM port` comment on the `email.send()` call if the intent needs to be preserved.

---

#### Issue 2: Email recipient is a fake address — always (MEDIUM)

```typescript
to: detection.assignedOperatorId
  ? `operator-${detection.assignedOperatorId}@kommuniq.local`
  : 'admin@kommuniq.local',
```

`operator-{uuid}@kommuniq.local` is not a real email address. It will never reach a real operator. This is acknowledged as TD-01 in the Refinement doc, but the severity is understated. In production, HOT lead emails will be silently discarded (or rejected by SMTP) with no error, no fallback, and no visibility.

The StubEmailService logs to console, which means in development this is invisible as a problem. In production with SMTP configured, the send will likely succeed (SMTP accepts the mail) but the recipient email server will reject delivery, silently.

**Fix:** Either block production deployment until IAM email resolution is implemented, or document explicitly that HOT lead email notifications are non-functional in v1 and update the feature status accordingly. The PRD says "email to operator" as a core requirement (CR-03). This is unmet in any real environment.

---

#### Issue 3: EC-01 (WARM → HOT tier upgrade) is acknowledged but unmitigated (MEDIUM)

The dedup logic checks only for the existence of any `pql_detected` push notification for a dialog. If a WARM notification fires first, a subsequent HOT detection for the same dialog is silently dropped.

This is not a correctness bug (it is documented behavior). But it is a business logic problem: **operators will miss tier upgrades on active dialogs**. The scenario — PQL score rising from 0.72 to 0.85 as a conversation progresses — is not an edge case. It is a typical pattern in a real support dialog.

The Refinement doc marks this as "Risk: Medium" and defers to v2. Given that HOT leads are the primary revenue signal, this is arguably a SHOULD-fix before production rather than a COULD-fix.

**Fix (minimal):** In the dedup check, if an existing notification is found with tier=WARM and the new detection has tier=HOT, allow the new notification through. This is a one-line condition change.

---

#### Issue 4: `formatTimeAgo` in NotificationBell.tsx accepts `string` but `PQLNotification.createdAt` is typed as `string` — silent breakage on real-time notifications (LOW)

```typescript
function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr)
```

Real-time notifications from Socket.io set `createdAt: payload.timestamp` where `payload.timestamp` is an ISO string — this is fine.

REST-loaded notifications come from the server as serialized JSON, where `created_at` is a PostgreSQL `TIMESTAMPTZ` field. After `mapRow()` converts it to `new Date(row.created_at)`, the `Notification.createdAt` field is a `Date` object. But `useNotifications` types `PQLNotification.createdAt` as `string`. When the REST response is parsed by `fetch` + `.json()`, the date comes back as a string — so this happens to work. But the type is wrong (`createdAt` in the server-side `Notification` interface is `Date`, in the client-side `PQLNotification` it is `string`), and any future serialization change could break it.

---

#### Issue 5: `useNotifications` has no error state (LOW)

```typescript
const [loading, setLoading] = useState(true)
```

The hook exposes `loading` but no `error` state. If the REST fetch fails (network error, 401, 500), `loading` becomes `false` and `notifications` remains `[]`. The NotificationBell will render "No notifications yet" with no indication that a fetch failure occurred. The operator will not know whether there are no notifications or whether the load failed.

---

#### Issue 6: Notification bell renders for ALL notification types but only `pql_detected` is populated (INFO)

`NotificationType` includes `'pql_detected' | 'dialog_assigned' | 'system'`, but only `pql_detected` notifications are ever created. The `PQLNotification` interface in `useNotifications.ts` hardcodes `type: 'pql_detected'`. If `dialog_assigned` or `system` notifications are added in future, the frontend type will need updating. This is not a bug, but the type mismatch between the domain `Notification.type` and the client `PQLNotification.type` will cause future confusion.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | |
| No raw SQL injection | PASS — parameterized queries only | |
| Zod validation on REST | PASS for pagination params | |
| Tenant isolation (RLS) | FAIL — see Issue 1 in Architecture section | |
| No PII to external APIs | PASS — stub email only | |
| Auth on REST endpoints | PASS — all routes under `/api` which applies tenant middleware | |
| Socket.io payload validation | PARTIAL — payload cast via `as` without Zod | |

**Socket.io event payload (`notification:pql`) arrives from the server — it is not client-submitted input, so the risk is lower. But if the server-side emit ever changes shape, the cast will silently produce malformed notifications.**

---

## 4. Test Coverage Review

### What is Covered (10 tests)

All 10 tests pass. Coverage of the happy path is solid:
- All 3 tiers (HOT, WARM, COLD)
- Tenant room fallback
- Duplicate prevention (both directions)
- Notification formatting
- Push payload exact shape

### What is Missing

**No test for RLS behavior or tenant isolation.** Given that this is a CRITICAL fitness function (FF-03), and given that the implementation has the pool-vs-client gap documented above, the absence of any RLS integration test is a significant gap.

**No test for email failure path (EC-05).** The Refinement doc acknowledges that email failure leaves a partial state (push persisted, email not). There is no test verifying the error is logged and doesn't surface to the caller.

**No test for WARM → HOT tier upgrade scenario.** The dedup suppression of a HOT notification after a prior WARM is not tested. The behavior is therefore unverified from the test suite.

**No test for `findByDialogId` returning an error.** The repository swallows errors and returns `[]` on failure. This means if the dedup query fails (e.g., DB connection error), the service proceeds and sends a duplicate notification. No test covers this failure mode.

**No frontend tests.** `NotificationBell.tsx` and `useNotifications.ts` have zero test coverage. For components with real business logic (unread count management, real-time merge, time-ago formatting), this is a gap.

---

## 5. Documentation vs Reality Gap

The Final_Summary.md declares "Implementation Status: COMPLETE" and the validation-report.md scores the feature at 95/100. These assessments are too optimistic given the findings above.

Specific gaps between documentation and reality:

| Claim in Docs | Reality |
|---------------|---------|
| FF-03 PASS: "notification_jobs uses RLS on tenant_id" | Repository uses pool.query, bypassing the RLS-scoped client |
| "Zero imports from other BCs" | True for BC-06, but BC-02's message-consumer imports NotificationService directly |
| "HOT PQL: push + email VERIFIED" | Email recipient is `operator-{uuid}@kommuniq.local` — never reaches a real inbox |
| "11 unit tests" (Final_Summary) vs "10 tests" (validation-report) | Actual count is 10; minor but the inconsistency was noted and unresolved |

The worker.ts cron stub is correctly called out as a known limitation. No issue with that.

---

## 6. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architectural compliance | 5/10 | BC-06 is clean but RLS client gap is systemic and critical |
| Code quality | 7/10 | Dead code, fake email recipient, clear logic otherwise |
| Test coverage | 6/10 | Happy path covered; no RLS tests, no error path tests, no frontend tests |
| Security | 6/10 | RLS bypass is a tenant isolation risk |
| Business correctness | 7/10 | WARM→HOT suppression is a real operator UX problem |
| Documentation | 7/10 | Overstates compliance; known gaps understated |

**Overall: 38/60 (63%) — CONDITIONAL APPROVAL**

---

## 7. Required Fixes Before Production

### CRITICAL (block deploy)

**C-1: Fix RLS client in PgNotificationRepository (FF-03)**

The repository must use the RLS-scoped client, not the pool, for all tenant-scoped queries. For the HTTP path, pass `req.dbClient` from the route into the repository. For the Redis Stream path (message-consumer), wrap repository operations with an explicit `SET app.tenant_id` before executing. A shared utility `withTenantContext(pool, tenantId, fn)` would solve both paths cleanly.

### HIGH (block merge to main)

**H-1: Document that HOT email notifications are non-functional in v1**

The PRD defines email notification as core requirement CR-03. If this is deferred to v2, update the feature status in `feature-roadmap.json` to reflect that CR-03 is pending and that the "email to operator" acceptance criterion (AC-02.1) is not met.

**H-2: Remove dead code in notification-service.ts lines 111-113**

The `recipients` variable is deceptive. Remove it or replace it with a proper TODO comment explaining what integration is needed.

### RECOMMENDED (before v2)

**R-1: Allow HOT re-notification after WARM detection on same dialog (EC-01)**

This is a real revenue impact issue, not just a technical edge case.

**R-2: Add integration test for RLS isolation on notification_jobs**

Without this test, FF-03 compliance for BC-06 is asserted but not verified.

**R-3: Add error state to `useNotifications` hook**

Operators need to know when notification loading fails.
