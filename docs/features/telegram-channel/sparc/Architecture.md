# FR-05: Telegram Channel -- Architecture

## System Context

Telegram integration sits at the boundary between BC-04 (Integration) and BC-01 (Conversation).
The integration layer handles Telegram-specific protocol (Bot API, webhook format, update parsing),
while conversation domain entities (Dialog, Message) remain channel-agnostic.

```
Telegram Servers
      |
      | POST /api/webhooks/telegram?tenantId=xxx
      v
+---------------------+
| telegram-routes.ts  |  (BC-04 Infrastructure)
| Webhook Router      |
+---------------------+
      |
      v
+---------------------+
| telegram-adapter.ts |  (BC-04 Adapter)
| TelegramAdapter     |
+---------------------+
      |
      | Uses BC-01 repositories (cross-BC dependency via shared ports)
      v
+---------------------+    +---------------------+
| DialogRepository    |    | MessageRepository   |  (BC-01 Infrastructure)
+---------------------+    +---------------------+
      |
      v
+---------------------+
| Socket.io /chat     |  Real-time broadcast to operators
+---------------------+
```

## Component Diagram

### Inbound Flow (Telegram -> KommuniQ)

1. **telegram-routes.ts** -- Express router, mounts `POST /api/webhooks/telegram`
   - Mounted BEFORE auth middleware in server.ts (Telegram sends updates directly)
   - Extracts tenantId from query parameter or env fallback
   - Instantiates TelegramAdapter per request
   - Always returns HTTP 200 to prevent Telegram retry storms

2. **telegram-adapter.ts** -- Core adapter class `TelegramAdapter`
   - Parses TelegramUpdate objects (text messages + callback queries)
   - Finds existing dialog by externalChannelId (Telegram chat ID) or creates new one
   - Persists message via MessageRepository
   - Broadcasts `dialog:created` and `message:new` via Socket.io /chat namespace

3. **telegram-bot-service.ts** -- Thin HTTP client `TelegramBotService`
   - Wraps Telegram Bot API (sendMessage, setWebhook, getMe)
   - Uses native fetch (Node 20+)
   - Bot token from TELEGRAM_BOT_TOKEN environment variable
   - Static factory `fromEnv()` returns null if token not configured

### Outbound Flow (KommuniQ -> Telegram)

1. **telegram-outbound.ts** -- Socket.io middleware + standalone function
   - `registerTelegramOutbound()`: Socket.io middleware on /chat namespace
     - Intercepts `operator:message:telegram` events
     - Looks up dialog, verifies channelType=TELEGRAM
     - Forwards message via TelegramBotService.sendMessage()
   - `forwardToTelegramIfNeeded()`: Standalone function for REST flows
     - Called from chat-routes.ts when operator sends message via REST API
     - Same logic: lookup dialog, check channel type, forward if TELEGRAM

### Management Routes

- **POST /api/telegram/setup** -- Registers webhook URL with Telegram Bot API
  - Appends tenantId to webhook URL automatically
  - Requires JWT authentication
- **GET /api/telegram/status** -- Returns bot connection info via getMe()

## Cross-BC Dependencies

| From | To | Dependency | Justification |
|------|----|-----------|---------------|
| BC-04 telegram-adapter.ts | BC-01 DialogRepository | Direct import | Adapter needs to find/create dialogs |
| BC-04 telegram-adapter.ts | BC-01 MessageRepository | Direct import | Adapter needs to persist messages |
| BC-01 chat-routes.ts | BC-04 telegram-outbound.ts | Direct import | REST reply flow needs Telegram forwarding |

**Note:** These cross-BC imports are pragmatic for v1. The adapter acts as an Anti-Corruption Layer
(ACL) that translates Telegram-specific types into domain entities. Future versions could use
domain events (MessageReceived) via Redis Streams to fully decouple the BCs.

## Server Wiring (server.ts)

```typescript
// Webhook route -- BEFORE auth middleware
app.use('/api/webhooks/telegram', createTelegramWebhookRouter(pool, io))

// Management routes -- AFTER auth middleware
app.use('/api/telegram', createTelegramManagementRouter())

// Outbound handler -- Socket.io middleware
registerTelegramOutbound(io, pool)
```

## Multi-Tenant Design

Each tenant connects their own Telegram bot:
1. Admin calls POST /api/telegram/setup with their webhook URL
2. The system appends `?tenantId={tenantId}` to the URL
3. When Telegram sends updates, the webhook URL carries the tenantId
4. TelegramAdapter is instantiated per-request with the correct tenantId
5. All dialogs and messages are scoped to that tenant

Fallback: `TELEGRAM_DEFAULT_TENANT_ID` env var for single-tenant deployments.

## Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP client | Native fetch | Node 20 built-in, no extra dependency |
| Webhook (not polling) | POST endpoint | Lower latency, Telegram recommended approach |
| Message format | HTML parse_mode | Supports basic formatting (<b>, <i>) without Markdown escaping |
| Multi-tenant ID | URL query param | Simple, no shared secret needed per tenant |
