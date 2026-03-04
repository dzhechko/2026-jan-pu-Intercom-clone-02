# FR-14: Keyboard Shortcuts -- Specification

**Feature:** FR-14 Keyboard Shortcuts
**BC:** BC-01 Conversation (Operator Workspace UI)
**Status:** Implemented

---

## 1. Functional Requirements

### 1.1 Shortcut Registration

- The system MUST register 14 keyboard shortcuts across three categories: navigation (5), messaging (6), actions (3).
- Each shortcut MUST have a unique key combination (no collisions).
- Shortcuts MUST be defined in a single source-of-truth constant (`SHORTCUT_MAP`) used by both the event handler and the help overlay.

### 1.2 Modifier Key Handling

- `Ctrl` and `Meta` (Cmd on macOS) MUST be treated as equivalent modifiers for cross-platform support.
- Alt-based shortcuts MUST use the `altKey` property of the KeyboardEvent.
- Letter-based Alt shortcuts (Alt+A, Alt+C, Alt+N) MUST be case-insensitive.

### 1.3 Input Field Exclusion

- When the active element is `<input>`, `<textarea>`, `<select>`, or has `contentEditable=true`, all shortcuts MUST be suppressed EXCEPT:
  - `Ctrl+Enter` (send message) -- operators expect this to work while composing.
  - `Ctrl+K` (focus search) -- standard browser-level shortcut override.
- The exclusion check MUST be performed on every keydown event via `isTypingInInput()`.

### 1.4 Navigation Shortcuts

| Shortcut | Behavior |
|----------|----------|
| Ctrl+K | Calls `onFocusSearch()`. Prevents default browser bookmark dialog. |
| Alt+Up | Calls `onPreviousDialog()`. Clamps at first dialog (no wrap). |
| Alt+Down | Calls `onNextDialog()`. Clamps at last dialog (no wrap). |
| Alt+N | Calls `onNextUnassigned()`. Jumps to the next dialog with no assigned operator. |
| Escape | If help overlay is open, closes it. Otherwise calls `onEscape()` to deselect dialog / close panels. |

### 1.5 Messaging Shortcuts

| Shortcut | Behavior |
|----------|----------|
| Ctrl+Enter | Calls `onSendMessage()`. Works inside input fields. |
| Alt+1..5 | Calls `onQuickReply(index)` with 0-based index. Consumer inserts template text from `QUICK_REPLY_TEMPLATES[index]`. |
| Alt+6..9 | Accepted by handler (index passed) but no default template exists. Consumer must bounds-check. |

### 1.6 Action Shortcuts

| Shortcut | Behavior |
|----------|----------|
| Alt+A | Calls `onAssignDialog()`. Assigns the currently selected dialog to the logged-in operator. |
| Alt+C | Calls `onCloseDialog()`. Closes/resolves the currently selected dialog. |
| ? | Calls `onToggleHelp()`. Opens or closes the shortcut help overlay. Only fires when not typing in input. |

### 1.7 Help Overlay

- MUST render a modal overlay with semi-transparent backdrop (`bg-black/40`).
- MUST group shortcuts by category: Navigation, Messaging, Actions.
- MUST display each shortcut's human-readable label (e.g., `Alt+Up arrow`) and description.
- MUST close on Escape key (captured via `useEffect` with `capture: true` to intercept before the global handler).
- MUST close on backdrop click (clicking outside the modal content).
- MUST include a close button with `aria-label="Close"`.

### 1.8 Quick Reply Templates

- 5 default templates MUST be provided in Russian.
- Each template MUST have `id` (unique string), `label` (English), and `content` (Russian text).
- Templates are stored in `QUICK_REPLY_TEMPLATES` constant array.

## 2. Non-Functional Requirements

### 2.1 Performance

- Shortcut handling MUST add no perceptible latency. The `keydown` handler runs synchronously with O(1) branching (if/else chain, not a map lookup -- acceptable for 14 entries).
- No DOM queries except `document.activeElement` per keystroke.

### 2.2 Accessibility

- Help overlay MUST use semantic HTML (`<h2>`, `<h3>`, `<kbd>` elements).
- Close button MUST have `aria-label="Close"`.
- Keyboard trap MUST NOT occur: Escape always closes the overlay.
- `data-testid` attributes provided on overlay, close button, and trigger for automated testing.

### 2.3 Browser Compatibility

- Ctrl/Meta equivalence ensures macOS + Windows/Linux support.
- `e.key` used (not `e.keyCode`) for modern browser compatibility.

## 3. Data Model

### ShortcutDef Interface

```typescript
interface ShortcutDef {
  key: string                                      // e.g. 'Ctrl+K'
  label: string                                    // e.g. 'Ctrl+K' (human-readable)
  description: string                              // e.g. 'Focus search/filter dialogs'
  category: 'navigation' | 'messaging' | 'actions'
}
```

### KeyboardShortcutActions Interface

```typescript
interface KeyboardShortcutActions {
  onSendMessage?: () => void
  onFocusSearch?: () => void
  onPreviousDialog?: () => void
  onNextDialog?: () => void
  onNextUnassigned?: () => void
  onAssignDialog?: () => void
  onCloseDialog?: () => void
  onEscape?: () => void
  onQuickReply?: (index: number) => void
  onToggleHelp?: () => void
}
```

### QuickReply Type

```typescript
interface QuickReply {
  id: string
  label: string
  content: string
}
```

## 4. API Surface

This feature is entirely client-side. No REST endpoints, no WebSocket events, no database schema changes.

## 5. Integration Points

| Component | Integration |
|-----------|-------------|
| Workspace Page (`page.tsx`) | Consumes `useKeyboardShortcuts` hook, passes action callbacks |
| DialogList | Receives `selectedDialogId` and `onSelectDialog` for navigation |
| ChatArea | Exposes `sendMessageRef` for Ctrl+Enter; receives quick reply text |
| ShortcutHelp | Reads `SHORTCUT_MAP` for rendering; controlled by `shortcutHelpOpen` state |
