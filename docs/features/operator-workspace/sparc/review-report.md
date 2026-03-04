# Brutal Honesty Review: FR-07 Operator Workspace

**Feature ID:** FR-07
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** APPROVED WITH CONDITIONS — 2 critical issues must be fixed before marking complete

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — PASS

Verified all imports across the 17 workspace files. Every file in `app/(workspace)/` imports exclusively from:
- Its own directory (`./hooks/*`, `./components/*`, `./constants/*`, `./types`)
- React and Next.js standard libraries
- `socket.io-client` (infrastructure dependency)

No imports from `src/` backend modules. All cross-BC communication happens through REST API (`/api/proxy/*`) and Socket.io events. This is the correct ACL boundary per ADR-002.

### FF-03: Tenant RLS Isolation — PASS

All REST API calls include `Authorization: Bearer ${token}` header. The token carries the tenant scope, and the backend middleware sets `app.tenant_id` for RLS enforcement. The workspace never constructs tenant-scoped queries itself — it relies entirely on the backend to enforce isolation.

One observation: the `useSocket` hook passes `tenantId` in `socket.auth` for namespace joining. If the backend does not validate that the tenantId in `socket.auth` matches the JWT's tenant claim, a malicious client could join another tenant's namespace. This is a backend concern, not a frontend issue, but worth noting for defense-in-depth.

### FF-10: Data Residency — PASS

No external API calls from the browser. All data flows through `/api/proxy/*` to the internal Express backend. The Socket.io connection targets `NEXT_PUBLIC_API_URL` which defaults to `localhost:4000`. No calls to OpenAI, Anthropic, or any foreign services.

### Component Structure — ACCEPTABLE

The three-column layout follows the specification precisely:
- `<aside w-80>` left sidebar (DialogList)
- `<main flex-1>` center (ChatArea)
- `<aside w-72>` right panel (RightPanel)

State management uses custom hooks composed in `WorkspacePage` with props drilled down. No global state library. This is appropriate for the current component depth (max 2 levels).

**Concern:** `page.tsx` at 315 lines is the single orchestrator for all state. It manages auth, socket connection, dialogs, messages, notifications, keyboard shortcuts, and dialog actions. This is approaching the complexity threshold where extracting a `WorkspaceContext` would improve maintainability. Not blocking for v1.

### State Management — ACCEPTABLE WITH ISSUES

Seven custom hooks manage distinct concerns. The `useCallback` and `useMemo` usage is correct for preventing unnecessary re-renders. The `dialogsRef` pattern in `useDialogs` correctly handles closure-safe access.

**Issue:** The `on()` callback in `useSocket` has an empty dependency array (`[]`), meaning it captures `socketRef.current` from the initial render. When the socket reconnects (triggered by token/tenantId/operatorId change), the `useEffect` cleanup disconnects the old socket and creates a new one. However, existing `on()` subscriptions from other hooks reference the old socket's `off()` method via the stale closure. The cleanup functions returned by `on()` will call `socketRef.current?.off()` — which works because `socketRef` is a ref (always current). The new subscriptions from re-running effects will attach to the new socket. This is correct but fragile; a comment explaining this would help future developers.

---

## 2. Code Quality Review

### Strengths

1. **Clean hook composition pattern.** Each hook (`useDialogs`, `useMessages`, `useMemoryAI`, etc.) owns a single concern with clear inputs and outputs. The hooks are composable and testable in isolation.

2. **Defensive event handling.** All Socket.io event handlers guard against missing data: `if (!data.message) return`, `if (!data.dialogId) return`, etc. This prevents runtime crashes from malformed events.

3. **Message deduplication.** Both the REST POST response path and the `message:new` Socket.io event path check `prev.some(m => m.id === data.message.id)` before appending. This correctly handles the race condition documented in Refinement.md.

4. **Memory AI state machine.** The 6-state machine (`idle | loading | ok | not_configured | error | no_email`) cleanly maps to UI states. Each state has a distinct visual representation in `RightPanel`. The local cache with manual refresh is a pragmatic v1 approach.

5. **Cancellation pattern.** Both `useMessages` and `RightPanel` PQL signal fetching use `let cancelled = false` with cleanup `() => { cancelled = true }` to prevent state updates on unmounted components. This is the correct pattern for async effects.

6. **Typing indicator with auto-clear.** The 5-second timeout prevents stuck indicators if the client stops sending `typing` events, matching the specification exactly.

7. **Keyboard shortcut architecture.** The `isTypingInInput()` guard correctly prevents shortcut interception when the operator is typing in the message input. The priority system (Ctrl+Enter and Ctrl+K always fire, everything else blocked during typing) matches the pseudocode specification.

8. **PQL signal aggregation.** The `RightPanel` correctly deduplicates signals by type (keeping the highest weight per type), sorts by weight descending, and displays the top 5. This matches Algorithm 5 from the pseudocode.

---

### Issues Found

#### Issue 1: Quick Reply Content Mismatch in RightPanel — CRITICAL

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/app/(workspace)/components/RightPanel.tsx`, lines 26-32

```typescript
const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'qr-1', label: 'Greeting', content: 'Hello! How can I help you today?' },
  { id: 'qr-2', label: 'Pricing', content: 'I would be happy to help with pricing information...' },
  { id: 'qr-3', label: 'Follow up', content: 'Thank you for reaching out!...' },
  { id: 'qr-4', label: 'Transfer', content: 'Let me transfer you to a specialist...' },
  { id: 'qr-5', label: 'Closing', content: 'Thank you for chatting with us!...' },
]
```

Meanwhile, `constants/quickReplies.ts` defines the correct Russian templates:

```typescript
{ id: 'qr-1', label: 'Connect specialist', content: 'Спасибо за обращение! Подключаю специалиста.' },
// ... etc (all in Russian)
```

**Impact:** When an operator clicks a quick reply button in the right panel, the English text is sent. When they use Alt+1..5 keyboard shortcut, the correct Russian text is sent (because `page.tsx` uses `QUICK_REPLY_TEMPLATES[index].content` from constants). This means the same action produces different results depending on input method. For a product targeting Russian PLG/SaaS companies, sending English boilerplate to customers is a business-critical bug.

**Root cause:** `RightPanel.tsx` defines its own `DEFAULT_QUICK_REPLIES` instead of importing from `constants/quickReplies.ts`. The labels also differ ("Greeting" vs "Connect specialist", "Pricing" vs "Request email", etc.), so the button labels shown in the UI do not match the keyboard shortcut behavior.

**Fix:** Replace `DEFAULT_QUICK_REPLIES` in `RightPanel.tsx` with an import of `QUICK_REPLY_TEMPLATES` from `../constants/quickReplies`. Also update `RightPanel` to receive and use the same quick reply data for button clicks that the keyboard shortcuts use.

---

#### Issue 2: useOperators and OperatorList Not Wired Into Page — CRITICAL

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/app/(workspace)/page.tsx`

The `useOperators` hook and `OperatorList` component both exist and are fully implemented. However:

1. `page.tsx` never calls `useOperators()`. The hook is not imported.
2. `OperatorList` is never rendered in the page layout.
3. `RightPanel` accepts optional `operators` and `onReassign` props, but `page.tsx` passes neither.

This means:
- The reassign dropdown in `RightPanel` (lines 348-375) never renders because `operators` is always `undefined`.
- The operator presence sidebar (FR-13) is completely invisible to the user.
- The `useOperators` hook code (112 lines) and `OperatorList` component (140 lines) are dead code.

**Impact:** FR-13 (Multi-Operator Support) is listed as "Done" in `Final_Summary.md` but is not functional. The feature exists in source code but is not integrated. An operator cannot see who else is online or reassign dialogs to another operator.

**Fix:** In `page.tsx`: (1) import and call `useOperators({ token, on })`; (2) pass `operators` and an `onReassign` handler to `RightPanel`; (3) optionally render `OperatorList` in the left sidebar below the dialog list, or in the right panel.

---

#### Issue 3: searchInputRef Not Connected to Any DOM Element — MEDIUM

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/app/(workspace)/page.tsx`, line 147

```typescript
const searchInputRef = useRef<HTMLInputElement>(null)
```

This ref is created and passed to `useKeyboardShortcuts` so that `Ctrl+K` calls `searchInputRef.current?.focus()`. However, the ref is never assigned to any `<input>` element via the `ref` prop. The `Ctrl+K` shortcut silently does nothing.

The PRD lists search/filter as "Out of Scope" (LIM-01), yet the shortcut is registered and advertised in the ShortcutHelp modal ("Focus search/filter dialogs"). This is misleading — the operator sees a documented shortcut that has no effect.

**Fix:** Either (a) remove `Ctrl+K` from `SHORTCUT_MAP` until search is implemented, or (b) add a search input to the dialog list sidebar and connect the ref.

---

#### Issue 4: useNotifications Bypasses API Proxy — MEDIUM

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/app/(workspace)/hooks/useNotifications.ts`, lines 5, 42, 60, 77

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
// ...
const res = await fetch(`${API_BASE}/api/notifications?limit=20`, { ... })
```

All other hooks (`useDialogs`, `useMessages`, `useMemoryAI`) route requests through the Next.js API proxy at `/api/proxy/*`. The `useNotifications` hook instead calls the backend directly at `http://localhost:4000/api/notifications*`. This creates:

1. **CORS issues in production.** The backend may not accept requests from the browser origin directly, while the proxy avoids CORS entirely.
2. **Architecture inconsistency.** The proxy pattern was chosen per Architecture.md section 8 to centralize auth injection and avoid CORS. Bypassing it defeats the purpose.
3. **Potential data residency issue.** The `NEXT_PUBLIC_API_URL` env var exposes the backend URL to the client browser. In production, this URL should be internal-only.

**Fix:** Replace `${API_BASE}/api/notifications*` URLs with `/api/proxy/notifications*` to match the pattern used by all other hooks.

---

#### Issue 5: Unsafe Type Assertions on Socket.io Payloads — MEDIUM

Throughout all hooks, Socket.io event payloads are cast with `as`:

```typescript
// useDialogs.ts line 69
const data = payload as { message?: Message; dialog?: Dialog }

// useMessages.ts line 60
const data = payload as { message?: Message }

// useNotifications.ts line 106
const payload = data as { type: string; dialogId: string; score: number; ... }
```

There is no Zod validation on incoming Socket.io events. If the server sends a malformed payload (e.g., `score` is a string instead of number, or `topSignals` is null instead of an array), the frontend would crash at runtime (e.g., `payload.topSignals.map(...)` in `useNotifications` line 121).

**Severity:** MEDIUM. Socket.io payloads are internal (server-to-client), not user-controlled, but server bugs or protocol changes could cause cascading UI crashes.

**Fix:** Add lightweight runtime type checks (Zod schemas or manual guards) for critical Socket.io event payloads, at minimum for `notification:pql` which accesses nested properties without guards.

---

#### Issue 6: PQL Score Displayed as Raw Decimal — LOW

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/app/(workspace)/components/RightPanel.tsx`, line 149

```typescript
<span className={`text-3xl font-bold ${tier.color}`}>
  {dialog.pqlScore ?? 0}
</span>
```

The PQL score is a value between 0 and 1 (e.g., `0.82`). Displaying `0.82` is technically correct but inconsistent with the rest of the UI, which shows percentages (e.g., signal weights are shown as `Math.round(signal.weight * 100)%`, enrichment score as `Math.round(data.enrichmentScore * 100)%`). The operator might be confused seeing "0.82" next to "HOT" when signals show "82%".

**Fix:** Display as `${Math.round((dialog.pqlScore ?? 0) * 100)}%` for consistency.

---

#### Issue 7: Deal Value Currency Hardcoded to USD — LOW

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/app/(workspace)/components/RightPanel.tsx`, line 467

```typescript
<span className="text-gray-600 font-medium">
  ${deal.value.toLocaleString()}
</span>
```

The dollar sign `$` is hardcoded. For a product targeting Russian companies using amoCRM, deal values would typically be in rubles (RUB). This should use a locale-aware currency formatter or at minimum use the ruble sign.

**Fix:** Replace `$` with a configurable currency symbol or use `Intl.NumberFormat` with the appropriate locale and currency.

---

#### Issue 8: No Error Boundary Around Workspace — LOW

The entire workspace is a single React component tree. If any component throws during render (e.g., `MemoryAIDisplay` receives unexpected data), the entire workspace crashes to a white screen. There is no React Error Boundary wrapping the page or individual panels.

**Fix:** Add Error Boundaries around `RightPanel`, `ChatArea`, and `DialogList` to isolate failures. A crashed right panel should not take down the message area.

---

#### Issue 9: Tests Duplicate Logic Instead of Testing Actual Code — LOW

All three test files (`sort-dialogs.test.ts`, `keyboard-shortcuts.test.ts`, `message-formatting.test.ts`) re-implement the functions they claim to test rather than importing from the source files. For example, `sort-dialogs.test.ts` contains its own copy of `sortDialogs()`. The comment says "Inline the sort function to avoid module resolution issues with Next.js 'use client' files."

This means the tests verify that the duplicated logic works, not that the actual production code works. If someone changes `sortDialogs()` in `useDialogs.ts`, the tests would still pass even if the change introduced a bug.

**Fix:** Configure Jest to handle `'use client'` directives (add a transform or strip the directive). Then import `sortDialogs` from the actual source file.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | Only JWT tokens from localStorage |
| No raw SQL injection risk | N/A | Frontend-only; no direct DB access |
| Input validated before send | PARTIAL | `sendMessage` checks `content.trim()` is non-empty; no length limit enforced client-side |
| Tenant isolation | PASS | JWT on all requests; backend RLS enforces |
| No PII sent to external APIs | PASS | All traffic goes to internal backend |
| XSS protection | PARTIAL | React's JSX escaping handles most cases. `msg.content` rendered via `{msg.content}` which is safe. But `dangerouslySetInnerHTML` is not used, so no XSS risk from message content. |
| localStorage token security | ACCEPTED RISK | JWT in localStorage is accessible to any JS on the page (XSS would expose it). Standard practice for SPAs without httpOnly cookie flow. Documented as known limitation. |
| Socket.io auth | PASS | Token, tenantId, and operatorId passed in `socket.auth` object, not URL parameters |
| Notification API bypass | CONCERN | `useNotifications` calls backend directly, bypassing proxy (see Issue 4). Could expose backend URL to browser. |

---

## 4. Summary Scorecard

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| Architectural compliance | 7/10 | FF-02/03/10 all pass. Notification proxy bypass (Issue 4) is an architecture pattern violation. useOperators dead code. |
| Code quality | 7/10 | Strong hook pattern, good defensive coding. Marred by quick reply mismatch (Issue 1), dead code (Issue 2), unsafe type casts (Issue 5). |
| Test coverage | 4/10 | 3 test files with ~50 cases, but all test duplicated logic, not actual source. No React hook tests. No component rendering tests. Documented test plan in Refinement.md is 90% unimplemented. |
| Security | 8/10 | JWT auth properly implemented. No external API leaks. Notification proxy bypass is the only concern. |
| Performance | 8/10 | Sort is O(n log n) on bounded lists. Memory AI cache prevents redundant fetches. Cancellation prevents stale updates. No observable performance risks for v1 scale. |
| Documentation | 9/10 | SPARC docs are comprehensive and high-fidelity. PRD, Spec, Architecture, Pseudocode, Refinement all well-written. Missing 3 of 9 SPARC files (Solution_Strategy, Research_Findings, Completion). |

**Overall: 43/60 (72%) — APPROVED WITH CONDITIONS**

---

## 5. Overall Verdict

FR-07 Operator Workspace is a substantial and well-architected feature delivering a functional real-time operator interface. The hook-based state management is clean, the Socket.io integration is solid, and the keyboard shortcut system is thorough. The SPARC documentation is among the best in the project.

However, two critical issues must be resolved before the feature can be considered complete:

### Blocking (fix before marking feature complete)

1. **Fix quick reply content mismatch.** `RightPanel.tsx` must use `QUICK_REPLY_TEMPLATES` from `constants/quickReplies.ts` instead of its own English-language `DEFAULT_QUICK_REPLIES`. Clicking a quick reply button must send the same Russian text as the Alt+N keyboard shortcut. This is a user-facing business logic bug.

2. **Wire useOperators and OperatorList into page.tsx.** FR-13 is marked as "Done" but is dead code. Import `useOperators`, call it, pass data to `RightPanel` and optionally render `OperatorList`. Until this is done, the reassign dropdown cannot render and operator presence is invisible.

### High Priority (fix before next sprint)

3. **Route notification API calls through the proxy.** Replace `${API_BASE}/api/notifications*` with `/api/proxy/notifications*` in `useNotifications.ts` to match the architecture pattern and avoid CORS/exposure issues.

4. **Remove or disable the Ctrl+K shortcut** until search is implemented. The `searchInputRef` is not connected to any DOM element, making the shortcut a no-op that is misleadingly documented in the help modal.

5. **Fix tests to import actual source code** instead of duplicating logic. Configure Jest transform to handle `'use client'` directives.

### Recommended (backlog)

6. Display PQL score as percentage instead of raw decimal for UI consistency.
7. Replace hardcoded `$` currency symbol with ruble sign or locale-aware formatting.
8. Add React Error Boundaries around major panels.
9. Add Zod runtime validation for Socket.io event payloads.
10. Add React hook integration tests for `useDialogs` and `useMessages` per the test plan in Refinement.md.
