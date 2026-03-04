# FR-14: Keyboard Shortcuts -- Architecture

**Feature:** FR-14 Keyboard Shortcuts
**BC:** BC-01 Conversation (Operator Workspace UI)
**Status:** Implemented

---

## 1. Component Architecture

```
Workspace Page (page.tsx)
  |
  |-- useKeyboardShortcuts(actions, enabled)
  |     |-- registers global 'keydown' listener on document
  |     |-- dispatches to action callbacks based on key combo
  |     |-- returns { shortcuts: SHORTCUT_MAP }
  |
  |-- ShortcutHelp (modal component)
  |     |-- reads SHORTCUT_MAP for rendering
  |     |-- controlled by shortcutHelpOpen state
  |     |-- own Escape handler (capture phase)
  |
  |-- QUICK_REPLY_TEMPLATES (constant)
        |-- 5 templates consumed by onQuickReply action
```

## 2. Layer Placement

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| Presentation | `ShortcutHelp.tsx` | Renders help overlay modal |
| Presentation | `page.tsx` (workspace) | Orchestrates shortcut state and action wiring |
| Application Hook | `useKeyboardShortcuts.ts` | Global keydown listener, input exclusion, dispatch |
| Constants | `quickReplies.ts` | Quick reply template data |
| Types | `ShortcutDef`, `KeyboardShortcutActions` | Interface contracts |

## 3. Data Flow

```
[User presses key]
       |
       v
[document 'keydown' event]
       |
       v
[useKeyboardShortcuts handleKeyDown]
       |
       +-- Check: enabled === false? --> return (no-op)
       |
       +-- Check: Ctrl+Enter? --> e.preventDefault() + onSendMessage()
       |
       +-- Check: Ctrl+K? --> e.preventDefault() + onFocusSearch()
       |
       +-- Check: isTypingInInput()? --> return (block remaining)
       |
       +-- Check: Alt+ArrowUp? --> onPreviousDialog()
       +-- Check: Alt+ArrowDown? --> onNextDialog()
       +-- Check: Alt+N? --> onNextUnassigned()
       +-- Check: Alt+A? --> onAssignDialog()
       +-- Check: Alt+C? --> onCloseDialog()
       +-- Check: Alt+1..9? --> onQuickReply(index)
       +-- Check: Escape? --> onEscape()
       +-- Check: '?'? --> onToggleHelp()
```

## 4. Key Design Decisions

### 4.1 Global Document Listener vs Per-Component

**Decision:** Single global `document.addEventListener('keydown', ...)` in a React hook.

**Rationale:** Keyboard shortcuts must work regardless of which element has focus. Per-component listeners would require focus management and would miss events when focus is on non-interactive elements.

**Trade-off:** Requires explicit input field exclusion logic (`isTypingInInput()`).

### 4.2 If/Else Chain vs Map Dispatch

**Decision:** Sequential if/else chain in the handler function.

**Rationale:** The handler needs to check compound conditions (modifier keys + specific key values) and some shortcuts (Ctrl+Enter, Ctrl+K) need to bypass the input exclusion check. A simple map lookup cannot express this ordering. With only 14 shortcuts, the performance difference is negligible.

### 4.3 Capture Phase for Help Overlay Escape

**Decision:** `ShortcutHelp` registers its own Escape handler with `capture: true`.

**Rationale:** When the help overlay is open, pressing Escape should close the overlay, not deselect the current dialog. By using capture phase, the overlay intercepts Escape before the global handler processes it.

### 4.4 Callback Actions Interface (Inversion of Control)

**Decision:** The hook accepts a `KeyboardShortcutActions` object with optional callbacks. It does NOT import or depend on workspace state.

**Rationale:** Keeps the hook reusable and testable. The workspace page wires the callbacks to its own state management (dialog selection, message sending, etc.). The hook has zero coupling to specific state management.

### 4.5 Single Source of Truth for Shortcut Definitions

**Decision:** `SHORTCUT_MAP` is a typed constant array exported from the hook module, consumed by both the handler logic and the `ShortcutHelp` component.

**Rationale:** Prevents drift between the actual shortcuts and what is displayed in the help overlay. Any addition or removal of a shortcut updates both the handler and the UI.

## 5. Cross-BC Compliance

This feature is entirely within **BC-01 Conversation** (workspace UI layer). It does NOT:

- Import from other bounded contexts (compliant with FF-02).
- Make API calls or database queries.
- Emit or consume domain events.
- Interact with MCP adapters.

The shortcut callbacks trigger workspace-level state changes that may indirectly invoke BC-01 application services (e.g., sending a message), but the shortcut system itself is purely a UI concern.

## 6. File Inventory

| File | Type | LOC |
|------|------|-----|
| `app/(workspace)/hooks/useKeyboardShortcuts.ts` | React Hook | ~167 |
| `app/(workspace)/components/ShortcutHelp.tsx` | React Component | ~100 |
| `app/(workspace)/constants/quickReplies.ts` | Constants | ~33 |
| `tests/workspace/keyboard-shortcuts.test.ts` | Test Suite | ~281 |

## 7. Sequence Diagram: Quick Reply via Alt+2

```
Operator        Document       useKeyboardShortcuts     page.tsx             ChatArea
   |               |                  |                     |                    |
   |--Alt+2------->|                  |                     |                    |
   |               |--keydown-------->|                     |                    |
   |               |                  |--isTypingInInput()  |                    |
   |               |                  |  (false)            |                    |
   |               |                  |--e.preventDefault() |                    |
   |               |                  |--onQuickReply(1)--->|                    |
   |               |                  |                     |--TEMPLATES[1]----->|
   |               |                  |                     |  .content          |
   |               |                  |                     |                    |--sendMessage()
   |               |                  |                     |                    |
```
