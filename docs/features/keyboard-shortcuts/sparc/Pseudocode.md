# FR-14: Keyboard Shortcuts -- Pseudocode

**Feature:** FR-14 Keyboard Shortcuts
**BC:** BC-01 Conversation (Operator Workspace UI)
**Status:** Implemented

---

## Algorithm 1: Global Shortcut Handler

**File:** `app/(workspace)/hooks/useKeyboardShortcuts.ts`
**Function:** `handleKeyDown(event: KeyboardEvent)`

```
FUNCTION handleKeyDown(event):
    IF NOT enabled THEN RETURN

    ctrlOrMeta = event.ctrlKey OR event.metaKey
    typing = isTypingInInput()

    // --- Priority 1: Shortcuts that work INSIDE input fields ---

    IF ctrlOrMeta AND event.key == 'Enter':
        event.preventDefault()
        CALL actions.onSendMessage()
        RETURN

    IF ctrlOrMeta AND event.key == 'k':
        event.preventDefault()
        CALL actions.onFocusSearch()
        RETURN

    // --- Gate: Block all remaining shortcuts when typing ---

    IF typing THEN RETURN

    // --- Priority 2: Alt + Arrow navigation ---

    IF event.altKey AND event.key == 'ArrowUp':
        event.preventDefault()
        CALL actions.onPreviousDialog()
        RETURN

    IF event.altKey AND event.key == 'ArrowDown':
        event.preventDefault()
        CALL actions.onNextDialog()
        RETURN

    // --- Priority 3: Alt + Letter actions ---

    IF event.altKey AND event.key IN ['n', 'N']:
        event.preventDefault()
        CALL actions.onNextUnassigned()
        RETURN

    IF event.altKey AND event.key IN ['a', 'A']:
        event.preventDefault()
        CALL actions.onAssignDialog()
        RETURN

    IF event.altKey AND event.key IN ['c', 'C']:
        event.preventDefault()
        CALL actions.onCloseDialog()
        RETURN

    // --- Priority 4: Alt + Number quick replies ---

    IF event.altKey AND event.key >= '1' AND event.key <= '9':
        event.preventDefault()
        index = parseInt(event.key) - 1
        CALL actions.onQuickReply(index)
        RETURN

    // --- Priority 5: Unmodified keys ---

    IF event.key == 'Escape':
        CALL actions.onEscape()
        RETURN

    IF event.key == '?' AND NOT event.altKey AND NOT ctrlOrMeta:
        event.preventDefault()
        CALL actions.onToggleHelp()
        RETURN
END FUNCTION
```

## Algorithm 2: Input Field Detection

**File:** `app/(workspace)/hooks/useKeyboardShortcuts.ts`
**Function:** `isTypingInInput(): boolean`

```
FUNCTION isTypingInInput():
    element = document.activeElement
    IF element IS NULL THEN RETURN false

    tag = element.tagName.toLowerCase()

    IF tag IN ['input', 'textarea', 'select']:
        RETURN true

    IF element.isContentEditable == true:
        RETURN true

    RETURN false
END FUNCTION
```

## Algorithm 3: Dialog Navigation

**File:** `app/(workspace)/page.tsx` (inline in shortcut action callback)
**Function:** `navigateDialog(direction: 'prev' | 'next')`

```
FUNCTION navigateDialog(dialogIds, selectedId, direction):
    IF dialogIds is empty THEN RETURN null

    IF selectedId is null:
        RETURN dialogIds[0]

    currentIndex = dialogIds.indexOf(selectedId)

    IF currentIndex == -1:
        RETURN dialogIds[0]

    IF direction == 'next':
        nextIndex = MIN(currentIndex + 1, dialogIds.length - 1)
    ELSE:
        nextIndex = MAX(currentIndex - 1, 0)

    RETURN dialogIds[nextIndex]
END FUNCTION
```

**Key properties:**
- No wrapping: navigation clamps at boundaries.
- Null/missing selection defaults to first dialog.
- Unknown selection ID (e.g., stale reference) resets to first dialog.

## Algorithm 4: Quick Reply Dispatch

**File:** `app/(workspace)/page.tsx` (inline in shortcut action callback)

```
FUNCTION onQuickReply(index):
    IF index < 0 OR index >= QUICK_REPLY_TEMPLATES.length:
        RETURN  // out of bounds, no-op

    template = QUICK_REPLY_TEMPLATES[index]
    CALL sendMessage(template.content)
END FUNCTION
```

## Algorithm 5: Help Overlay Escape Handling

**File:** `app/(workspace)/components/ShortcutHelp.tsx`

```
FUNCTION useEffect (when overlay is open):
    handler = (event) =>
        IF event.key == 'Escape':
            event.stopPropagation()   // prevent global handler from also firing
            CALL onClose()

    document.addEventListener('keydown', handler, CAPTURE_PHASE = true)

    ON CLEANUP:
        document.removeEventListener('keydown', handler, CAPTURE_PHASE = true)
END FUNCTION
```

**Key property:** Using capture phase (`true` as third argument) ensures this handler fires BEFORE the global handler in `useKeyboardShortcuts`, preventing the Escape from also triggering dialog deselection.
