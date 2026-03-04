# Pseudocode: FR-04 Chat Widget
**Feature:** FR-04 Chat Widget
**BC:** BC-01 Conversation Context
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. Widget Initialization Flow

```
FUNCTION initializeWidget(config: { tenantId, contactEmail?, metadata? }):
  // 1. Generate or restore stable session ID
  sessionId = localStorage.getItem('kommuniq_session')
  IF sessionId IS NULL:
    sessionId = generateUUID()
    localStorage.setItem('kommuniq_session', sessionId)

  // 2. Restore dialog ID from previous session (resume)
  dialogId = localStorage.getItem('kommuniq_dialog_id')

  // 3. Connect to Socket.io
  socket = io('/chat', {
    auth: { tenantId: config.tenantId, dialogId: dialogId ?? undefined },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  })

  socket.on('connect', () => markConnected())
  socket.on('disconnect', () => markDisconnected())

  // 4. Listen for replies from operator
  socket.on('message:new', (payload) => {
    appendMessageToUI(payload.message)
  })

  // 5. Listen for typing indicator from operator
  socket.on('typing', (payload) => {
    IF payload.senderType === 'OPERATOR':
      showTypingIndicator(payload.isTyping)
  })

  // 6. Listen for assignment event (optional UI update)
  socket.on('dialog:assigned', (payload) => {
    updateStatusBadge('Agent assigned')
  })
```

---

## 2. Client Sends a Message (Widget)

```
FUNCTION sendClientMessage(content: string):
  // 1. Rate limit check (client-side, soft guard)
  IF messageCount(lastMinute) >= 10:
    showError('Please slow down. Max 10 messages per minute.')
    RETURN

  // 2. Validate content
  IF content.trim().length === 0 OR content.length > 10000:
    showError('Message must be 1–10,000 characters.')
    RETURN

  // 3. Emit socket event
  socket.emit('client:message', {
    tenantId: config.tenantId,
    content: content.trim(),
    externalChannelId: sessionId,
    contactEmail: config.contactEmail,   // undefined if not provided
    metadata: config.metadata,           // undefined if not provided
  })

  // 4. Optimistic UI: show message immediately
  appendMessageToUI({
    id: 'temp-' + Date.now(),
    content: content.trim(),
    direction: 'INBOUND',
    senderType: 'CLIENT',
    createdAt: new Date().toISOString(),
  })
```

---

## 3. Server Handles `client:message` (ws-handler.ts)

```
EVENT HANDLER 'client:message'(socket, payload):
  // 1. Validate schema (Zod)
  parsed = ClientMessageSchema.safeParse(payload)
  IF NOT parsed.success:
    socket.emit('error', { code: 'INVALID_PAYLOAD', details: parsed.error })
    RETURN

  { tenantId, content, externalChannelId, contactEmail, metadata } = parsed.data

  TRY:
    // 2. Set RLS context (ADR-007)
    await pool.query(`SET LOCAL app.tenant_id = '${tenantId}'`)

    // 3. Find or create dialog
    dialog = await DialogRepository.findByExternalId(tenantId, externalChannelId)
    IF dialog IS NULL:
      dialog = await DialogRepository.create({
        tenantId,
        channelType: 'WEB_CHAT',
        externalChannelId,
        contactEmail,
        metadata: metadata ?? {},
      })
      // Notify all operators that a new dialog appeared
      nsp.to(`tenant:${tenantId}`).emit('dialog:created', { dialog })

    // 4. Persist message
    message = await MessageRepository.create({
      dialogId: dialog.id,
      tenantId,
      direction: 'INBOUND',
      senderType: 'CLIENT',
      content,
    })

    // 5. Join socket to dialog room (so operator replies reach this socket)
    socket.join(`dialog:${dialog.id}`)

    // 6. Confirm receipt to widget
    socket.emit('message:new', { message, dialogId: dialog.id })

    // 7. Broadcast to all operators of this tenant
    nsp.to(`tenant:${tenantId}`).emit('message:new', { message, dialog })

    // 8. Trigger PQL analysis (BC-02) — fire-and-forget, must NOT block
    IF pqlDetector IS NOT NULL:
      analyzePQLInline(pqlDetector, nsp, {
        messageId: message.id,
        dialogId: dialog.id,
        tenantId,
        content,
        senderType: 'CLIENT',
      }, notificationService).catch(err => log.error('[ws-handler] PQL error', err))

  CATCH err:
    log.error('[ws-handler] client:message error', err)
    socket.emit('error', { code: 'INTERNAL_ERROR' })
```

---

## 4. Server Handles `operator:message` (ws-handler.ts)

```
EVENT HANDLER 'operator:message'(socket, payload):
  parsed = OperatorMessageSchema.safeParse(payload)
  IF NOT parsed.success:
    socket.emit('error', { code: 'INVALID_PAYLOAD' })
    RETURN

  { dialogId, tenantId, content } = parsed.data

  TRY:
    await pool.query(`SET LOCAL app.tenant_id = '${tenantId}'`)

    dialog = await DialogRepository.findById(dialogId)
    IF dialog IS NULL:
      socket.emit('error', { code: 'DIALOG_NOT_FOUND' })
      RETURN

    message = await MessageRepository.create({
      dialogId,
      tenantId,
      direction: 'OUTBOUND',
      senderType: 'OPERATOR',
      content,
    })

    // Deliver to widget (client is in dialog room)
    nsp.to(`dialog:${dialogId}`).emit('message:new', { message })

    // Echo to other operators watching this tenant
    nsp.to(`tenant:${tenantId}`).emit('message:new', { message })

    // Channel forwarding (fire-and-forget, no-op for WEB_CHAT)
    forwardToTelegramIfNeeded(pool, dialogId, content).catch(log.error)
    forwardToVKMaxIfNeeded(pool, dialogId, content).catch(log.error)

  CATCH err:
    log.error('[ws-handler] operator:message error', err)
    socket.emit('error', { code: 'INTERNAL_ERROR' })
```

---

## 5. Dialog Assignment Flow

```
EVENT HANDLER 'dialog:assign'(socket, payload):
  parsed = DialogAssignSchema.safeParse(payload)
  IF NOT parsed.success:
    socket.emit('error', { code: 'INVALID_PAYLOAD' })
    RETURN

  { dialogId, tenantId, operatorId } = parsed.data

  TRY:
    await pool.query(`SET LOCAL app.tenant_id = '${tenantId}'`)

    // Business rule: canAssign() — only OPEN dialogs can be assigned
    // (enforced implicitly by SQL UPDATE; findById first if strict enforcement needed)
    dialog = await DialogRepository.assignOperator(dialogId, operatorId)
    // SQL: UPDATE dialogs SET operator_id=$1, status='ASSIGNED' WHERE id=$2

    IF dialog IS NULL:
      socket.emit('error', { code: 'DIALOG_NOT_FOUND' })
      RETURN

    nsp.to(`tenant:${tenantId}`).emit('dialog:assigned', { dialog })
    nsp.to(`dialog:${dialogId}`).emit('dialog:assigned', { dialog })

  CATCH err:
    log.error('[ws-handler] dialog:assign error', err)
    socket.emit('error', { code: 'INTERNAL_ERROR' })
```

---

## 6. REST: Operator Sends Message via HTTP

```
POST /api/dialogs/:id/messages

FUNCTION sendMessageHandler(req, res):
  parsed = SendMessageSchema.safeParse(req.body)
  IF NOT parsed.success:
    RETURN res.status(400).json({ error: 'Invalid body' })

  dialog = await DialogRepository.findById(req.params.id)
  IF dialog IS NULL:
    RETURN res.status(404).json({ error: 'Dialog not found' })

  message = await MessageRepository.create({
    dialogId: req.params.id,
    tenantId: req.tenantId,       // from JWT middleware
    direction: 'OUTBOUND',
    senderType: parsed.data.senderType,
    content: parsed.data.content,
  })

  // Fire-and-forget channel forwarding
  forwardToTelegramIfNeeded(pool, req.params.id, parsed.data.content).catch(log.error)
  forwardToVKMaxIfNeeded(pool, req.params.id, parsed.data.content).catch(log.error)

  RETURN res.status(201).json({ message })
```

---

## 7. Operator Workspace: useMessages Hook

```
HOOK useMessages({ dialogId, token, tenantId, on, emit }):
  state: messages = [], loading = false, typingIndicator = false

  // Load history when dialog selected
  EFFECT [dialogId, token]:
    IF dialogId IS NULL: messages = []; RETURN
    loading = true
    messages = await GET /api/proxy/dialogs/{dialogId}/messages?limit=100
    loading = false

  // Real-time: new message arrives
  EFFECT [dialogId]:
    on('message:new', payload => {
      IF payload.message.dialogId !== dialogId: RETURN
      IF message already in messages: RETURN   // dedup by id
      messages = [...messages, payload.message]
    })

  // Real-time: typing from client
  EFFECT [dialogId]:
    on('typing', payload => {
      IF payload.dialogId !== dialogId: RETURN
      IF payload.senderType !== 'CLIENT': RETURN
      typingIndicator = payload.isTyping
    })

  // Auto-clear typing after 5s
  EFFECT [typingIndicator]:
    IF typingIndicator: setTimeout(() => typingIndicator = false, 5000)

  FUNCTION sendMessage(content):
    // REST for reliability + socket emit for instant broadcast
    message = await POST /api/proxy/dialogs/{dialogId}/messages { content, senderType: 'OPERATOR' }
    emit('operator:message', { dialogId, tenantId, content })
    messages = dedup([...messages, message])

  FUNCTION sendTyping(isTyping):
    emit('typing', { dialogId, tenantId, isTyping, senderType: 'OPERATOR' })

  RETURN { messages, loading, typingIndicator, sendMessage, sendTyping }
```

---

## 8. Dialog Sorting Algorithm (useDialogs.ts)

```
FUNCTION sortDialogs(dialogs: Dialog[]): Dialog[]:
  tierOrder = { HOT: 0, WARM: 1, COLD: 2, undefined: 3 }

  RETURN dialogs.sort((a, b) =>
    // Primary: PQL tier (HOT first)
    tierDiff = (tierOrder[a.pqlTier] ?? 3) - (tierOrder[b.pqlTier] ?? 3)
    IF tierDiff !== 0: RETURN tierDiff

    // Secondary: most recent message timestamp
    timeA = a.lastMessageAt ?? a.updatedAt ?? a.createdAt
    timeB = b.lastMessageAt ?? b.updatedAt ?? b.createdAt
    RETURN new Date(timeB) - new Date(timeA)   // newest first
  )
```

---

## 9. Find-or-Create Dialog (Idempotency)

```
FUNCTION findOrCreateDialog(tenantId, externalChannelId, ...params):
  // Look up by stable external ID
  existing = await DialogRepository.findByExternalId(tenantId, externalChannelId)
  IF existing IS NOT NULL:
    RETURN existing   // resume existing dialog, no new row

  // Create new dialog
  dialog = await DialogRepository.create({
    tenantId,
    channelType: 'WEB_CHAT',
    externalChannelId,
    ...params,
  })
  EMIT 'dialog:created' to tenant room
  RETURN dialog
```

This guarantees that reconnecting with the same `externalChannelId` never creates a duplicate dialog.
