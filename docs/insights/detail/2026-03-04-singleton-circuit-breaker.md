# Singleton Circuit Breaker for MCP Services

**Date:** 2026-03-04 | **Area:** integration | **Type:** bug-fix

## Problem
In FR-09 (VK Max) review, discovered that `VKMaxMCPService.fromEnv()` is called
per-request in routes and outbound handlers. This creates a **new Circuit Breaker
instance** for every webhook/reply, meaning:
- Circuit breaker state is never shared across requests
- The breaker never actually "opens" because each request gets a fresh one
- The FF-04 protection is effectively bypassed

## Same Pattern in Telegram
`TelegramBotService` likely has the same issue — check if it's instantiated per-request.

## Solution
Create MCP service instances at server startup as singletons and inject them
into routes/handlers:

```typescript
// In server.ts
const vkmaxService = VKMaxMCPService.fromEnv();
const telegramService = TelegramBotService.fromEnv();

// Pass to routes
app.use('/api/vkmax', vkmaxRoutes(vkmaxService));
app.use('/api/telegram', telegramRoutes(telegramService));
```

## Affected
- `src/integration/services/vkmax-mcp-service.ts`
- `src/integration/infrastructure/vkmax-routes.ts`
- `src/integration/adapters/vkmax-outbound.ts`
- Potentially: `src/integration/services/telegram-bot-service.ts`
