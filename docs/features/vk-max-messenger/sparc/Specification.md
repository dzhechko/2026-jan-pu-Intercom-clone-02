# FR-09: VK Max / Messenger Max MCP -- Specification

## Overview

This specification details the technical behavior of the VK Max channel integration,
covering data models, API contracts, event flows, and error handling.

## Data Model

### VK Max Update (Inbound Webhook Payload)

```typescript
interface VKMaxUpdate {
  type: string           // 'confirmation' | 'message_new' | other VK events
  object: {
    message: VKMaxMessage
  }
  group_id: number       // VK Max community/group ID
}

interface VKMaxMessage {
  peer_id: number        // Conversation peer ID (unique per dialog)
  from_id: number        // Sender user ID
  text: string           // Message text content
  date: number           // Unix timestamp
}
```

### Dialog Extension (BC-01 Conversation)

The existing `Dialog` aggregate supports VK Max through:

```typescript
type ChannelType = 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
```

VK Max dialogs store channel-specific metadata:

```typescript
{
  vkMaxPeerId: string    // peer_id as string
  vkMaxFromId: string    // from_id as string
  vkMaxGroupId: string   // group_id as string
}
```

### MCP Service Response Types

```typescript
interface VKMaxSendResult {
  ok: boolean
  messageId?: number
  description?: string
}

interface VKMaxBotInfo {
  ok: boolean
  result?: { id: number; name: string; groupId: number }
  description?: string
}

interface VKMaxWebhookResult {
  ok: boolean
  result?: boolean
  description?: string
}
```

## API Endpoints

### POST /api/webhooks/vkmax

**Authentication:** None (VK Max calls this directly)

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| tenantId | string (UUID) | Yes* | Tenant identifier (*or VKMAX_DEFAULT_TENANT_ID env) |

**Request Body:** VKMaxUpdate JSON

**Behavior:**
1. If `type=confirmation` -- respond with VKMAX_CONFIRMATION_TOKEN env var
2. If `type=message_new` with text -- process through VKMaxAdapter
3. All other types -- silently skip
4. Always respond with `'ok'` (even on error) to prevent VK Max retries

**Response:** `'ok'` (text/plain) or confirmation token

### POST /api/vkmax/setup

**Authentication:** JWT required (operator/admin)

**Request Body:**
```json
{ "webhookUrl": "https://example.com/api/webhooks/vkmax" }
```

**Behavior:**
1. Appends tenantId from JWT as query parameter to webhookUrl
2. Calls VKMaxMCPService.setWebhook() to register with VK Max

**Response:**
```json
{ "ok": true, "description": null }
```

### GET /api/vkmax/status

**Authentication:** JWT required (operator/admin)

**Response:**
```json
{
  "connected": true,
  "circuitBreakerOpen": false,
  "bot": { "name": "VK Max Bot", "groupId": 123456 }
}
```

## Socket.io Events

### Namespace: /chat

| Event | Direction | Payload | Trigger |
|-------|-----------|---------|---------|
| `dialog:created` | Server -> Client | `{ dialog }` | New VK_MAX dialog created |
| `message:new` | Server -> Client | `{ message, dialog }` | Every inbound VK Max message |
| `operator:message:vkmax` | Client -> Server | `{ dialogId, content }` | Operator replies to VK_MAX dialog |

Events are scoped to `tenant:{tenantId}` rooms for multi-tenant isolation.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| VKMAX_MCP_URL | No | (none) | Cloud.ru Messenger Max MCP endpoint URL |
| VKMAX_ACCESS_TOKEN | No | (none) | VK Max bot access token |
| VKMAX_CONFIRMATION_TOKEN | No | `'ok'` | Token for VK Max callback confirmation |
| VKMAX_DEFAULT_TENANT_ID | No | (none) | Fallback tenant for webhooks without query param |

When VKMAX_MCP_URL and VKMAX_ACCESS_TOKEN are both unset, VKMaxMCPService.fromEnv()
returns null and the system operates in mock mode (logs to console, returns success).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Missing tenantId in webhook | Return 400 `{ error: 'Missing tenantId' }` |
| MCP not configured (webhook) | Return 500 `{ error: 'VK Max MCP not configured' }` |
| MCP not configured (outbound) | Log error, silently skip forwarding |
| MCP send failure | Throw `VK Max MCP error: {description}` |
| Circuit breaker open | opossum rejects immediately with circuit-open error |
| Any webhook processing error | Log error, still return `'ok'` to VK Max |

## Validation Rules

- Webhook body must have a `type` field; otherwise 400
- Setup endpoint requires `webhookUrl` in body; otherwise 400
- Management endpoints require valid JWT; otherwise 401/403
- message_new events without text are silently skipped (return false)
