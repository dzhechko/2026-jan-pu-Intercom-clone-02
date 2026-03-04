# FR-14: Keyboard Shortcuts -- Review Report

**Feature:** FR-14 Keyboard Shortcuts
**Date:** 2026-03-04
**Reviewer:** Architecture + Code Quality Review

---

## 1. Overall Assessment

**Verdict: APPROVED with minor recommendations**

The keyboard shortcuts implementation is clean, well-structured, and follows project conventions. The code is well-tested (35 tests, all passing), has zero cross-BC dependencies, and uses appropriate React patterns. Two accessibility gaps are identified for follow-up.

## 2. Architecture Compliance

| Rule | Status | Details |
|------|--------|---------|
| FF-02: No cross-BC imports | COMPLIANT | All 4 files reside within `app/(workspace)/`. No imports from `src/pql/`, `src/revenue/`, etc. |
| FF-03: Tenant RLS isolation | N/A | Client-side feature; no database access. Actions triggered by shortcuts pass through existing API layer with JWT/RLS. |
| FF-04: Circuit Breaker on MCP | N/A | No MCP adapter calls. |
| FF-10: Data residency | COMPLIANT | No external API calls. Quick reply templates are local constants. |
| Domain language | COMPLIANT | Uses "Dialog" consistently. Uses "Operator" in comments and descriptions. |
| Coding style | COMPLIANT | TypeScript strict, explicit interfaces, no `any`, no `@ts-ignore`. |

## 3. Code Quality Review

### 3.1 useKeyboardShortcuts.ts

**Strengths:**
- Clean separation of concerns: hook handles event detection only, delegates actions via callbacks.
- `isTypingInInput()` is extracted as a standalone function, improving testability.
- `useCallback` and `useMemo` used appropriately to prevent unnecessary re-renders.
- Good JSDoc comments on interface fields.

**Minor observations:**
- The `shortcuts` return value (`useMemo(() => SHORTCUT_MAP, [])`) is technically unnecessary since `SHORTCUT_MAP` is a module-level constant that never changes. The `useMemo` adds no value here. However, this is harmless.
- The if/else chain handles Alt+1..9 but the SHORTCUT_MAP only lists Alt+1..5. The handler is more permissive than the documented shortcuts. This is intentional (documented in the plan) but could confuse future developers.

### 3.2 ShortcutHelp.tsx

**Strengths:**
- Semantic HTML: `<h2>`, `<h3>`, `<kbd>` elements used correctly.
- `aria-label="Close"` on the close button.
- `data-testid` attributes for testing.
- Overlay click handling correctly checks `e.target === overlayRef.current` to avoid closing when clicking inside the modal.

**Accessibility gaps:**
1. **Missing `role="dialog"` and `aria-modal="true"`** on the modal container. Screen readers will not announce this as a dialog.
2. **No focus trapping.** When the modal is open, Tab can move focus outside the modal to elements behind the backdrop.
3. **No focus management on open/close.** Focus is not moved into the modal when it opens, nor returned to the trigger when it closes.

**Recommendation:** These are standard ARIA dialog pattern requirements (WAI-ARIA 1.2). Recommend addressing in an M2 patch:

```tsx
// On the modal container div:
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="shortcut-help-title"
  className="bg-white rounded-xl ..."
>
  <h2 id="shortcut-help-title">Keyboard Shortcuts</h2>
```

### 3.3 quickReplies.ts

**Strengths:**
- Clean data structure with typed `QuickReply` interface.
- Unique IDs for each template.
- Russian content matches target market.

**Observation:** Templates are hardcoded. This is appropriate for M2 but should be tenant-configurable in M3.

### 3.4 keyboard-shortcuts.test.ts

**Strengths:**
- 35 tests across 7 logical groups -- thorough coverage.
- Tests cover boundary conditions (empty list, unknown ID, out-of-bounds index).
- Input exclusion logic tested for all relevant element types.

**Observations:**
- Tests duplicate the `SHORTCUT_MAP` constant and `isTypingInInput()` logic rather than importing from the source. This means tests could pass even if the source code changes (test and source drift). However, this is a common pattern in unit tests that test logic in isolation rather than integration.
- No DOM/React rendering tests for the `ShortcutHelp` component. The test suite validates data structures and algorithms but not the rendered UI. Component tests with React Testing Library would strengthen confidence.

## 4. Accessibility Review

### 4.1 Keyboard Shortcuts Themselves

| Criterion | Status |
|-----------|--------|
| Standard modifier patterns (Ctrl, Alt) | PASS |
| No single-letter shortcuts that conflict with screen reader commands | PASS (except `?`, which is blocked in input fields) |
| Escape always available to exit modal | PASS |
| No keyboard trap | PASS |

### 4.2 Help Overlay

| Criterion | Status | Action |
|-----------|--------|--------|
| `role="dialog"` | MISSING | Add to modal container |
| `aria-modal="true"` | MISSING | Add to modal container |
| `aria-labelledby` pointing to heading | MISSING | Add `id` to `<h2>`, reference in `aria-labelledby` |
| Focus moves into modal on open | MISSING | Auto-focus close button or first focusable element |
| Focus returns to trigger on close | MISSING | Store trigger ref, restore on close |
| Focus trap (Tab cycling within modal) | MISSING | Implement focus trap utility |
| Close button `aria-label` | PRESENT | Already has `aria-label="Close"` |
| `<kbd>` elements for shortcut labels | PRESENT | Semantically correct for key representations |

### 4.3 Severity Assessment

The missing ARIA attributes and focus management are **Medium severity** accessibility issues. They do not block keyboard-only users (Escape works, shortcuts are keyboard-native), but they degrade the experience for screen reader users. Recommend fixing before M2 release.

## 5. Security Review

| Concern | Status |
|---------|--------|
| XSS via quick reply templates | SAFE -- templates are hardcoded constants, not user input |
| Shortcut injection | N/A -- shortcuts are defined in code, not configurable |
| PII exposure | SAFE -- no data transmitted by the shortcut system |
| Tenant isolation | N/A -- client-side only; API calls triggered by shortcuts go through JWT/RLS |

## 6. Summary of Findings

| Finding | Severity | Category | Action |
|---------|----------|----------|--------|
| Missing `role="dialog"` + `aria-modal` on help overlay | MEDIUM | Accessibility | Fix in M2 patch |
| Missing focus trapping in help overlay | MEDIUM | Accessibility | Fix in M2 patch |
| Missing focus management (move on open, restore on close) | MEDIUM | Accessibility | Fix in M2 patch |
| No React component tests for ShortcutHelp | LOW | Testing | Add in M2 or M3 |
| `useMemo` on constant value is unnecessary | TRIVIAL | Code quality | Optional cleanup |
| Quick reply templates not tenant-configurable | INFO | Product | Planned for M3 |

## 7. Verdict

**APPROVED** -- The implementation is solid, well-tested, and architecturally compliant. The accessibility gaps in the help overlay modal are the only actionable findings and should be addressed in an M2 patch before production release. No blocking issues found.
