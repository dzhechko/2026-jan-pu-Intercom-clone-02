# FR-14: Keyboard Shortcuts -- Refinement

**Feature:** FR-14 Keyboard Shortcuts
**BC:** BC-01 Conversation (Operator Workspace UI)
**Status:** Implemented

---

## 1. Edge Cases

### EC-14-01: Shortcut fired while help overlay is open

**Scenario:** Operator has the help overlay open and presses Alt+A (assign).
**Current behavior:** The help overlay's Escape handler is capture-phase only. Non-Escape shortcuts still reach the global handler. Alt+A would assign the dialog even with the overlay visible.
**Risk:** LOW -- operators are unlikely to press action shortcuts while reading help.
**Mitigation (future):** Add `enabled: false` to `useKeyboardShortcuts` when overlay is open.

### EC-14-02: Alt+6..9 with no matching template

**Scenario:** Operator presses Alt+7 but only 5 templates exist.
**Current behavior:** `onQuickReply(6)` is called. The consumer in `page.tsx` checks bounds: `if (index < QUICK_REPLY_TEMPLATES.length)` before calling `sendMessage`.
**Risk:** NONE -- properly guarded.

### EC-14-03: Rapid repeated key presses

**Scenario:** Operator holds Alt+Down, firing many keydown events.
**Current behavior:** Each event calls `onNextDialog()` synchronously. Dialog selection updates on each call.
**Risk:** LOW -- React state batching prevents visual jank. No debouncing needed for navigation.

### EC-14-04: Browser shortcut conflicts

**Scenario:** Alt+D (browser address bar) or Ctrl+K (browser bookmark/search) may conflict.
**Current behavior:** Ctrl+K explicitly calls `e.preventDefault()` to override browser default. Alt+D is not used by the application.
**Risk:** LOW -- only Ctrl+K has a known conflict, and it is handled.

### EC-14-05: macOS Meta key vs Ctrl

**Scenario:** macOS user presses Cmd+Enter instead of Ctrl+Enter.
**Current behavior:** `ctrlOrMeta = e.ctrlKey || e.metaKey` covers both.
**Risk:** NONE -- explicitly handled.

### EC-14-06: Focus in Shadow DOM or iframe

**Scenario:** If a third-party widget renders in a Shadow DOM or iframe, `document.activeElement` may return the host element, not the actual input.
**Current behavior:** `isTypingInInput()` checks `document.activeElement` which does not pierce Shadow DOM boundaries.
**Risk:** LOW -- no current Shadow DOM or iframe usage in the workspace. Monitor if third-party components are added.

### EC-14-07: Multiple workspace tabs

**Scenario:** Operator has the workspace open in multiple browser tabs.
**Current behavior:** Each tab has its own `useKeyboardShortcuts` instance. Shortcuts only affect the active tab.
**Risk:** NONE -- standard browser behavior.

## 2. Security Considerations

- **No PII exposure:** Keyboard shortcuts do not transmit data. Quick reply templates contain generic text, no PII.
- **No tenant isolation concern:** This is a client-side-only feature. Actions triggered by shortcuts go through the existing API layer with JWT/RLS enforcement.
- **XSS risk:** Quick reply templates are hardcoded constants, not user-input. No injection risk.

## 3. Performance Considerations

- **Single event listener:** One `document.addEventListener('keydown', ...)` for all shortcuts. Cleanup on unmount via `useEffect` return.
- **No DOM mutation on keydown:** The handler only calls state-setting callbacks. React batches the resulting renders.
- **Memoization:** `handleKeyDown` is wrapped in `useCallback` with `[enabled, actions]` dependencies. `shortcuts` is wrapped in `useMemo`.
- **No observable performance impact:** The handler performs at most 12 comparisons per keydown event (worst case: falls through to `?` check). Sub-microsecond execution.

## 4. Accessibility Audit

| Criterion | Status | Notes |
|-----------|--------|-------|
| Keyboard navigable | PASS | All shortcuts are keyboard-driven by definition |
| No keyboard trap | PASS | Escape always exits the help overlay |
| ARIA labels | PASS | Close button has `aria-label="Close"` |
| Semantic HTML | PASS | `<h2>`, `<h3>`, `<kbd>` used in help overlay |
| Screen reader friendly | PARTIAL | Help overlay lacks `role="dialog"` and `aria-modal="true"` |
| Focus management | PARTIAL | Opening help overlay does not move focus into the modal |

### Recommended Improvements (future)

1. Add `role="dialog"` and `aria-modal="true"` to the help overlay container.
2. Trap focus within the modal when open (tab cycling).
3. Move focus to the close button when the overlay opens.
4. Return focus to the trigger element when the overlay closes.

## 5. Testing Coverage

| Category | Tests | Status |
|----------|-------|--------|
| Shortcut registration | 4 | PASS |
| Action mapping | 5 | PASS |
| Input field exclusion | 6 | PASS |
| Ctrl+Enter send | 2 | PASS |
| Dialog navigation | 8 | PASS |
| Quick reply dispatch | 7 | PASS |
| Help panel categories | 3 | PASS |
| **Total** | **35** | **ALL PASS** |

## 6. Known Limitations

1. **Shortcuts not customizable:** Operators cannot remap keys. This is a deliberate M2 scope decision.
2. **Quick reply templates hardcoded:** Templates are constants, not tenant-configurable. Future M3 work to allow per-tenant customization.
3. **No visual key press feedback:** When a shortcut fires, there is no toast or highlight confirming the action. Operators rely on the resulting state change (e.g., dialog closes, message appears).
4. **Help overlay accessibility gaps:** Missing `role="dialog"`, `aria-modal`, focus trapping (see Section 4).

## 7. Future Enhancements

| Enhancement | Priority | Milestone |
|-------------|----------|-----------|
| Custom shortcut remapping | LOW | M3 |
| Tenant-configurable quick reply templates | MEDIUM | M3 |
| Visual feedback on shortcut activation | LOW | M3 |
| Full ARIA dialog pattern for help overlay | MEDIUM | M2 patch |
| Shortcut analytics (which shortcuts are used most) | LOW | M3 |
