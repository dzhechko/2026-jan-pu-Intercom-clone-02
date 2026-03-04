# Refinement: FR-02 — PQL Flag in Dialog
**Feature ID:** FR-02
**Version:** 1.0 | **Date:** 2026-03-04

---

## 1. Edge Cases

### EC-01: Concurrent Messages — Deduplication
**Risk:** Two client messages arrive within milliseconds (network burst). Both trigger `analyzePQLInline`. Both detections INSERT to `pql.detections`. Dialog aggregate gets updated twice with potentially different scores.

**Mitigation:** The `updatePQLScore` call uses an UPDATE statement. PostgreSQL serializes row-level locks. The last write wins, which is acceptable — the final score reflects the latest detection. Both detection records are preserved in `pql.detections` for audit.

**Test:** Unit test with two concurrent `analyze()` calls on the same dialogId. Assert both detections persisted, dialog has the higher score.

---

### EC-02: Long Messages (>2000 chars)
**Risk:** A client pastes a large document or wall of text. Pattern matching over 50K+ characters could block the event loop.

**Mitigation:** `normalizeContent()` in `rule-engine.ts` truncates to 2000 characters before processing. The truncation happens before any regex application.

**UX Note:** The truncation is invisible to the operator. Signals matched in the first 2000 chars are sufficient for purchase intent classification. Deep-document analysis is deferred to v3 (LLM pipeline).

---

### EC-03: Unicode and Emoji in Client Messages
**Risk:** Client sends "🔥 Хотим Enterprise 🏢 договор подписать". Emoji could disrupt regex matches or inflate character count.

**Mitigation:** `normalizeContent()` strips emoji in the `\u{1F600}-\u{1F9FF}` unicode range before pattern matching. The content then matches ENTERPRISE and PURCHASE rules correctly.

**Known Gap:** Emoji outside that range (e.g. country flags, ZWJ sequences) are not stripped. This is acceptable for v1; no PQL signals use emoji-only patterns.

---

### EC-04: Partial or Missing ML Prediction
**Risk:** `mlModelService.predict()` returns `null` (model not warm, training in progress, or tenant below 1K dialog threshold).

**Mitigation:** `PQLDetectorService.analyze()` falls back to `analyzeRules()` (rule-v1) when ML returns null. The fallback is transparent to the operator.

---

### EC-05: Dialog Has No pqlTier (Cold/New)
**Risk:** Operator opens a new dialog before any client message triggers detection. RightPanel tries to render PQL section.

**Mitigation:** `pqlTierDisplay()` function handles `undefined` tier gracefully, returning label `N/A` and neutral `bg-gray-50` styling. No tier badge appears in DialogList (`pqlBadge()` returns `null` for undefined tier).

---

### EC-06: Operator Message Triggers PQL Accidentally
**Risk:** Operator types "давайте оформим договор" — contains PURCHASE signal R06. Could inflate PQL score spuriously.

**Mitigation:** Hard guard in `PQLDetectorService.analyze()`: `if (event.senderType !== 'CLIENT') return null`. Operator and BOT messages are never analyzed. The `ws-handler.ts` passes `senderType: 'CLIENT'` explicitly only for the `client:message` event path.

---

### EC-07: RLS Isolation — Cross-Tenant Signal Leak
**Risk:** If `app.tenant_id` is not set on the DB connection before the `findByDialogId` query, the RLS policy might not fire, leaking rows across tenants.

**Mitigation:** `pql-routes.ts` uses the `TenantRequest` type which guarantees the tenant middleware ran. The tenant middleware sets `SET app.tenant_id` via a pool query before any handler executes. Additionally, `pql.detections` has `tenant_id` as a direct column for RLS policy definition.

**Test:** RLS integration test — tenant A operator calls `GET /api/pql/detections/:dialogIdOfTenantB` → must receive empty array.

---

### EC-08: pql:detected Event Before Dialog Loaded on Client
**Risk:** Frontend receives `pql:detected` WS event but the dialog is not yet in `useDialogs` state (race with initial HTTP load).

**Mitigation:** `useDialogs` `pql:detected` handler uses `.map()` — if no dialog matches the `dialogId`, the state is unchanged silently. The dialog will load on next HTTP poll or when created via `dialog:created`.

---

### EC-09: Signal List Shows Stale Data
**Risk:** Operator has the dialog open. New detection fires. `pql:detected` updates `pqlScore`. `useEffect` in RightPanel refetches. But if the HTTP request is in-flight when the new detection arrives, the response may not include the newest signals.

**Mitigation:** The refetch uses `GET /api/pql/detections/:dialogId` which returns all detections sorted newest-first. The useEffect dependency `dialog?.pqlScore` changes on every detection, so a new HTTP request fires. Network latency of < 300ms means the signal list is current within one round trip.

---

## 2. UX Considerations

### 2.1 Colour Semantics
- Red (HOT) is a high-attention colour — used sparingly to avoid alert fatigue
- COLD tier deliberately muted (gray) — operators should not spend time on it
- Badge appears in both dialog list AND right panel for redundancy (two touch points)

### 2.2 Score Display
The raw numeric score (e.g. `0.87`) is shown to operators to build trust in the system. Operators who understand the 0–1 scale can develop intuition over time. A future UX improvement could replace this with a progress bar or star rating.

### 2.3 Signal Types Displayed as Human-Readable
Signal types like `PRICING`, `ENTERPRISE`, `DECISION_MAKER` are displayed with underscores replaced by spaces (`signal.type.replace(/_/g, ' ')`). This is a minimal but effective UX improvement without a translation table.

### 2.4 Weight Displayed as Percentage
`Math.round(signal.weight * 100)%` converts the 0–1 float to a percentage. Example: weight 0.50 → "50%". This helps operators understand relative signal strength without knowing the internals.

### 2.5 Loading vs. Empty States
Two distinct states must be differentiated:
- **Loading** ("Loading signals..."): API call in-flight
- **Empty** ("No significant signals detected"): API responded with 0 signals
Conflating these states would confuse operators who see "no signals" when data is still loading.

---

## 3. Testing Strategy

### 3.1 Unit Tests — RuleEngine (FF-05: >= 95% coverage)

For each of the 15 DEFAULT_RULES:
- **Positive match test:** message containing the pattern → rule fires, signal in result
- **Negative match test:** message not containing any pattern → empty signals
- **Case-insensitive test:** uppercase trigger → same result as lowercase
- **Weight contribution test:** single rule score = rule.weight / MAX_POSSIBLE_WEIGHT

Additional:
- Empty string → returns zero score
- Message > 2000 chars → truncated, signals detected in first 2000 chars
- Emoji in message → stripped, underlying keywords matched
- Multiple rules match → scores sum (capped at 1.0)

### 3.2 Unit Tests — PQLDetectorService

- `senderType: OPERATOR` → returns null
- `senderType: BOT` → returns null
- `senderType: CLIENT`, no signals → returns null
- `senderType: CLIENT`, signals detected → detection saved + dialog updated
- ML service returns prediction → ML result used
- ML service returns null → fallback to rule-v1
- `detectionRepo.save` throws → error propagates (non-swallowed)

### 3.3 Integration Tests — RLS

- Tenant A token + tenant B dialogId → empty detections array
- Correct tenant token + own dialogId → correct detections returned

### 3.4 Integration Tests — WebSocket Flow

- Mock `pqlDetector.analyze()` returning HOT detection
- Assert `pql:detected` event emitted to `tenant:{tenantId}` room
- Assert dialog's `pqlScore` + `pqlTier` updated in DB

### 3.5 Frontend Component Tests

- `pqlBadge(undefined)` → renders nothing
- `pqlBadge('HOT')` → renders red badge
- `pqlBadge('WARM')` → renders orange badge
- `pqlBadge('COLD')` → renders gray badge
- `pqlTierDisplay(undefined)` → returns N/A styles
- `RightPanel` with `dialog.pqlScore = 0.9` and `dialog.pqlTier = 'HOT'` → renders red section, score "0.9", badge "HOT"
- `RightPanel` loading state → renders "Loading signals..."
- `RightPanel` empty signals → renders "No significant signals detected"
- Signal deduplication logic: two detections with overlapping signal types → one entry per type (highest weight)

### 3.6 BDD Scenario Coverage

7 BDD scenarios from `docs/test-scenarios.feature` map to FR-02:
1. Enterprise signal → HOT tier — happy path
2. Multiple weak signals → WARM tier
3. PQL Pulse notification on HOT (FR-11, adjacent)
4. amoCRM MCP unavailable → detection continues without context boost
5. Operator message → no new PQL flag
6. Score below threshold → no flag
7. Repeat PQL in same dialog → new detection saved, no duplicate notification within 30 min

---

## 4. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Rule-based v1 precision < 65% | Medium | High — reduces operator trust | Offline eval on synthetic dataset before launch; tune weights |
| WebSocket event missed (client disconnected) | Low | Medium — stale tier badge until next reload | Periodic HTTP refresh of dialog list (polling fallback) |
| pql.detections table grows unbounded | Medium | Medium — slow queries over time | Add index on `(dialog_id, created_at DESC)`; implement cleanup job |
| Cross-BC import (ws-handler → pql) breaks FF-02 | Already present | Medium | Current implementation has controlled import; document exception; ESLint rule tracks it |
