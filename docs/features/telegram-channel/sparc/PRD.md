# FR-05: Telegram Channel -- Product Requirements Document

## Feature Overview

FR-05 integrates Telegram as an inbound/outbound messaging channel for the KommuniQ platform.
Incoming Telegram messages arrive via Bot API webhooks, are persisted as Dialog/Message entities,
and appear in the unified operator workspace alongside web chat dialogs. Operator replies flow
back to the Telegram user through the Bot API.

**Bounded Contexts:** BC-01 Conversation, BC-04 Integration
**Priority:** MUST (M1 milestone)
**Status:** Implemented

## Problem Statement

Support teams using KommuniQ need to receive and respond to messages from clients who prefer
Telegram. Without this feature, Telegram users would need to visit the web widget, creating
friction. Telegram is the dominant messenger in the Russian market, making this channel critical
for PLG/SaaS companies targeting Russian users.

## Goals

1. Accept incoming Telegram text messages via Bot API webhook
2. Unify Telegram messages into the same dialog queue as web chat
3. Allow operators to reply to Telegram users directly from the operator workspace
4. Support multi-tenant configurations (each tenant can connect their own bot)
5. Handle Telegram-specific message types (callback queries from inline buttons)

## Non-Goals (v1 Scope)

- Media messages (photos, stickers, documents) -- skipped, text only
- Inline keyboard generation from KommuniQ side
- Telegram Business API (only standard Bot API)
- Group/supergroup/channel messages (private chats only in practice)
- Telegram-specific formatting beyond HTML parse_mode

## User Stories

| ID | Role | Story | Acceptance Criteria |
|----|------|-------|---------------------|
| US-01 | Client | I want to contact support via Telegram so I can use my preferred messenger | Telegram text messages create/update Dialog with channelType=TELEGRAM |
| US-02 | Operator | I want to see Telegram messages in the same workspace as other channels | Messages appear in unified inbox with TELEGRAM channel badge |
| US-03 | Operator | I want my replies delivered back to the Telegram user | Operator replies forwarded via Bot API sendMessage |
| US-04 | Admin | I want to configure the Telegram bot webhook for my tenant | POST /api/telegram/setup registers webhook with Bot API |

## Success Metrics

- Telegram messages processed within 500ms webhook-to-persistence
- Zero message loss (webhook always returns HTTP 200 to prevent Telegram retries)
- Unified queue: Telegram dialogs appear alongside WEB_CHAT dialogs in operator workspace

## Dependencies

- FR-01: IAM/JWT for management route authentication
- BC-01: DialogRepository + MessageRepository for persistence
- BC-01: Socket.io /chat namespace for real-time operator notifications

## Constraints

- Webhook endpoint must be publicly accessible (no JWT -- Telegram calls it directly)
- Bot token stored in environment variable (TELEGRAM_BOT_TOKEN)
- Multi-tenant identification via query parameter on webhook URL
- Data residency: all message content stored on Russian VPS (FF-10)
