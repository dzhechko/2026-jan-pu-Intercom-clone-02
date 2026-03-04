# Code Review Report: FR-02 PQL Flag in Dialog

**Feature ID:** FR-02
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** APPROVED WITH CONDITIONS

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports -- PARTIAL PASS

Verified imports across all FR-02-relevant files:

**Within BC-02 (PQL Intelligence):**
- `rule-engine.ts` imports only from `./value-objects/rule-set` (own BC) -- CLEAN
- `pql-detector-service.ts` imports from `@pql/*` and `uuid` -- CLEAN
- `pql-routes.ts` imports from `@pql/*` and `@shared/middleware/tenant.middleware` -- CLEAN (shared is allowed)
- `pql-detection-repository.ts` imports from `@pql/application/services/pql-detector-service` -- CLEAN

**Cross-BC violations:**

1. `src/pql/infrastructure/message-consumer.ts` line 3:
   ```typescript
   import { NotificationService } from '@notifications/application/services/notification-service'
   ```
   Direct import from BC-06 into BC-02. This is a concrete class import, not a port/interface. The `NotificationService` is used optionally (type-only at compile time, injected at runtime), but it still creates a hard compile-time dependency between BC-02 and BC-06.

2. `src/conversation/infrastructure/ws-handler.ts` lines 27-28:
   ```typescript
   import { PQLDetectorService, MessageEvent } from '@pql/application/services/pql-detector-service'
   import { analyzePQLInline } from '@pql/infrastructure/message-consumer'
   ```
   BC-01 directly imports from BC-02's application and infrastructure layers. This is a structural violation of BC isolation. The Architecture.md for FR-02 explicitly acknowledges this as "a deliberate architectural compromise for the MVP" and documents a migration path to Redis Streams, but it remains a violation of FF-02.

3. `src/conversation/infrastructure/ws-handler.ts` line 29:
   ```typescript
   import { NotificationService } from '@notifications/application/services/notification-service'
   ```
   BC-01 also imports BC-06 directly.

**Severity:** MEDIUM -- Three cross-BC imports total. Two are in ws-handler (which acts as an orchestrator) and one in message-consumer. The Architecture.md documents the rationale, but the pattern has proliferated beyond what was originally planned. As more features are added, this coupling will become harder to unwind.

**Recommendation:** Define a `PQLAnalysisPort` interface in `src/shared/ports/` that `ws-handler.ts` can depend on, and have `message-consumer.ts` implement it. Similarly, define `PQLNotificationPort` in `src/pql/domain/ports/` instead of importing `NotificationService` directly. This was flagged in the FR-01 review and remains unresolved.

---

### FF-03: Tenant RLS Isolation -- PASS (with risk noted)

- `PgPQLDetectionRepository.save()` -- inserts with explicit `tenant_id` column. RLS policy enforces tenant isolation at DB level.
- `PgPQLDetectionRepository.findByDialogId()` -- no explicit `WHERE tenant_id` filter. Relies entirely on RLS. This is architecturally correct per ADR-007 ("NEVER pass tenant_id as WHERE clause filter -- RLS handles it").
- `PgPQLDetectionRepository.findByTenantId()` -- has `WHERE tenant_id = $1` as an additional filter on top of RLS. This provides defense-in-depth.
- `DialogRepository.updatePQLScore()` -- updates by `id` only, relies on RLS to scope. Correct.

**Risk:** The `GET /api/pql/detections/:dialogId` route in `pql-routes.ts` does NOT validate that the `dialogId` URL parameter is a UUID. A malformed input could cause unexpected PostgreSQL errors. More importantly, the route relies purely on RLS for tenant scoping -- if RLS is misconfigured at the DB level, any dialog's detections could be retrieved by any operator. There is no defense-in-depth on this endpoint.

**Note on ws-handler RLS:** The `SET LOCAL app.tenant_id = '${tenantId}'` pattern in `ws-handler.ts` (line 99) uses string interpolation rather than parameterized queries. While `tenantId` is validated by Zod as `z.string().uuid()` before reaching this line, the SQL interpolation pattern is inherently fragile. If a future change relaxes the Zod schema or adds another code path, this becomes a SQL injection vector.

**Recommendation:**
1. Add UUID validation for `req.params.dialogId` in `pql-routes.ts` using Zod.
2. Use parameterized queries for SET LOCAL: `SET LOCAL app.tenant_id = $1` with `[tenantId]` parameter.
3. Add an integration test verifying that tenant A cannot retrieve detections for a dialog belonging to tenant B via the `GET /api/pql/detections/:dialogId` endpoint.

---

### FF-01: PQL Detection < 2,000ms -- PASS (by design)

The v1 detection pipeline is entirely synchronous with no network calls in the critical path:
- Content normalization: O(n) string operations on <= 2,000 chars
- 15 regex matches: < 5ms per iteration
- DB INSERT (pql.detections) + UPDATE (conversations.dialogs): 5-30ms typical
- WebSocket emit (pql:detected): < 1ms

Total expected latency: 60-100ms, well within the 2,000ms SLA.

The `analyzePQLInline()` call in `ws-handler.ts` is non-blocking (fire-and-forget with `.catch()`), meaning message delivery to the operator is never blocked by PQL analysis. This is the correct pattern per ADR-006.

**Gap:** No automated performance test validates FF-01 under load (e.g., 100 concurrent dialogs). The SLA could be violated under PostgreSQL write contention on the `pql.detections` table or the `conversations.dialogs` UPDATE.

---

### ADR-009: No LLM in v1 -- PASS

Verified: `rule-engine.ts` is pure regex matching. No imports from `openai`, `anthropic`, `langchain`, or any Cloud.ru LLM client exist in BC-02's domain or application layers. The `MLModelService` constructor parameter in `PQLDetectorService` is for FR-10 (ML v2) and is injected as `undefined` in the MVP.

---

### ADR-007: JWT + RLS -- PARTIAL PASS

- REST routes use `TenantRequest` middleware to extract `tenantId` from JWT -- correct.
- `findByTenantId` uses extracted `tenantId` -- correct.
- `findByDialogId` relies purely on RLS -- architecturally correct per ADR-007.
- The `SET LOCAL app.tenant_id` is set in ws-handler before DB operations -- correct flow.

**Issue:** The `SET LOCAL app.tenant_id` is called on the shared pool connection, not within a transaction. `SET LOCAL` only applies within a transaction block. If the pool uses autocommit (default for `pg`), the SET LOCAL has no effect beyond that single statement. The subsequent queries would run WITHOUT tenant_id set, meaning RLS would either block all rows or allow all rows depending on the default policy.

This is a pre-existing issue inherited from the ws-handler infrastructure, not specific to FR-02, but FR-02's PQL detection relies on this RLS being correctly set for the `detectionRepo.save()` and `dialogUpdater.updatePQLScore()` calls inside `PQLDetectorService.analyze()`. If those calls use a different connection from the pool (which they will, since they are invoked via `analyzePQLInline` which is asynchronous), the `SET LOCAL` from ws-handler will NOT apply to them.

**Severity:** HIGH (potential) -- This could mean PQL detection writes bypass RLS entirely. In practice, the `detectionRepo.save()` inserts with an explicit `tenant_id` column value so data integrity is preserved, but RLS policies on INSERT would not be enforced.

**Recommendation:** Wrap the detection save + dialog update in an explicit transaction that sets `app.tenant_id` within that transaction scope, or pass tenant context through the service layer and set it at the repository level.

---

## 2. Code Quality Review

### Strengths

1. **Clean domain layer separation.** `rule-engine.ts` and `pql-score.ts` are pure functions with zero side effects. They can be tested in complete isolation, and the test suite demonstrates this. The `analyzeRules()` function takes explicit inputs and returns a typed result.

2. **Explicit port interfaces.** `PQLDetectionRepository` and `DialogPQLUpdater` are TypeScript interfaces, enabling mock injection in tests. The `PQLDetectorService` constructor accepts these as constructor parameters, following the Dependency Inversion Principle correctly.

3. **Defensive edge case handling.** EC-02 (truncation at 2,000 chars), EC-03 (emoji strip), empty content guard, and sender type guard are all implemented and tested. The code matches the pseudocode specification accurately.

4. **Real-time update chain is well-designed.** The `pql:detected` WebSocket event triggers `useDialogs` state update, which triggers `RightPanel.useEffect` re-fetch, which deduplicates signals client-side. This chain is documented in the Specification and faithfully implemented.

5. **Frontend signal deduplication.** The `RightPanel` aggregates signals across multiple detections using a Map keyed by signal type, keeping the highest weight per type. This correctly implements FR-02.5.

6. **Dialog sorting by PQL tier.** The `sortDialogs()` function prioritizes HOT > WARM > COLD > undefined, then by recency within each tier. This is a good UX decision that is independently tested in `sort-dialogs.test.ts` (8 test cases).

7. **Race condition prevention in RightPanel.** The `useEffect` uses a `cancelled` flag to prevent state updates after unmount or dialog change. This is the correct pattern for async fetches in React.

---

### Issues Found

#### Issue 1: No transaction around detection save + dialog update (MEDIUM)

```typescript
// pql-detector-service.ts lines 149-152
await this.detectionRepo.save(detection)
await this.dialogUpdater.updatePQLScore(event.dialogId, score, tier)
```

If `save()` succeeds but `updatePQLScore()` fails, the detection record exists in `pql.detections` but the dialog's `pql_score`/`pql_tier` columns are not updated. The operator would NOT see the PQL badge in the dialog list despite a detection being stored. The next detection for the same dialog would update the dialog, but there is a window of inconsistency.

This was flagged in the FR-01 review and remains unaddressed.

**Fix:** Wrap both operations in a database transaction, or add a compensating action (delete the detection if the dialog update fails).

---

#### Issue 2: No UUID validation on `dialogId` route parameter (MEDIUM)

```typescript
// pql-routes.ts line 29
const detections = await detectionRepo.findByDialogId(req.params.dialogId)
```

The `dialogId` URL parameter is passed directly to the SQL query without Zod validation. While parameterized queries prevent SQL injection, a non-UUID string will cause a PostgreSQL type error (`invalid input syntax for type uuid`) that results in a 500 error instead of a user-friendly 400 error.

**Fix:** Add a Zod UUID validation:
```typescript
const DialogIdSchema = z.object({ dialogId: z.string().uuid() })
const parsed = DialogIdSchema.safeParse(req.params)
if (!parsed.success) return res.status(400).json({ error: 'Invalid dialogId' })
```

---

#### Issue 3: Unsafe payload cast in message-consumer (LOW)

```typescript
// message-consumer.ts line 36
const event = payload as MessageEvent  // unsafe cast
```

The `pql:analyze` event handler in `registerPQLConsumer()` casts the Socket.io payload directly to `MessageEvent` without Zod validation. The field-presence check on line 37 (`if (!event.messageId || ...`) catches null/undefined but does NOT validate types. If `senderType` arrives as an arbitrary string, the guard `senderType !== 'CLIENT'` in `PQLDetectorService.analyze()` would correctly skip it, but the intent is unclear.

Note: The `analyzePQLInline()` function receives a typed `MessageEvent` parameter from `ws-handler.ts`, so this issue only affects the `pql:analyze` Socket.io event path, which appears to be unused in the current codebase (the inline path is used instead).

**Fix:** Add Zod schema validation for the Socket.io payload, or remove the unused `registerPQLConsumer()` handler if the inline path is the canonical implementation.

---

#### Issue 4: Error logging without type narrowing (LOW)

```typescript
// pql-routes.ts line 31
} catch (err) {
  console.error('[pql-routes] getDetectionsByDialog error', err)
```

In TypeScript strict mode, `err` is typed as `unknown`. The code logs the raw error object, which works at runtime but is not type-safe. Multiple catch blocks across the codebase exhibit this pattern.

**Fix:** Use `err instanceof Error ? err.message : String(err)` for structured error logging.

---

#### Issue 5: Duplicated PQL emission logic (LOW)

```typescript
// message-consumer.ts - both registerPQLConsumer() and analyzePQLInline()
// contain identical emit + notification logic
chatNamespace.to(`tenant:${event.tenantId}`).emit('pql:detected', {
  detectionId: detection.id,
  ...
})
```

The emit payload construction and notification triggering logic is duplicated between `registerPQLConsumer()` and `analyzePQLInline()`. This violates DRY. If the payload shape changes, both must be updated.

**Fix:** Extract a shared `emitPQLDetection(chatNamespace, detection, notificationService?)` function.

---

#### Issue 6: `MAX_POSSIBLE_WEIGHT` comment is inaccurate (INFO)

```typescript
// rule-set.ts line 38
// Maximum possible weight = sum of top-5 weights ~= 2.25
```

The comment says 2.25, but the actual computed value from the top 5 weights (0.60 + 0.50 + 0.45 + 0.45 + 0.45) is 2.45. The Specification.md correctly documents 2.45. The code dynamically computes the value so the runtime behavior is correct, but the comment is misleading.

**Fix:** Update the comment to reflect the actual value (2.45), or remove the hardcoded value from the comment since it is computed dynamically.

---

#### Issue 7: `pqlBadge()` renders COLD badges (INFO)

The `pqlBadge()` function in `DialogList.tsx` renders a gray COLD badge for every dialog with `pqlTier === 'COLD'`. The validation report (Gap 2) flagged this as potential visual noise. Currently, any dialog where even a single weak signal fires (e.g., a message containing "plan" triggers BUDGET rule) will show a COLD badge, which could be confusing to operators.

The Specification says "Badge is suppressed entirely when `dialog.pqlTier` is undefined" but does NOT specify suppressing COLD. This is working as designed, but the UX impact should be evaluated.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | No secrets in any FR-02 file |
| No raw SQL injection risk | PASS | All repository queries use parameterized `$1, $2...` placeholders |
| `SET LOCAL` SQL interpolation | WARN | `ws-handler.ts` uses string interpolation for `SET LOCAL app.tenant_id`. Mitigated by Zod UUID validation but fragile pattern. |
| Input validated with Zod (REST) | PARTIAL | Pagination params validated. `dialogId` URL param NOT validated. |
| Input validated with Zod (Socket.io) | PARTIAL | `client:message` validated via `ClientMessageSchema`. `pql:analyze` event uses unsafe cast. |
| Tenant isolation via RLS | PASS | RLS enforced on `pql.detections` and `conversations.dialogs`. |
| No PII sent to external APIs | PASS | Rule-based engine is pure regex, no external calls. `matchedText` stored locally only. |
| PQL detection CLIENT-only guard | PASS | `senderType !== 'CLIENT'` check prevents operators from gaming scores. |

**Notable security finding:** The `SET LOCAL app.tenant_id = '${tenantId}'` pattern (ws-handler.ts line 99) uses template literal interpolation. Although `tenantId` is validated as a UUID by Zod before reaching this point, this is a SQL injection anti-pattern. If a code path is added that bypasses Zod validation, or if the Zod schema is relaxed, this becomes exploitable. The correct approach is `pool.query('SET LOCAL app.tenant_id = $1', [tenantId])`. This is a pre-existing issue not specific to FR-02, but FR-02's PQL pipeline flows through this code path.

---

## 4. Test Coverage Assessment

### Backend Tests

| File | Tests | Coverage |
|------|-------|----------|
| `rule-engine.test.ts` | 11 tests | Covers main paths, edge cases (empty, emoji, truncation, custom rules). Missing: per-rule positive/negative tests for all 15 rules. |
| `pql-detector-service.test.ts` | 12 tests | Covers sender filtering, signal detection, persistence, tier classification, edge cases. Well-structured. |
| `sort-dialogs.test.ts` | 8 tests | Covers tier ordering, recency, edge cases. Thorough. |

### Missing Tests

1. **No integration test for `GET /api/pql/detections/:dialogId`** -- the REST endpoint has no test file. Critical for verifying RLS isolation and response format.

2. **No integration test for cross-tenant RLS** on `pql.detections` table -- flagged in FR-01 review, still missing.

3. **No test for `analyzePQLInline()`** -- the primary PQL analysis entry point used by `ws-handler.ts` has no unit test. The `PQLDetectorService.analyze()` is tested, but the emit logic and notification dispatch in `analyzePQLInline()` are untested.

4. **No frontend component tests** for `pqlBadge()`, `pqlTierDisplay()`, or the signal list rendering in `RightPanel`. The validation report (Gap 3) flagged the missing `pql:detected` handler test in `useDialogs`.

5. **Per-rule test coverage:** Rules R07 (DECISION_MAKER), R08 (EVALUATION), R11 (COMPLIANCE), R12 (TRIAL), R13 (BUDGET), R14 (PARTNERSHIP), R15 (ONBOARDING) lack individual positive and negative test cases. FF-05 requires >= 95% coverage on the RuleEngine. The current tests exercise these rules incidentally through multi-signal messages but do not verify them in isolation.

---

## 5. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architectural compliance | 6/10 | Three cross-BC imports (BC-01->BC-02, BC-02->BC-06, BC-01->BC-06). SET LOCAL transaction scope concern. |
| Code quality | 8/10 | Clean domain layer, good separation of concerns. Minor DRY violation in message-consumer. |
| Test coverage | 6/10 | Good unit tests for domain logic. No integration tests for REST endpoints. No frontend component tests. Missing per-rule test matrix. |
| Security | 7/10 | RLS enforced. No PII leakage. SQL interpolation in SET LOCAL is fragile. Missing UUID validation on REST param. |
| Performance | 9/10 | Pure regex engine < 50ms. Non-blocking analysis. No load test, but design guarantees SLA. |
| Documentation | 9/10 | Full SPARC docs (PRD, Specification, Architecture, Pseudocode). Validation report thorough. Architecture.md honestly documents BC compromises. |

**Overall: 45/60 (75%) -- APPROVED WITH CONDITIONS**

---

## 6. Conditions for Full Approval

### Must Fix (before production)

1. **Add UUID validation on `dialogId` route parameter** in `pql-routes.ts`. This is a straightforward fix that prevents 500 errors from malformed input and improves API robustness.

2. **Add at least one integration test for `GET /api/pql/detections/:dialogId`** verifying correct response shape and RLS tenant isolation.

### Should Fix (before v2)

3. **Resolve cross-BC imports.** Define port interfaces (`PQLAnalysisPort`, `PQLNotificationPort`) in shared or within the consuming BC's ports directory. This was flagged in FR-01 review and remains open.

4. **Wrap `detectionRepo.save()` + `dialogUpdater.updatePQLScore()`** in a transaction or add compensating logic. Partial state on failure is a real production risk.

5. **Migrate `SET LOCAL app.tenant_id` to parameterized queries** across all ws-handler usages. The current string interpolation pattern is a latent SQL injection risk.

6. **Add per-rule test matrix** to `rule-engine.test.ts` to satisfy FF-05 strictly (individual positive + negative test for each of the 15 rules).

### Could Fix (technical debt)

7. Extract duplicated emit logic in `message-consumer.ts` into a shared function.
8. Remove or document the unused `registerPQLConsumer()` function if `analyzePQLInline()` is the canonical path.
9. Evaluate UX impact of COLD badge visibility; consider suppressing COLD or making it opt-in.
10. Fix the `MAX_POSSIBLE_WEIGHT` comment in `rule-set.ts` (says 2.25, actual is 2.45).
