# Brutal Honesty Review: FR-14 Keyboard Shortcuts

**Feature ID:** FR-14
**Reviewer:** Brutal Honesty Review (swarm)
**Date:** 2026-03-04
**Overall Verdict:** CONDITIONALLY APPROVED — significant test quality issues and accessibility defects require action before production

---

## Summary Judgment

The implementation is mechanically correct and follows React hook patterns cleanly. The hook itself is well-structured. But three things prevent a clean approval:

1. The test suite does not test the actual implementation — it tests a hardcoded copy of it. This is a critical quality failure.
2. The help overlay (`ShortcutHelp.tsx`) ships with five documented ARIA violations that make it non-functional for screen reader users.
3. A documented edge case (shortcuts firing while the help overlay is open) was acknowledged in the refinement docs and deliberately left unfixed. This is acceptable for LOW-risk cases — the rationale holds — but it needs an honest severity label, not the document's dismissive wave.

Everything else is solid. The hook design is clean, the inversion-of-control pattern is correct, and the `page.tsx` wiring is faithful to the spec.

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — PASS

All four implementation files reside entirely within `app/(workspace)/`:
- `hooks/useKeyboardShortcuts.ts` — imports only from React
- `components/ShortcutHelp.tsx` — imports from `../hooks/useKeyboardShortcuts` (same workspace module)
- `constants/quickReplies.ts` — imports from `../types` (same workspace module)
- `tests/workspace/keyboard-shortcuts.test.ts` — imports from `../../app/(workspace)/constants/quickReplies`

No imports from `src/pql/`, `src/revenue/`, `src/integration/`, `src/iam/`, or `src/notifications/`. Fully compliant.

### FF-03: Tenant RLS Isolation — N/A

Client-side only. No database queries. Shortcuts that trigger actions (assign, close) delegate to existing API-layer functions in `page.tsx` that already carry JWT headers. The shortcut layer adds no new data access paths.

### FF-04: Circuit Breaker on MCP — N/A

No MCP calls. No external services.

### FF-10: Data Residency — PASS

No external API calls. Quick reply templates are local constants. Nothing leaves the browser.

### ADR compliance (overall) — PASS

No LLM calls, no cross-tenant operations, no bypass of the API layer. The feature scope was correctly limited to the UI.

---

## 2. The Test Suite Problem (CRITICAL)

This is the most important finding in this review. It must be stated plainly:

**The test file does not import or test `useKeyboardShortcuts.ts`. It re-implements the logic it claims to test.**

```typescript
// tests/workspace/keyboard-shortcuts.test.ts — lines 10-32
// "Helper: simulate shortcut map structure (mirrors useKeyboardShortcuts)"
const SHORTCUT_MAP: ShortcutDef[] = [
  { key: 'Ctrl+K', label: 'Ctrl+K', ... },
  ...
]
```

And the input exclusion logic:

```typescript
// tests/workspace/keyboard-shortcuts.test.ts — lines 107-113
function isTypingInInput(tagName: string, isContentEditable = false): boolean {
  const tag = tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (isContentEditable) return true
  return false
}
```

The test file contains a full local copy of both `SHORTCUT_MAP` and `isTypingInInput()`. The tests then assert against these local copies. This means:

- You could delete `useKeyboardShortcuts.ts` entirely and all 35 tests would still pass.
- You could change a shortcut key in the source file and the tests would not catch it.
- The "test drift" risk noted in the existing `review-report.md` is not a minor observation — it is the core architecture of the entire test suite.

The validation report claims "35 tests, all passing" as evidence of implementation quality. That claim is technically true but substantially misleading. The tests validate the correctness of the test file's local copy, not the implementation file.

**What is actually tested against the real source:**
- `QUICK_REPLY_TEMPLATES` from `constants/quickReplies.ts` — this is imported correctly (line 7). These 7 tests are genuine.
- Everything else tests a hardcoded duplicate.

**Honest count:** 7 of 35 tests (20%) verify the actual implementation. The other 28 test internal test-file constants.

**Severity:** HIGH — this is a structural gap in test quality, not a code style nitpick. The existing review documents knew about "test and source drift" but rated it LOW. That rating is wrong.

**Fix required:**

```typescript
// Correct approach: import from source
import { SHORTCUT_MAP, isTypingInInput } from '../../app/(workspace)/hooks/useKeyboardShortcuts'
// Note: isTypingInInput is currently unexported — it must be exported to be testable
```

Alternatively, use React Testing Library to fire real `KeyboardEvent` instances against a mounted component. This would test the actual handler behavior end-to-end.

---

## 3. Accessibility Defects in ShortcutHelp.tsx (MEDIUM — must fix before production)

The existing review documentation correctly identifies these gaps. This section restates them with direct code references because the existing review was written as "recommendations" when they are actually specification violations.

The `Specification.md` (section 1.7) states:

> "MUST render a modal overlay with semi-transparent backdrop"
> "MUST close on Escape key"
> "MUST include a close button with `aria-label='Close'`"

`aria-label="Close"` is present. The Escape handler is present. But the spec also implicitly requires a functional dialog pattern, and the WAI-ARIA 1.2 dialog pattern is the standard for modals. The current implementation fails it on five points:

| ARIA Requirement | Current State | Code Location |
|-----------------|---------------|---------------|
| `role="dialog"` on modal container | ABSENT | `ShortcutHelp.tsx` line 48 |
| `aria-modal="true"` | ABSENT | `ShortcutHelp.tsx` line 48 |
| `aria-labelledby` pointing to heading | ABSENT | `ShortcutHelp.tsx` line 48 and 51 |
| Focus moves into modal on open | ABSENT | No `autoFocus` or `focus()` call |
| Focus returns to trigger on close | ABSENT | No trigger ref stored |
| Tab focus trapped within modal | ABSENT | No focus trap utility |

The current modal container:

```tsx
// ShortcutHelp.tsx line 41-47
<div
  ref={overlayRef}
  onClick={handleOverlayClick}
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
  data-testid="shortcut-help-overlay"
>
```

It is a styled `<div>` with no ARIA semantics. Screen readers will not announce its presence as a modal dialog. Focus is not managed. A keyboard-only user who cannot use a mouse can close it with Escape, but they receive no announcement that a dialog opened and cannot know the context.

**The minimum viable fix:**

```tsx
<div
  ref={overlayRef}
  onClick={handleOverlayClick}
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
  data-testid="shortcut-help-overlay"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="shortcut-help-title"
    className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
  >
    <h2 id="shortcut-help-title" className="text-base font-semibold text-gray-900">
      Keyboard Shortcuts
    </h2>
    ...
  </div>
</div>
```

Focus management requires either a `useRef` on the modal container with `.focus()` in `useEffect`, or a focus trap hook. This is 10-20 lines of standard code.

**Note on severity:** The existing review labeled these MEDIUM and recommended an "M2 patch." This document labels them the same. But they should not ship to production in the current state — the feature markets itself as a keyboard-centric UX improvement. A keyboard shortcut help overlay that violates basic keyboard accessibility patterns is a credibility problem.

---

## 4. Acknowledged Gap Left Open: EC-14-01 (Shortcuts Fire with Overlay Open)

The `Refinement.md` correctly identifies this scenario and its mitigation path:

> "EC-14-01: Alt+A would assign the dialog even with the overlay visible."
> "Mitigation (future): Add `enabled: false` to `useKeyboardShortcuts` when overlay is open."

The actual fix is one line in `page.tsx`:

```typescript
// Current (line 227 of page.tsx):
useKeyboardShortcuts({ actions: shortcutActions })

// Fix:
useKeyboardShortcuts({ actions: shortcutActions, enabled: !shortcutHelpOpen })
```

`shortcutHelpOpen` is already in scope. The hook already supports an `enabled` parameter. This is a known gap with a trivially available fix that was deliberately deferred. The deferral is defensible given LOW risk, but the fix cost is essentially zero — it should have been included.

**Severity:** LOW — but it is a design completeness issue, not a future-work item. Fix it now.

---

## 5. Code Quality Analysis

### useKeyboardShortcuts.ts — Good

The implementation matches the pseudocode exactly. The if/else chain order is correct: input-bypassing shortcuts first, then the `isTypingInInput()` gate, then the remaining shortcuts. The `useCallback` dependency array `[enabled, actions]` is correct. The `useEffect` cleanup removes the listener properly.

**One genuine nitpick:** The `useMemo` wrapping a stable module-level constant:

```typescript
// Line 76
const shortcuts = useMemo(() => SHORTCUT_MAP, [])
```

`SHORTCUT_MAP` is a module-level constant. It will never change between renders. `useMemo` with an empty dependency array wrapping a constant reference computes once and holds the same reference `SHORTCUT_MAP` already provides. The return value `{ shortcuts }` could be replaced with `{ shortcuts: SHORTCUT_MAP }` without any observable effect. This is harmless but creates a false implication that the memo is protecting against some recomputation that does not exist.

**One real risk: the `actions` object in the dependency array.** The `handleKeyDown` callback re-creates whenever `actions` changes. In `page.tsx`, `shortcutActions` is computed via `useMemo` (line 184), so it only re-creates when its own dependencies change. This is correctly implemented. But any consumer who passes an inline object literal `{ onSendMessage: () => ... }` directly would cause `handleKeyDown` to re-create on every render, which would re-add and remove the `document` event listener on every render. This is a usage trap that is not documented anywhere. The hook's JSDoc should warn about this.

### ShortcutHelp.tsx — Acceptable with Caveats

The Escape capture-phase handler is correctly implemented. The overlay-click detection using `e.target === overlayRef.current` correctly avoids closing when clicking inside the modal content. The `CATEGORIES` array pattern for iterating shortcut groups by category is clean.

The ARIA issues are documented above.

**One missed behavior:** The Escape handler in `ShortcutHelp.tsx` calls `e.stopPropagation()`. The global handler in `useKeyboardShortcuts.ts` is registered on `document` with no capture flag (bubble phase). The `ShortcutHelp` handler uses capture phase (`true` as the third argument). Capture phase fires before bubble phase, so `stopPropagation()` from capture phase does **not** stop bubble-phase handlers. The correct call to prevent the global handler from seeing the event is `e.stopImmediatePropagation()`, not `e.stopPropagation()`.

This works in practice only because the global handler checks `e.key === 'Escape'` and calls `onEscape()`, which in the `page.tsx` wiring checks `if (shortcutHelpOpen) setShortcutHelpOpen(false)` — so both handlers close the overlay, and the result is the same. But the reasoning in the architecture docs ("using capture phase ensures this handler fires BEFORE the global handler") is technically correct about ordering but the `stopPropagation()` call does not actually prevent the global handler from firing. The feature works correctly due to the application-level guard in `onEscape`, not due to the propagation stop.

**Severity of the stopPropagation issue:** LOW — the observable behavior is correct. But the code comment implies a guarantee that does not exist. Document or fix.

### quickReplies.ts — Pass

Five templates, unique IDs, Russian content, typed. Nothing to criticize.

### page.tsx keyboard wiring — Good

The `shortcutActions` `useMemo` dependency array on lines 214-224 is complete:

```typescript
[navigateDialog, jumpToNextUnassigned, selectedDialogId, selectedDialog,
 handleAssign, handleCloseDialog, sendMessage, shortcutHelpOpen]
```

The `onEscape` handler correctly checks `shortcutHelpOpen` before deciding whether to close the overlay or deselect the dialog. The `onAssignDialog` and `onCloseDialog` guards check dialog status before firing. The `onQuickReply` bounds check is correct.

One minor observation: `onSendMessage: () => sendMessageRef.current?.()` uses a mutable ref to break the dependency between the shortcut action and the ChatArea's send function. This is intentional and correct — it avoids stale closure issues. The pattern is sound but undocumented. Add a comment.

---

## 6. Documentation vs Implementation Fidelity

The SPARC documents were written with care and are largely faithful to the implementation. Specific discrepancies:

| Document | Claim | Reality |
|----------|-------|---------|
| Specification.md §1.5 | "Alt+6..9 Accepted by handler (index passed) but no default template exists. Consumer must bounds-check." | Correct. Handler passes index to `onQuickReply`; `page.tsx` checks `index < QUICK_REPLY_TEMPLATES.length`. |
| Architecture.md §4.3 | "By using capture phase, the overlay intercepts Escape before the global handler processes it." | The capture-phase ordering is correct but `stopPropagation()` does not stop the global bubble-phase handler from firing. The overlay close still works, but for the wrong reason (application guard, not propagation stop). |
| Refinement.md §5 | "handleKeyDown is wrapped in useCallback with [enabled, actions] dependencies" | Correct. |
| validation-report.md | "35 tests, all passing" — presented as evidence of implementation coverage | Misleading. 28 of 35 tests test a hardcoded local copy of the source, not the source itself. |
| PRD.md | Success metric: ">50% of common responses sent via Alt+N" | Alt+N is for next unassigned dialog navigation, not quick replies. The metric likely intended Alt+1..5. This is a PRD error. |

The PRD metric error is notable. The PRD says:

> "Quick reply usage: >50% of common responses sent via Alt+N"

Alt+N is the "jump to next unassigned dialog" shortcut. It does not send quick replies. Alt+1..5 send quick replies. This is a typo in the PRD that was never caught through any review phase, including the validation report which validated all acceptance criteria without catching this inconsistency.

---

## 7. Security Review

| Concern | Status | Notes |
|---------|--------|-------|
| XSS via quick reply content | SAFE | Templates are hardcoded constants at build time |
| Shortcut injection from external sources | N/A | Shortcuts are defined in source code |
| Unintended action execution | LOW | Alt+A and Alt+C guards check dialog status before firing |
| No PII transmitted by shortcut system | SAFE | Actions pass through existing JWT-protected API layer |

No security findings.

---

## 8. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architectural compliance | 10/10 | Perfect BC isolation, correct layer placement |
| Code quality (hook + component) | 7/10 | `stopPropagation` misconception, undocumented `actions` object trap |
| Test quality | 4/10 | 28/35 tests test a local copy, not the implementation |
| Accessibility | 5/10 | 5 ARIA violations in the help overlay |
| Security | 10/10 | No issues |
| Documentation fidelity | 7/10 | PRD metric error, stopPropagation rationale is incorrect |

**Overall: 43/60 (72%) — CONDITIONALLY APPROVED**

---

## 9. Required Actions Before Production

### BLOCKING

1. **Fix the test suite to import from source.** Export `isTypingInInput` from `useKeyboardShortcuts.ts` and import `SHORTCUT_MAP` + `isTypingInInput` in the test file instead of re-declaring them. Add at least one React Testing Library test that fires a real `KeyboardEvent` against a mounted component to verify end-to-end behavior.

2. **Add ARIA dialog semantics to ShortcutHelp.** Add `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` to the modal container. Add focus management on open. This is the minimum bar for a component that calls itself an accessibility-aware help panel.

### RECOMMENDED (before M2 release)

3. **Disable shortcuts when overlay is open.** Pass `enabled: !shortcutHelpOpen` to `useKeyboardShortcuts`. The `enabled` parameter exists precisely for this case.

4. **Fix the `stopPropagation` comment in ShortcutHelp.** Either change to `stopImmediatePropagation()` for correctness, or add a comment explaining that both handlers close the overlay and the redundancy is intentional.

5. **Fix the PRD metric typo.** "Quick reply usage: >50% sent via Alt+N" should reference Alt+1..5, not Alt+N.

### DEFERRED (M3)

6. Document the `actions` object stability requirement in the hook's JSDoc to prevent consumer-side stale listener bugs.

7. Add React Testing Library tests for the `ShortcutHelp` component render and interaction.

8. Tenant-configurable quick reply templates.

---

## 10. Conclusion

FR-14 is a well-designed feature with a clean implementation at the hook level. The inversion-of-control pattern is textbook correct and the `page.tsx` wiring is careful and complete. These are genuine strengths.

The critical problem is that the test suite provides a false sense of coverage. 35 tests passing sounds like confidence. The reality is that 28 of those tests are self-referential — they prove that the test author typed the same constants twice. This is not test coverage; it is test theater. Fix this before shipping.

The accessibility gaps in the help overlay are real but fixable in an afternoon. A feature designed to improve keyboard-centric UX should not ship a help modal that fails basic keyboard accessibility standards.

Fix the tests and the ARIA issues. Then this feature is ready.
