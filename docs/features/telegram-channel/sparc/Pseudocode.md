# FR-05: Telegram Channel -- Pseudocode

## Algorithm 1: Inbound Webhook Processing

```
FUNCTION handleWebhook(request):
    update = parseBody(request) as TelegramUpdate

    // Validate update
    IF update is null OR update.update_id is missing:
        RETURN HTTP 400 "Invalid Telegram update"

    // Resolve bot service
    botService = TelegramBotService.fromEnv()
    IF botService is null:
        RETURN HTTP 500 "Bot not configured"

    // Resolve tenant
    tenantId = request.query.tenantId OR env.TELEGRAM_DEFAULT_TENANT_ID
    IF tenantId is null:
        RETURN HTTP 400 "Missing tenantId"

    // Process update
    adapter = new TelegramAdapter(pool, io, botService, tenantId)
    TRY:
        handled = adapter.handleUpdate(update)
        RETURN HTTP 200 { ok: true, handled }
    CATCH error:
        log(error)
        // Always return 200 to prevent Telegram retry storms
        RETURN HTTP 200 { ok: true, error: "internal" }
```

## Algorithm 2: Telegram Update Routing

```
FUNCTION handleUpdate(update: TelegramUpdate) -> boolean:
    // Route 1: Text message
    IF update.message exists AND update.message.text exists:
        CALL handleIncomingMessage(update.message)
        RETURN true

    // Route 2: Callback query (inline button press)
    IF update.callback_query exists AND update.callback_query.data exists:
        syntheticMessage = {
            message_id: 0,
            from: update.callback_query.from,
            chat: update.callback_query.message.chat
                  OR { id: update.callback_query.from.id, type: "private" },
            date: now(),
            text: update.callback_query.data
        }
        CALL handleIncomingMessage(syntheticMessage)
        RETURN true

    // Route 3: Non-text (photos, stickers, etc.) -- skip
    RETURN false
```

## Algorithm 3: Incoming Message Processing

```
FUNCTION handleIncomingMessage(tgMessage: TelegramMessage):
    chatId = String(tgMessage.chat.id)
    text = tgMessage.text OR ""
    senderName = join([tgMessage.from.first_name, tgMessage.from.last_name])
    senderUsername = tgMessage.from.username OR null

    // Step 1: Find or create dialog
    dialog = dialogRepo.findByExternalId(tenantId, chatId)
    isNewDialog = false

    IF dialog is null:
        dialog = dialogRepo.create({
            tenantId: tenantId,
            channelType: "TELEGRAM",
            externalChannelId: chatId,
            metadata: {
                telegramChatId: chatId,
                senderName: senderName,
                senderUsername: senderUsername
            }
        })
        isNewDialog = true

    // Step 2: Persist message
    message = messageRepo.create({
        dialogId: dialog.id,
        tenantId: tenantId,
        direction: "INBOUND",
        senderType: "CLIENT",
        content: text
    })

    // Step 3: Broadcast to operators via Socket.io
    chatNamespace = io.of("/chat")

    IF isNewDialog:
        chatNamespace.to("tenant:{tenantId}").emit("dialog:created", { dialog })

    chatNamespace.to("tenant:{tenantId}").emit("message:new", { message, dialog })
```

## Algorithm 4: Outbound Reply (Operator -> Telegram)

```
FUNCTION handleOperatorReply(dialogId, content):
    // Socket.io middleware path
    dialog = dialogRepo.findById(dialogId)
    IF dialog is null OR dialog.channelType != "TELEGRAM":
        RETURN  // Not a Telegram dialog, skip

    botService = TelegramBotService.fromEnv()
    IF botService is null:
        log("TELEGRAM_BOT_TOKEN not configured")
        RETURN

    TRY:
        result = botService.sendMessage(dialog.externalChannelId, content)
        IF NOT result.ok:
            log("Telegram API error:", result.description)
    CATCH error:
        log("Failed to forward message:", error)
        // Do not throw -- operator message was already persisted
```

## Algorithm 5: Bot API Calls

```
CLASS TelegramBotService:
    apiBase = "https://api.telegram.org/bot{botToken}"

    FUNCTION sendMessage(chatId, text) -> TelegramSendResult:
        response = POST "{apiBase}/sendMessage" {
            chat_id: chatId,
            text: text,
            parse_mode: "HTML"
        }
        RETURN response.json()

    FUNCTION setWebhook(url) -> TelegramWebhookResult:
        response = POST "{apiBase}/setWebhook" {
            url: url
        }
        RETURN response.json()

    FUNCTION getMe() -> TelegramBotInfo:
        response = GET "{apiBase}/getMe"
        RETURN response.json()

    STATIC FUNCTION fromEnv() -> TelegramBotService | null:
        token = env.TELEGRAM_BOT_TOKEN
        IF token is null:
            RETURN null
        RETURN new TelegramBotService(token)
```

## Algorithm 6: Webhook Setup (Admin)

```
FUNCTION setupWebhook(request):
    webhookUrl = request.body.webhookUrl
    IF webhookUrl is missing:
        RETURN HTTP 400 "webhookUrl is required"

    botService = TelegramBotService.fromEnv()
    IF botService is null:
        RETURN HTTP 500 "Bot token not configured"

    // Append tenantId so webhook knows which tenant owns this bot
    url = new URL(webhookUrl)
    url.searchParams.set("tenantId", request.tenantId)

    result = botService.setWebhook(url.toString())
    RETURN { ok: result.ok, description: result.description }
```
