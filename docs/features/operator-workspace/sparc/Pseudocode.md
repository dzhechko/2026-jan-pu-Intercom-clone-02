# Pseudocode: FR-07 Operator Workspace
**Feature ID:** FR-07
**Status:** Implemented
**Date:** 2026-03-04

---

## Algorithm 1: Dialog List — Sort and Update

### sortDialogs(dialogs: Dialog[]): Dialog[]

```
FUNCTION sortDialogs(dialogs):
  tierOrder = { HOT: 0, WARM: 1, COLD: 2, undefined: 3 }

  RETURN dialogs.sorted((a, b) =>
    tierA = tierOrder[a.pqlTier] ?? 3
    tierB = tierOrder[b.pqlTier] ?? 3

    IF tierA != tierB:
      RETURN tierA - tierB   // HOT floats to top

    // Same tier: sort by most recent message descending
    timeA = a.lastMessageAt ?? a.updatedAt ?? a.createdAt
    timeB = b.lastMessageAt ?? b.updatedAt ?? b.createdAt
    RETURN Date(timeB) - Date(timeA)
  )
```

### Real-time Dialog Update on message:new Event

```
ON event 'message:new' (payload: { message, dialog? }):
  IF payload.message is null:
    RETURN

  msg = payload.message

  updatedList = dialogs.map(d =>
    IF d.id == msg.dialogId:
      RETURN {
        ...d,
        lastMessagePreview: msg.content.slice(0, 100),
        lastMessageAt: msg.createdAt,
        unreadCount: d.unreadCount + (msg.direction == 'INBOUND' ? 1 : 0)
      }
    ELSE:
      RETURN d  // unchanged
  )

  // Handle brand new dialog arriving with its first message
  IF payload.dialog AND NOT dialogs.contains(payload.dialog.id):
    newDialog = {
      ...payload.dialog,
      lastMessagePreview: msg.content.slice(0, 100),
      lastMessageAt: msg.createdAt,
      unreadCount: 1
    }
    updatedList = [...updatedList, newDialog]

  setDialogs(sortDialogs(updatedList))
```

### Real-time PQL Tier Update

```
ON event 'pql:detected' (payload: { dialogId, score, tier, topSignals }):
  IF payload.dialogId is null:
    RETURN

  updatedList = dialogs.map(d =>
    IF d.id == payload.dialogId:
      RETURN { ...d, pqlScore: payload.score, pqlTier: payload.tier }
    ELSE:
      RETURN d
  )

  setDialogs(sortDialogs(updatedList))
  // Dialog now floats up if tier improved to HOT
```

---

## Algorithm 2: Dialog Selection Flow

```
FUNCTION handleSelectDialog(dialogId):
  setSelectedDialogId(dialogId)
  clearUnread(dialogId)          // set unreadCount=0 in dialog list
  // Triggers useMessages re-fetch via useEffect dependency on dialogId
  // Triggers useMemoryAI re-fetch via useEffect dependency on dialogId

FUNCTION clearUnread(dialogId):
  setDialogs(prev =>
    prev.map(d => d.id == dialogId ? { ...d, unreadCount: 0 } : d)
  )
```

---

## Algorithm 3: Message Send Flow

```
FUNCTION handleSubmit(event):
  event.preventDefault()

  IF input.trim() == '' OR sending:
    RETURN

  content = input.trim()
  setInput('')
  setSending(true)
  emitTyping(false)        // stop typing indicator immediately

  TRY:
    response = await POST /dialogs/{dialogId}/messages
      body: { content, senderType: 'OPERATOR' }
      headers: { Authorization: Bearer token }

    IF response.ok:
      emit('operator:message', { dialogId, tenantId, content })

      IF response.data.message:
        setMessages(prev =>
          prev.contains(response.data.message.id)
            ? prev                                  // deduplicate
            : [...prev, response.data.message]
        )
    ELSE:
      THROW Error('Send failed: ' + response.status)

  CATCH error:
    setInput(content)      // restore on failure (user can retry)
    log('[ChatArea] send error:', error)

  FINALLY:
    setSending(false)

// FR-14: Keyboard shortcut path
// ChatArea exposes sendMessageRef.current = () => trigger send via DOM
FUNCTION sendViaRef():
  inputEl = document.querySelector('[data-testid="message-input"]')
  value = inputEl?.value?.trim()
  IF value AND NOT sending:
    trigger handleSubmit equivalent
```

---

## Algorithm 4: Typing Indicator Flow

```
FUNCTION handleInputChange(value):
  setInput(value)
  emitTyping(true)

  // Debounce: stop typing signal after 2 seconds of no input
  IF typingTimeout exists:
    clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => emitTyping(false), 2000)

FUNCTION emitTyping(isTyping):
  IF dialogId AND tenantId:
    socket.emit('typing', { dialogId, tenantId, isTyping, senderType: 'OPERATOR' })

// Client typing received:
ON event 'typing' (payload: { dialogId, isTyping, senderType }):
  IF payload.dialogId == currentDialogId AND payload.senderType == 'CLIENT':
    setTypingIndicator(payload.isTyping)

// Auto-clear: prevent stuck indicator if CLIENT stops sending events
EFFECT: IF typingIndicator == true:
  timeout = setTimeout(() => setTypingIndicator(false), 5000)
```

---

## Algorithm 5: PQL Signal Display

```
FUNCTION fetchPQLSignals(dialogId):
  setLoadingSignals(true)

  TRY:
    response = await GET /pql/detections/{dialogId}
    detections = response.detections

    // Aggregate signals across all detections for this dialog
    signalMap = new Map()
    FOR EACH detection IN detections:
      FOR EACH signal IN detection.signals:
        existing = signalMap.get(signal.type)
        IF NOT existing OR signal.weight > existing.weight:
          signalMap.set(signal.type, signal)   // keep highest weight per type

    // Sort descending by weight, display top 5
    allSignals = Array.from(signalMap.values())
    sortedSignals = allSignals.sort((a, b) => b.weight - a.weight)
    setPqlSignals(sortedSignals)

  CATCH:
    setPqlSignals([])   // graceful degradation

  FINALLY:
    setLoadingSignals(false)

// Trigger: dialog.id or dialog.pqlScore changes (pqlScore change = new detection available)
```

---

## Algorithm 6: Memory AI State Machine

```
States: idle | loading | ok | not_configured | no_email | error

FUNCTION fetchContext(dialogId, contactEmail):
  IF NOT dialogId OR NOT token:
    setState({ status: 'idle', data: null })
    RETURN

  IF NOT contactEmail:
    setState({ status: 'no_email', data: null })
    RETURN

  cacheKey = "{dialogId}:{contactEmail}"
  cached = cache.get(cacheKey)
  IF cached:
    setState({ status: 'ok', data: cached })
    RETURN

  setState({ status: 'loading', data: null })

  TRY:
    response = await GET /memory/{dialogId}
    json = response.json()

    SWITCH json.status:
      CASE 'not_configured':
        setState({ status: 'not_configured', data: null })

      CASE 'error':
        setState({ status: 'error', data: null, error: json.error })

      DEFAULT:
        data = json.data
        cache.set(cacheKey, data)
        setState({ status: 'ok', data })

  CATCH error:
    setState({ status: 'error', data: null, error: error.message })

FUNCTION refresh():
  cache.delete("{dialogId}:{contactEmail}")
  fetchContext(dialogId, contactEmail)
```

---

## Algorithm 7: Keyboard Shortcut Dispatch

```
FUNCTION handleKeyDown(event):
  IF NOT enabled:
    RETURN

  ctrl = event.ctrlKey OR event.metaKey
  typing = isTypingInInput()

  // Always-active shortcuts (work even in input fields)
  IF ctrl AND event.key == 'Enter':
    event.preventDefault()
    actions.onSendMessage?.()
    RETURN

  IF ctrl AND event.key == 'k':
    event.preventDefault()
    actions.onFocusSearch?.()
    RETURN

  // Guard remaining shortcuts when operator is typing
  IF typing:
    RETURN

  // Navigation
  IF alt AND event.key == 'ArrowUp':
    actions.onPreviousDialog?.()
    RETURN

  IF alt AND event.key == 'ArrowDown':
    actions.onNextDialog?.()
    RETURN

  IF alt AND event.key IN ['n', 'N']:
    actions.onNextUnassigned?.()
    RETURN

  // Dialog actions
  IF alt AND event.key IN ['a', 'A']:
    actions.onAssignDialog?.()
    RETURN

  IF alt AND event.key IN ['c', 'C']:
    actions.onCloseDialog?.()
    RETURN

  // Quick replies Alt+1..5
  IF alt AND event.key IN ['1'..'9']:
    index = parseInt(event.key) - 1
    actions.onQuickReply?.(index)
    RETURN

  // Escape — deselect or close modal
  IF event.key == 'Escape':
    actions.onEscape?.()
    RETURN

  // ? — toggle help
  IF event.key == '?' AND NOT alt AND NOT ctrl:
    actions.onToggleHelp?.()
    RETURN

FUNCTION isTypingInInput():
  el = document.activeElement
  IF el.tagName IN ['INPUT', 'TEXTAREA', 'SELECT']:
    RETURN true
  IF el.isContentEditable:
    RETURN true
  RETURN false
```

---

## Algorithm 8: Dialog Navigation (Keyboard)

```
FUNCTION navigateDialog(direction: 'prev' | 'next'):
  IF dialogs.length == 0:
    RETURN

  IF selectedDialogId is null:
    handleSelectDialog(dialogs[0].id)
    RETURN

  currentIdx = dialogs.indexOf(selectedDialogId)
  IF currentIdx == -1:
    handleSelectDialog(dialogs[0].id)
    RETURN

  IF direction == 'next':
    nextIdx = min(currentIdx + 1, dialogs.length - 1)
  ELSE:
    nextIdx = max(currentIdx - 1, 0)

  handleSelectDialog(dialogs[nextIdx].id)

FUNCTION jumpToNextUnassigned():
  unassigned = dialogs.find(d =>
    d.status == 'OPEN' AND
    d.assignedOperatorId is null AND
    d.id != selectedDialogId
  )
  IF unassigned:
    handleSelectDialog(unassigned.id)
```

---

## Algorithm 9: Notification Bell

```
FUNCTION fetchNotifications():
  response = await GET /api/notifications?limit=20
  setNotifications(response.notifications)

FUNCTION fetchUnreadCount():
  response = await GET /api/notifications/unread-count
  setUnreadCount(response.count)

ON event 'notification:pql' (payload):
  newNotification = {
    id: 'rt-' + Date.now(),
    type: 'pql_detected',
    dialogId: payload.dialogId,
    title: (payload.tier == 'HOT' ? 'Hot' : 'Warm') + ' PQL Lead Detected',
    body: 'Score: ' + (payload.score * 100).toFixed(0) + '% — ' + topSignals.join(', '),
    metadata: { score, tier, topSignals, contactEmail },
    read: false,
    createdAt: payload.timestamp
  }
  setNotifications(prev => [newNotification, ...prev].slice(0, 50))
  setUnreadCount(prev => prev + 1)

FUNCTION handleNotificationClick(notification):
  IF NOT notification.read:
    PATCH /api/notifications/{notification.id}/read
    setNotifications(prev => prev.map(n => n.id == id ? { ...n, read: true } : n))
    setUnreadCount(prev => max(0, prev - 1))

  handleSelectDialog(notification.dialogId)
  setOpen(false)
```
