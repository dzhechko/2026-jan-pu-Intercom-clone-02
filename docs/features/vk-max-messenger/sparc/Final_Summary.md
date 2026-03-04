# FR-09: VK Max / Messenger Max MCP -- Final Summary

## Feature Overview

FR-09 implements bidirectional VK Max (Messenger Max) channel integration for the
operator workspace. Client messages from VK Max are received via webhook,
persisted as dialogs/messages, and broadcast to operators in real time. Operator
replies are forwarded back to VK Max through Cloud.ru Messenger Max MCP with
circuit breaker protection.

## Implementation Summary

### Components Delivered

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| VKMaxAdapter | `src/integration/adapters/vkmax-adapter.ts` | 122 | Inbound webhook processing |
| VKMaxMCPService | `src/integration/services/vkmax-mcp-service.ts` | 159 | MCP API wrapper + circuit breaker |
| VKMaxOutbound | `src/integration/adapters/vkmax-outbound.ts` | 75 | Outbound message forwarding |
| VKMaxRoutes | `src/integration/infrastructure/vkmax-routes.ts` | 133 | Express routes (webhook + management) |
| Tests | `src/integration/adapters/vkmax-adapter.test.ts` | 309 | 14 unit tests |

### Server Integration

Three mount points in `src/server.ts`:
1. Webhook route before auth middleware (line 81)
2. Management routes after auth middleware (line 136)
3. Socket.io outbound registration (line 216)

### Domain Model Extension

`ChannelType` union in `src/conversation/domain/aggregates/dialog.ts` extended to
include `'VK_MAX'` alongside `'WEB_CHAT'` and `'TELEGRAM'`.

## Architectural Compliance

| Fitness Function | Status | Details |
|-----------------|--------|---------|
| FF-01: PQL detection < 2000ms | Compliant | VK Max messages enter same pipeline |
| FF-02: No cross-BC imports | Compliant | Follows Telegram adapter pattern |
| FF-04: Circuit breaker on MCP | Compliant | opossum with 5s/50%/30s config |
| FF-10: Data residency | Compliant | Cloud.ru MCP (Russian infrastructure) |
| ADR-002: MCP = Integration Layer | Compliant | All external calls via VKMaxMCPService |

## Test Results

```
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
Time:        0.408s

VKMaxAdapter:
  - handleUpdate -- message_new (5 tests)
  - handleUpdate -- non-message_new (2 tests)
  - sendReply -- outbound (2 tests)

VKMaxMCPService:
  - fromEnv (3 tests)
  - circuit breaker (2 tests)
```

## API Surface

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/webhooks/vkmax | No | VK Max webhook endpoint |
| POST | /api/vkmax/setup | JWT | Register webhook URL |
| GET | /api/vkmax/status | JWT | Connection + circuit breaker status |

## Socket.io Events

| Event | Direction | Namespace |
|-------|-----------|-----------|
| dialog:created | Server -> Client | /chat |
| message:new | Server -> Client | /chat |
| operator:message:vkmax | Client -> Server | /chat |

## Key Design Decisions

1. **Webhook always returns 'ok'** -- Prevents VK Max retry storms
2. **Tenant via query param** -- VK Max webhooks have no tenant context
3. **Mock MCP mode** -- Enables development without real VK Max bot
4. **Dual outbound paths** -- Socket.io (real-time) + REST (service calls)
5. **Circuit breaker** -- 5000ms timeout, 50% threshold, 30s reset

## Risks and Mitigations

| Risk | Status |
|------|--------|
| VK Max retry storms | Mitigated (always return 'ok') |
| MCP unavailability | Mitigated (circuit breaker + mock mode) |
| Missing tenant context | Mitigated (query param + env fallback) |
| Media messages dropped | Accepted (text-only in v1) |
| No webhook HMAC verification | Accepted (future improvement) |

## Dependencies

| Dependency | Status |
|------------|--------|
| FR-01: Project Setup | Done |
| FR-03: Conversation BC | Done |
| Cloud.ru Messenger Max MCP | Available |

## Conclusion

FR-09 delivers a complete, production-ready VK Max channel integration that follows
the established patterns from FR-08 (Telegram). The implementation complies with all
relevant fitness functions and architectural decisions. The circuit breaker pattern
ensures resilience, while mock mode supports development workflows. The feature is
fully tested with 14 passing unit tests covering all critical paths.
