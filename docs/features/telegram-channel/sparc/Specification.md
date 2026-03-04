# FR-05: Telegram Channel -- Specification

## User Stories and Acceptance Criteria

### US-01: Client sends message via Telegram

**As a** Client,
**I want to** send a message to support via Telegram,
**So that** I can use my preferred messenger without visiting a web widget.

**Acceptance Criteria:**
- [x] Incoming Telegram text messages create a Dialog with channelType=TELEGRAM
- [x] Messages are persisted with direction=INBOUND, senderType=CLIENT
- [x] Existing Telegram chats reuse the same Dialog (lookup by externalChannelId)
- [x] Sender name extracted from Telegram first_name + last_name fields
- [x] Sender username stored in dialog metadata

### US-02: Operator sees Telegram messages in unified workspace

**As an** Operator,
**I want to** see Telegram messages in the same workspace as web chat,
**So that** I have a single unified inbox for all channels.

**Acceptance Criteria:**
- [x] New Telegram dialogs emit `dialog:created` event via Socket.io /chat namespace
- [x] Every inbound message emits `message:new` to the tenant Socket.io room
- [x] Events are scoped to the correct tenant room (`tenant:{tenantId}`)

### US-03: Operator replies to Telegram user

**As an** Operator,
**I want to** reply to a Telegram dialog and have it delivered to the Telegram user,
**So that** the conversation flows naturally across channels.

**Acceptance Criteria:**
- [x] Operator replies via `operator:message:telegram` Socket.io event are forwarded to Telegram
- [x] REST-originated replies (POST /api/dialogs/:id/messages) also forward to Telegram
- [x] Outbound messages use HTML parse_mode for basic formatting
- [x] API errors from Telegram are logged but do not crash the server

### US-04: Admin configures Telegram bot

**As an** Admin,
**I want to** configure the Telegram bot webhook for my tenant,
**So that** my tenant receives messages from our Telegram bot.

**Acceptance Criteria:**
- [x] POST /api/telegram/setup registers webhook URL with Telegram Bot API
- [x] Webhook URL automatically includes tenantId query parameter
- [x] GET /api/telegram/status returns bot connection info
- [x] Management routes require JWT authentication

### US-05: Callback query handling

**As a** Client,
**I want to** press inline buttons in Telegram and have them processed as messages,
**So that** button-based interactions work through the support pipeline.

**Acceptance Criteria:**
- [x] callback_query updates are converted to synthetic text messages
- [x] The callback data field becomes the message content
- [x] Synthetic messages flow through the same pipeline as regular text

## API Contract

### POST /api/webhooks/telegram (No Auth)

**Request:** Telegram Update object (sent by Telegram servers)
```json
{
  "update_id": 123456,
  "message": {
    "message_id": 1,
    "from": { "id": 12345, "first_name": "John", "username": "john_doe" },
    "chat": { "id": 12345, "type": "private" },
    "date": 1234567890,
    "text": "Hello, question about pricing"
  }
}
```

**Response:** Always HTTP 200
```json
{ "ok": true, "handled": true }
```

### POST /api/telegram/setup (Auth Required)

**Request:**
```json
{ "webhookUrl": "https://example.com/api/webhooks/telegram" }
```

**Response:**
```json
{ "ok": true, "description": "Webhook was set" }
```

### GET /api/telegram/status (Auth Required)

**Response:**
```json
{
  "connected": true,
  "bot": { "username": "my_support_bot", "name": "My Support Bot" }
}
```

## Socket.io Events

| Event | Direction | Namespace | Payload |
|-------|-----------|-----------|---------|
| `dialog:created` | Server -> Client | /chat | `{ dialog }` |
| `message:new` | Server -> Client | /chat | `{ message, dialog }` |
| `operator:message:telegram` | Client -> Server | /chat | `{ dialogId, content }` |

## Data Model

Telegram dialogs use the existing Dialog aggregate with:
- `channelType`: `'TELEGRAM'`
- `externalChannelId`: Telegram chat ID (string)
- `metadata`: `{ telegramChatId, senderName, senderUsername }`

Messages use the existing Message entity with standard INBOUND/OUTBOUND directions.
