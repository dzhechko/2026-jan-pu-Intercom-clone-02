# FR-09: VK Max / Messenger Max MCP -- Pseudocode

## Algorithm 1: Inbound Webhook Processing

```
FUNCTION handleVKMaxWebhook(request, response):
    update = parseBody(request)

    IF update.type IS MISSING:
        RETURN response.status(400).json({ error: 'Invalid VK Max update' })

    // VK Max confirmation callback
    IF update.type == 'confirmation':
        token = env.VKMAX_CONFIRMATION_TOKEN OR 'ok'
        RETURN response.send(token)

    mcpService = VKMaxMCPService.fromEnv()
    IF mcpService IS NULL:
        RETURN response.status(500).json({ error: 'VK Max MCP not configured' })

    tenantId = request.query.tenantId OR env.VKMAX_DEFAULT_TENANT_ID
    IF tenantId IS MISSING:
        RETURN response.status(400).json({ error: 'Missing tenantId' })

    TRY:
        adapter = new VKMaxAdapter(pool, io, mcpService, tenantId)
        adapter.handleUpdate(update)
    CATCH error:
        log.error('[vkmax-routes] webhook error', error)
    FINALLY:
        // Always return 'ok' to prevent VK Max retries
        RETURN response.send('ok')
```

## Algorithm 2: Message Processing (VKMaxAdapter.handleUpdate)

```
FUNCTION handleUpdate(update: VKMaxUpdate) -> boolean:
    IF update.type == 'message_new' AND update.object.message.text IS NOT EMPTY:
        CALL handleIncomingMessage(update.object.message, update.group_id)
        RETURN true
    ELSE:
        RETURN false  // Skip non-text and unknown events

FUNCTION handleIncomingMessage(vkMessage, groupId):
    peerId = String(vkMessage.peer_id)
    text = vkMessage.text
    fromId = String(vkMessage.from_id)

    // Step 1: Find or create dialog
    dialog = dialogRepo.findByExternalId(tenantId, peerId)
    isNewDialog = false

    IF dialog IS NULL:
        dialog = dialogRepo.create({
            tenantId: tenantId,
            channelType: 'VK_MAX',
            externalChannelId: peerId,
            metadata: {
                vkMaxPeerId: peerId,
                vkMaxFromId: fromId,
                vkMaxGroupId: String(groupId),
            },
        })
        isNewDialog = true

    // Step 2: Persist message
    message = messageRepo.create({
        dialogId: dialog.id,
        tenantId: tenantId,
        direction: 'INBOUND',
        senderType: 'CLIENT',
        content: text,
    })

    // Step 3: Broadcast via Socket.io
    chatNsp = io.of('/chat')

    IF isNewDialog:
        chatNsp.to('tenant:' + tenantId).emit('dialog:created', { dialog })

    chatNsp.to('tenant:' + tenantId).emit('message:new', { message, dialog })
```

## Algorithm 3: Outbound Message Forwarding

```
FUNCTION sendReply(peerId, text):
    result = mcpService.sendMessage(peerId, text)  // Goes through circuit breaker

    IF result.ok IS false:
        log.error('Failed to send message to VK Max:', result.description)
        THROW Error('VK Max MCP error: ' + result.description)

FUNCTION forwardToVKMaxIfNeeded(pool, dialogId, content):
    dialog = dialogRepo.findById(dialogId)

    IF dialog IS NULL OR dialog.channelType != 'VK_MAX':
        RETURN  // Not a VK Max dialog, nothing to do

    mcpService = VKMaxMCPService.fromEnv()
    IF mcpService IS NULL:
        log.error('VKMAX_MCP_URL or VKMAX_ACCESS_TOKEN not configured')
        RETURN

    result = mcpService.sendMessage(dialog.externalChannelId, content)
    IF result.ok IS false:
        log.error('VK Max MCP error:', result.description)
```

## Algorithm 4: MCP Service with Circuit Breaker

```
CLASS VKMaxMCPService:
    CONSTRUCTOR(mcpUrl, accessToken):
        sendBreaker = new CircuitBreaker(_sendMessage, {
            timeout: 5000,
            errorThresholdPercentage: 50,
            resetTimeout: 30000,
        })

        sendBreaker.on('open',     -> log.warn('Circuit OPEN'))
        sendBreaker.on('halfOpen', -> log.info('Circuit HALF-OPEN'))
        sendBreaker.on('close',    -> log.info('Circuit CLOSED'))

    STATIC fromEnv() -> VKMaxMCPService | null:
        mcpUrl = env.VKMAX_MCP_URL
        accessToken = env.VKMAX_ACCESS_TOKEN
        IF mcpUrl IS MISSING OR accessToken IS MISSING:
            RETURN null
        RETURN new VKMaxMCPService(mcpUrl, accessToken)

    FUNCTION sendMessage(peerId, text) -> VKMaxSendResult:
        RETURN sendBreaker.fire(peerId, text)  // Delegates to _sendMessage via CB

    PRIVATE FUNCTION _sendMessage(peerId, text) -> VKMaxSendResult:
        IF mcpUrl IS EMPTY:
            // Mock mode
            log.info('MOCK sendMessage to peer ' + peerId)
            RETURN { ok: true, messageId: Date.now() }

        response = HTTP POST mcpUrl + '/messages.send'
            headers: { Authorization: 'Bearer ' + accessToken }
            body: { peer_id: peerId, message: text, random_id: Date.now() }

        RETURN response.json()
```

## Algorithm 5: Webhook Setup

```
FUNCTION setupWebhook(request, response):
    tenantId = request.tenantId  // From JWT middleware
    webhookUrl = request.body.webhookUrl

    IF webhookUrl IS MISSING:
        RETURN response.status(400).json({ error: 'webhookUrl is required' })

    mcpService = VKMaxMCPService.fromEnv()
    IF mcpService IS NULL:
        RETURN response.status(500).json({ error: 'MCP not configured' })

    // Append tenantId to webhook URL for multi-tenant routing
    url = new URL(webhookUrl)
    url.searchParams.set('tenantId', tenantId)

    result = mcpService.setWebhook(url.toString())
    RETURN response.json({ ok: result.ok, description: result.description })
```
