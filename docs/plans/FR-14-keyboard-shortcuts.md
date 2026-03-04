# FR-14: Keyboard Shortcuts
**Status:** Done | **BC:** BC-01 Conversation (workspace UI) | **Priority:** SHOULD

## Summary
Implemented a comprehensive keyboard shortcut system for the operator workspace with 14 shortcuts across three categories (navigation, messaging, actions), a quick reply template system (Alt+1..5), input field exclusion logic to prevent shortcut interference while typing, and a help overlay panel toggled by pressing `?`.

## User Stories
- US-14a: As an operator, I want keyboard shortcuts for common actions so that I can handle dialogs faster without using the mouse.
- US-14b: As an operator, I want quick reply templates bound to Alt+1..5 so that I can send frequent responses instantly.
- US-14c: As an operator, I want a shortcut help panel so that I can discover available shortcuts.

## Technical Design

### Files Created
- `app/(workspace)/hooks/useKeyboardShortcuts.ts` -- React hook registering global keydown listener with 14 shortcut definitions. Handles modifier key detection (Ctrl/Meta, Alt), input field exclusion via isTypingInInput(), and dispatches to callback actions. Ctrl+Enter and Ctrl+K work even inside input fields; all other shortcuts are blocked when focus is in input/textarea/select/contentEditable.
- `app/(workspace)/components/ShortcutHelp.tsx` -- Modal overlay component displaying all shortcuts grouped by category (Navigation, Messaging, Actions). Closes on Escape or overlay click. Uses SHORTCUT_MAP from the hook for data.
- `app/(workspace)/constants/quickReplies.ts` -- 5 default quick reply templates in Russian: connect specialist, request email, 24h follow-up, demo offer, transfer to sales.
- `tests/workspace/keyboard-shortcuts.test.ts` -- 28 tests covering shortcut registration, action mapping, input field exclusion, navigation logic, quick reply dispatch, and help panel categories.

### Key Decisions
- **Ctrl+Enter and Ctrl+K bypass input exclusion:** These two shortcuts work even when the operator is typing in the message input, since send (Ctrl+Enter) and search (Ctrl+K) are expected to work from within text fields.
- **Alt+1..9 range supported, but only 5 templates defined:** The hook accepts Alt+1 through Alt+9 and passes the 0-based index to onQuickReply. Only 5 templates are defined by default, so Alt+6..9 are effectively no-ops unless the consumer adds more.
- **isTypingInInput() checks tagName and contentEditable:** Prevents accidental shortcut triggers when the operator is composing a message in input, textarea, select, or contentEditable elements.
- **SHORTCUT_MAP exported as constant array:** Used by both the hook (for documentation) and the ShortcutHelp component (for rendering). Single source of truth for all shortcut definitions.
- **Templates in Russian:** Quick reply content matches the target market (Russian SaaS support teams).

## API Endpoints
N/A -- this is a purely frontend feature.

## Socket.io Events
N/A -- keyboard shortcuts trigger local UI actions that may subsequently emit Socket.io events (e.g., sending a message), but the shortcut system itself does not define new events.

## Dependencies
- Depends on: FR-07 (Operator Workspace UI), FR-13 (Multi-operator -- assignment and close actions)
- Blocks: none

## Tests
- `tests/workspace/keyboard-shortcuts.test.ts` -- 28 tests covering:
  - Shortcut registration: all expected keys present, Alt+1..5 for quick replies, at least one per category, unique keys
  - Action mapping: Ctrl+Enter -> send, Alt+A -> assign, Alt+C -> close, Escape -> deselect, Alt+N -> next unassigned
  - Input field exclusion: INPUT, TEXTAREA, SELECT, contentEditable detected; regular DIV and BUTTON not detected
  - Ctrl+Enter send behavior: registered as messaging/send shortcut
  - Dialog navigation (Alt+Up/Down): next/prev movement, boundary clamping, null selection, empty list, unknown selection
  - Quick reply dispatch: 5 templates with id/label/content, Alt+1 -> first template, Alt+5 -> last, bounds validation, unique IDs
  - Help panel categories: navigation includes search + dialog switching, messaging includes send + quick replies, actions includes assign + close

## Acceptance Criteria
- [x] 14 keyboard shortcuts registered across navigation, messaging, and actions categories
- [x] Ctrl+Enter sends the current message (works inside input fields)
- [x] Ctrl+K focuses search/filter (works inside input fields)
- [x] Alt+Up/Down navigates between dialogs
- [x] Alt+N jumps to next unassigned dialog
- [x] Alt+A assigns current dialog to the operator
- [x] Alt+C closes current dialog
- [x] Escape deselects dialog / closes panels
- [x] Alt+1..5 sends quick reply templates
- [x] Shortcuts are blocked when typing in input/textarea/select/contentEditable (except Ctrl+Enter and Ctrl+K)
- [x] `?` key toggles shortcut help overlay
- [x] Help overlay displays shortcuts grouped by category with key labels
- [x] Help overlay closes on Escape or overlay click
- [x] All shortcut keys are unique (no collisions)
- [x] Quick reply templates have unique IDs and non-empty content
