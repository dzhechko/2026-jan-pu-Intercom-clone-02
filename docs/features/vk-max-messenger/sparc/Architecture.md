# FR-09: VK Max / Messenger Max MCP -- Architecture

## Component Overview

FR-09 introduces four new components within BC-04 Integration, with interactions
into BC-01 Conversation (Dialog/Message repositories) and the server bootstrap.

```
                          VK Max Cloud.ru MCP
                                 ^
                                 | (HTTP + Circuit Breaker)
                                 |
+---------------------------+    |
| BC-04 Integration         |    |
|                           |    |
|  VKMaxMCPService ---------)----+
|    (opossum CB)           |
|                           |
|  VKMaxAdapter             |
|    (inbound processing)   |
|                           |
|  VKMaxOutbound            |
|    (operator reply fwd)   |
|                           |
|  VKMaxRoutes              |
|    (webhook + management) |
+---------------------------+
        |           ^
        |           | (Socket.io /chat namespace)
        v           |
+---------------------------+
| BC-01 Conversation        |
|                           |
|  DialogRepository         |
|  MessageRepository        |
|  Dialog aggregate         |
|    (ChannelType=VK_MAX)   |
+---------------------------+
```

## File Map

| File | Layer | Responsibility |
|------|-------|---------------|
| `src/integration/services/vkmax-mcp-service.ts` | Infrastructure | MCP API wrapper with circuit breaker |
| `src/integration/adapters/vkmax-adapter.ts` | Application | Inbound webhook processing, dialog/message creation |
| `src/integration/adapters/vkmax-outbound.ts` | Infrastructure | Outbound message forwarding (Socket.io + REST) |
| `src/integration/infrastructure/vkmax-routes.ts` | Infrastructure | Express routes (webhook, setup, status) |
| `src/integration/adapters/vkmax-adapter.test.ts` | Test | 14 unit tests |
| `src/conversation/domain/aggregates/dialog.ts` | Domain | Dialog aggregate with VK_MAX channel type |
| `src/server.ts` | Bootstrap | Route mounting and outbound registration |

## Architectural Decisions

### ADR-002 Compliance: MCP = Integration Layer

All VK Max communication goes through VKMaxMCPService, which wraps the Cloud.ru
Messenger Max MCP. Domain code (Dialog, Message) never calls external APIs directly.

```
Domain Code -> VKMaxAdapter -> VKMaxMCPService -> Cloud.ru MCP
                                  (CB wrapper)
```

### Circuit Breaker Pattern (FF-04)

VKMaxMCPService wraps `_sendMessage` in an opossum CircuitBreaker:

```typescript
const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 5000,                  // 5s timeout per call
  errorThresholdPercentage: 50,   // open after 50% failures
  resetTimeout: 30000,            // try again after 30s
}
```

State transitions are logged:
- OPEN: `[vkmax-mcp-service] Circuit breaker OPEN -- VK Max API unavailable`
- HALF-OPEN: `[vkmax-mcp-service] Circuit breaker HALF-OPEN -- testing VK Max API`
- CLOSED: `[vkmax-mcp-service] Circuit breaker CLOSED -- VK Max API recovered`

### Webhook Idempotency

VK Max retries on non-200 responses. The webhook always returns `'ok'` even on errors
to prevent retry storms. Errors are logged server-side for monitoring.

### Tenant Resolution Strategy

VK Max webhooks carry no tenant context. The solution:
1. During setup (POST /api/vkmax/setup), tenantId from JWT is appended to webhook URL
2. Webhook receives tenantId as a query parameter
3. Fallback: VKMAX_DEFAULT_TENANT_ID env var for single-tenant deployments

### Dual Outbound Paths

Operator replies reach VK Max through two paths:

1. **Socket.io middleware** (real-time): `operator:message:vkmax` event on /chat namespace
2. **REST function**: `forwardToVKMaxIfNeeded()` callable from any service

Both paths look up the dialog, check `channelType === 'VK_MAX'`, and forward via MCP.

### Mock Mode

When VKMAX_MCP_URL is empty, VKMaxMCPService operates in mock mode:
- `sendMessage()` logs to console and returns `{ ok: true, messageId: Date.now() }`
- `setWebhook()` logs and returns `{ ok: true, result: true }`
- `getStatus()` returns mock bot info

This enables local development without a real VK Max bot.

## Cross-BC Interaction

FR-09 follows the established pattern from FR-08 (Telegram):

| Interaction | Direction | Mechanism |
|-------------|-----------|-----------|
| Dialog creation | Integration -> Conversation | DialogRepository.create() |
| Message persistence | Integration -> Conversation | MessageRepository.create() |
| Operator notification | Integration -> Frontend | Socket.io /chat namespace |
| Channel type extension | Conversation domain | ChannelType union type |

**Import compliance (FF-02):** Integration BC imports from Conversation infrastructure
(repositories) and shared middleware. This follows the same pattern as the Telegram
adapter and is allowed under the current architecture.

## Server Bootstrap Integration

```typescript
// server.ts mounting order:

// 1. Webhook route -- BEFORE auth middleware (VK Max sends updates directly)
app.use('/api/webhooks/vkmax', createVKMaxWebhookRouter(pool, io))

// 2. Management routes -- AFTER auth middleware
app.use('/api/vkmax', createVKMaxManagementRouter())

// 3. Socket.io outbound -- registered on /chat namespace
registerVKMaxOutbound(io, pool)
```

## Security Considerations

| Concern | Implementation |
|---------|---------------|
| Webhook authentication | VK Max confirmation callback + tenantId validation |
| Management auth | JWT required for setup and status endpoints |
| Data residency (FF-10) | MCP calls go to Cloud.ru (Russian infrastructure) |
| Token storage | VKMAX_ACCESS_TOKEN in env var, not in database |
| Error leakage | Webhook always returns 'ok', no internal details exposed |
