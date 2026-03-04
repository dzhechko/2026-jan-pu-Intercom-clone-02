# Webhook HMAC Verification Missing on All Channels

**Date:** 2026-03-04 | **Area:** security | **Type:** finding

## Problem
Both FR-05 (Telegram) and FR-09 (VK Max) reviews found that webhook
endpoints accept any POST request without signature verification.

Per SH-04 security rules:
- Telegram: HMAC-SHA256 signature required
- VK Max: Shared secret in header required
- Unverified webhooks should return HTTP 401

## Risk
If webhook URLs are discovered (e.g., through URL scanning), attackers
can inject fake messages into the system.

## Mitigation (current)
- Telegram: Bot token in URL path provides weak obscurity
- VK Max: Confirmation callback provides basic handshake

## Solution
```typescript
// Telegram: verify X-Telegram-Bot-Api-Secret-Token header
app.post('/webhooks/telegram', (req, res) => {
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  // ... process
});
```

## Affected
- `src/integration/infrastructure/telegram-routes.ts`
- `src/integration/infrastructure/vkmax-routes.ts`
