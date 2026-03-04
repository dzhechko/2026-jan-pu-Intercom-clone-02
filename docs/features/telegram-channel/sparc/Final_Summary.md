# FR-05: Telegram Channel -- Final Summary

## Implementation Status: COMPLETE (v1)

FR-05 Telegram Channel has been fully implemented as part of the Wave 3 milestone.
All acceptance criteria are met. The feature integrates Telegram as a first-class
messaging channel in KommuniQ, with bidirectional message flow and multi-tenant support.

## Files Implemented

| File | BC | Purpose | Lines |
|------|----|---------|-------|
| `src/integration/adapters/telegram-adapter.ts` | BC-04 | Inbound adapter: parses TelegramUpdate, creates dialogs, persists messages, broadcasts via Socket.io | 162 |
| `src/integration/services/telegram-bot-service.ts` | BC-04 | Thin HTTP client for Telegram Bot API (sendMessage, setWebhook, getMe) | 90 |
| `src/integration/infrastructure/telegram-routes.ts` | BC-04 | Webhook router (no auth) + management router (auth required) | 128 |
| `src/integration/adapters/telegram-outbound.ts` | BC-04 | Outbound handler: forwards operator replies to Telegram via Socket.io middleware + REST function | 75 |
| `src/integration/adapters/telegram-adapter.test.ts` | BC-04 | 14 unit tests covering inbound, outbound, bot service, and edge cases | 392 |

## Architecture Summary

```
Telegram -> POST /api/webhooks/telegram?tenantId=xxx
         -> TelegramAdapter.handleUpdate()
         -> DialogRepository.findByExternalId() / .create()
         -> MessageRepository.create()
         -> Socket.io emit("dialog:created") + emit("message:new")
         -> PQL pipeline processes message (same as web chat)

Operator -> Socket.io "operator:message:telegram" OR REST POST /api/dialogs/:id/messages
         -> telegram-outbound.ts
         -> TelegramBotService.sendMessage()
         -> Telegram Bot API -> User
```

## Key Design Decisions

1. **Webhook over polling** -- lower latency, Telegram-recommended approach
2. **Always HTTP 200** -- prevents Telegram retry storms on internal errors
3. **Multi-tenant via query param** -- simple, no per-tenant secret management needed in v1
4. **Dialog reuse by externalChannelId** -- one Dialog per Telegram chat, preventing duplicates
5. **Callback query as synthetic text** -- inline button presses flow through the same pipeline
6. **Native fetch** -- no additional HTTP client dependency (Node 20 built-in)
7. **HTML parse_mode** -- basic formatting support without Markdown escaping issues

## Test Coverage

14 tests across two test suites:

**TelegramAdapter (9 tests):**
- Parse text message and create inbound message
- Create new TELEGRAM dialog when none exists
- Broadcast dialog:created for new dialogs
- Broadcast message:new to operators
- Extract sender name from first_name + last_name
- Handle callback_query as text message
- Return false for updates without text or callback
- Return false for photo-only messages
- Send reply via bot service + throw on API error

**TelegramBotService (5 tests):**
- POST to sendMessage endpoint with correct payload
- POST to setWebhook endpoint
- GET getMe endpoint
- Return null from fromEnv() when token not set
- Create service from fromEnv() when token is set

## Domain Events

TELEGRAM is a first-class value in the ChannelType union:
```typescript
type ChannelType = 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
```

Domain events (DialogStarted, MessageReceived) include channelType field,
so downstream consumers (PQL detector, Revenue attribution) process Telegram
messages identically to web chat messages.

## Known Limitations (v1)

| Limitation | Impact | Planned Fix |
|-----------|--------|-------------|
| No HMAC webhook verification | Fake updates possible if URL discovered | v2: secret_token header validation |
| No circuit breaker on Bot API | No backoff on Telegram outages | v2: opossum wrapper |
| Single bot token per deployment | All tenants share one bot | v2: per-tenant encrypted tokens |
| Text-only messages | Photos/stickers/voice ignored | v2: media support |
| No rate limiting on webhook | Potential abuse vector | v2: IP-based rate limiting |

## Integration Points

- **PQL Detection:** Telegram messages trigger PQL analysis via the same `analyzePQLInline()` pipeline
- **Revenue Attribution:** Telegram dialogs with PQL detections flow into revenue reports
- **Notifications:** PQL Pulse notifications fire for Telegram-originated PQL detections
- **Operator Workspace:** Telegram dialogs appear in unified inbox with TELEGRAM channel badge
