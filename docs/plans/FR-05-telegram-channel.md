# FR-05: Telegram Channel
**Status:** Done | **BC:** BC-01 Conversation, BC-04 Integration | **Priority:** SHOULD

## Summary
Integrates Telegram as an inbound/outbound messaging channel. Incoming Telegram messages are received via webhook, persisted as Dialog/Message entities, and broadcast to operators via Socket.io. Operator replies are forwarded back to Telegram users via Bot API.

## User Stories
- US-01: As a Client, I want to contact support via Telegram so that I can use my preferred messenger.
- US-02: As an Operator, I want to see Telegram messages in the same workspace as other channels so that I have a unified inbox.
- US-03: As an Operator, I want my replies to be delivered back to the Telegram user so that the conversation flows naturally.
- US-04: As an Admin, I want to configure the Telegram bot webhook so that my tenant receives messages from our bot.

## Technical Design

### Files Created
- `src/integration/adapters/telegram-adapter.ts` — Inbound adapter: parses TelegramUpdate objects (text messages + callback queries), finds/creates TELEGRAM dialogs, persists messages, broadcasts via Socket.io `/chat` namespace.
- `src/integration/services/telegram-bot-service.ts` — Thin HTTP client for Telegram Bot API (sendMessage, setWebhook, getMe). Uses native fetch, bot token from env.
- `src/integration/infrastructure/telegram-routes.ts` — Two routers: (1) webhook router (no auth, POST `/api/webhooks/telegram`) and (2) management router (auth required, POST `/api/telegram/setup`, GET `/api/telegram/status`).
- `src/integration/adapters/telegram-outbound.ts` — Outbound handler: registers Socket.io middleware on `/chat` namespace to intercept `operator:message:telegram` events and forward to Telegram. Also provides standalone `forwardToTelegramIfNeeded()` for REST flows.
- `src/integration/adapters/telegram-adapter.test.ts` — 14 tests covering inbound parsing, dialog creation, Socket.io broadcast, callback queries, non-text skipping, outbound sending, Bot API service methods, env-based instantiation.

### Key Decisions
- **Webhook-based (not polling):** Telegram sends POST requests to our endpoint. Always responds 200 (even on errors) to prevent Telegram retry storms.
- **Multi-tenant via query param:** Webhook URL includes `?tenantId=xxx` so the adapter knows which tenant the message belongs to. Fallback to `TELEGRAM_DEFAULT_TENANT_ID` env var.
- **Dialog reuse by externalChannelId:** Each Telegram chat ID maps to one Dialog. `findByExternalId()` prevents duplicate dialogs for the same chat.
- **Callback query support:** Button presses (`callback_query`) are converted to synthetic text messages so they flow through the same pipeline.
- **Non-text messages skipped:** Photos, stickers, and other media types return `false` from handleUpdate (v1 scope limitation).
- **HTML parse_mode:** Outbound messages use `parse_mode: HTML` for basic formatting in Telegram.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/telegram` | Webhook endpoint called by Telegram (no auth) |
| POST | `/api/telegram/setup` | Register webhook URL with Telegram Bot API (auth required) |
| GET | `/api/telegram/status` | Check bot connection and info (auth required) |

## Socket.io Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `dialog:created` | Server -> Client | `{ dialog }` — emitted when a new Telegram chat starts |
| `message:new` | Server -> Client | `{ message, dialog }` — every inbound Telegram message |
| `operator:message:telegram` | Client -> Server | `{ dialogId, content }` — operator reply forwarded to Telegram |

## Dependencies
- Depends on: FR-01 (IAM/JWT for management routes), BC-01 DialogRepository + MessageRepository (persistence)
- Blocks: PQL detection pipeline processes Telegram messages the same as web widget messages

## Tests
- `src/integration/adapters/telegram-adapter.test.ts` — 14 tests covering:
  - **TelegramAdapter (9 tests):**
    - Parse text message and create inbound message
    - Create new TELEGRAM dialog when none exists
    - Broadcast `dialog:created` for new dialogs
    - Broadcast `message:new` to tenant room
    - Extract sender name from first_name + last_name
    - Handle callback_query as text message
    - Return false for updates without text or callback
    - Return false for photo-only messages
    - Send reply via bot service + throw on API error
  - **TelegramBotService (5 tests):**
    - POST to sendMessage endpoint with correct payload
    - POST to setWebhook endpoint
    - GET getMe endpoint
    - Return null from fromEnv() when token not set
    - Create service from fromEnv() when token is set

## Acceptance Criteria
- [x] Incoming Telegram text messages create/update Dialog with channelType=TELEGRAM
- [x] Messages are persisted with direction=INBOUND, senderType=CLIENT
- [x] New Telegram chats emit `dialog:created` event to operators
- [x] Every inbound message emits `message:new` to the tenant Socket.io room
- [x] Operator replies are forwarded to Telegram via Bot API sendMessage
- [x] Callback queries (button presses) are handled as text messages
- [x] Non-text updates (photos, stickers) are gracefully skipped
- [x] Webhook always returns HTTP 200 to Telegram (even on internal errors)
- [x] Admin can register webhook URL via POST /api/telegram/setup
- [x] Admin can check bot status via GET /api/telegram/status
- [x] Multi-tenant support via tenantId query parameter on webhook URL
