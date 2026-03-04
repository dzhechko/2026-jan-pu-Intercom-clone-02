# FR-09: VK Max / Messenger Max MCP Channel
**Status:** Done | **BC:** BC-04 Integration, BC-01 Conversation | **Priority:** SHOULD

## Summary
Implemented bidirectional VK Max (Messenger Max) channel integration via Cloud.ru MCP adapter. Inbound webhook messages from VK Max create or find existing dialogs (channelType=VK_MAX), persist messages, and broadcast to operator workspace via Socket.io. Outbound operator replies are forwarded to VK Max users through the MCP service with circuit breaker protection.

## User Stories
- US-09a: As a tenant admin, I want to connect my VK Max bot so that client messages from VK Max appear in the operator workspace.
- US-09b: As an operator, I want to reply to VK Max clients from the workspace so that I don't need to switch between platforms.
- US-09c: As a system, I want circuit breaker protection on VK Max MCP calls so that failures don't cascade to the core application.

## Technical Design

### Files Created
- `src/integration/adapters/vkmax-adapter.ts` -- VKMaxAdapter class handling inbound webhook updates (message_new parsing, dialog creation/lookup, message persistence, Socket.io broadcast) and outbound sendReply via MCP.
- `src/integration/services/vkmax-mcp-service.ts` -- VKMaxMCPService wrapping Cloud.ru Messenger Max MCP API with opossum circuit breaker. Provides sendMessage, setWebhook, getStatus, and isCircuitOpen. Includes mock implementation for development.
- `src/integration/infrastructure/vkmax-routes.ts` -- Express routes: unauthenticated webhook endpoint (POST /api/webhooks/vkmax) and authenticated management routes (POST /api/vkmax/setup, GET /api/vkmax/status).
- `src/integration/adapters/vkmax-outbound.ts` -- Socket.io middleware intercepting operator:message:vkmax events on /chat namespace to forward messages to VK Max. Also provides standalone forwardToVKMaxIfNeeded() for REST flow.
- `src/integration/adapters/vkmax-adapter.test.ts` -- Unit tests covering adapter and MCP service.

### Files Modified
- Server bootstrap (server.ts) -- Mounted webhook and management routers.

### Key Decisions
- **Webhook always returns 'ok':** VK Max retries on non-200 responses, so even errors return 'ok' to prevent retry storms.
- **VK Max confirmation callback:** The webhook handles `type=confirmation` by responding with VKMAX_CONFIRMATION_TOKEN env var, required by VK Max callback server registration.
- **Tenant resolution via query param:** Webhook includes `tenantId` as a query parameter (appended during setup), since VK Max webhooks carry no tenant context.
- **Mock MCP implementation:** When VKMAX_MCP_URL is empty, service runs in mock mode logging to console, enabling local development without a real VK Max bot.
- **Circuit breaker settings:** 5000ms timeout, 50% error threshold, 30s reset -- per ADR-002 MCP adapter pattern with opossum.
- **Dual outbound paths:** Both Socket.io middleware (real-time) and standalone function (REST) can forward messages to VK Max.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/vkmax` | Incoming VK Max webhook (no auth, confirmation + message_new) |
| POST | `/api/vkmax/setup` | Register webhook URL with VK Max callback server (auth required) |
| GET | `/api/vkmax/status` | Check VK Max MCP connection and circuit breaker status (auth required) |

## Socket.io Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `dialog:created` | Server -> Client | `{ dialog }` -- emitted when new VK_MAX dialog is created |
| `message:new` | Server -> Client | `{ message, dialog }` -- emitted for every inbound VK Max message |
| `operator:message:vkmax` | Client -> Server | `{ dialogId, content }` -- operator reply forwarded to VK Max |

## Dependencies
- Depends on: FR-01 (project setup), FR-03 (Conversation BC / DialogRepository, MessageRepository)
- Blocks: none (standalone channel)

## Tests
- `src/integration/adapters/vkmax-adapter.test.ts` -- 12 tests covering:
  - VKMaxAdapter: message_new parsing, dialog creation, metadata storage, Socket.io broadcast, non-message skip, empty text skip, outbound send, MCP error handling
  - VKMaxMCPService: fromEnv() null cases, service creation, circuit breaker status, mock message send

## Acceptance Criteria
- [x] VK Max message_new webhook creates a dialog with channelType=VK_MAX
- [x] Inbound messages are persisted and broadcast to operators via Socket.io
- [x] Operator replies are forwarded to VK Max via MCP service
- [x] Circuit breaker protects all outbound MCP calls (opossum, FF-04)
- [x] Non-message_new events are silently skipped (no errors)
- [x] Webhook always returns 'ok' to VK Max to prevent retry storms
- [x] VK Max confirmation callback is handled correctly
- [x] Management routes require authentication; webhook does not
- [x] Mock mode works when VKMAX_MCP_URL is not configured
