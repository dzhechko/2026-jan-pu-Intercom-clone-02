# FR-05: Telegram Channel -- Refinement

## Edge Cases

### EC-01: Telegram Retry Storm Prevention
**Scenario:** If the webhook endpoint returns non-200, Telegram retries the update repeatedly.
**Mitigation (implemented):** The webhook handler always returns HTTP 200, even on internal errors.
The catch block in telegram-routes.ts returns `{ ok: true, error: "internal" }` with status 200.
**Risk level:** HIGH -- violation would cause cascading failures from repeated retries.

### EC-02: Non-Text Message Types
**Scenario:** User sends a photo, sticker, document, or voice message.
**Mitigation (implemented):** `handleUpdate()` returns `false` for updates without `text` or
`callback_query.data`. These are silently skipped in v1.
**Future:** v2 could extract captions from photos or transcribe voice messages.

### EC-03: Missing Telegram User Information
**Scenario:** `from` field is absent (channel posts, anonymous admins).
**Mitigation (implemented):** Sender name defaults to `"Unknown"` when `tgMessage.from` is null.

### EC-04: Duplicate Dialog Prevention
**Scenario:** Multiple messages from the same Telegram chat should use the same Dialog.
**Mitigation (implemented):** `dialogRepo.findByExternalId(tenantId, chatId)` is called before
creating a new dialog. The Telegram chat ID serves as the externalChannelId.

### EC-05: Bot Token Not Configured
**Scenario:** TELEGRAM_BOT_TOKEN env var is missing.
**Mitigation (implemented):**
- Webhook route: returns HTTP 500 with error message
- Outbound handler: logs error and silently returns (operator message still saved in DB)
- Management routes: returns appropriate error response

### EC-06: Telegram API Failure on Outbound
**Scenario:** Bot API returns error when sending operator reply (chat not found, bot blocked, etc.).
**Mitigation (implemented):**
- `sendReply()` in TelegramAdapter throws on API error (caller handles)
- `forwardToTelegramIfNeeded()` catches errors and logs them
- Socket.io outbound middleware catches errors and logs them
- Operator's message is already persisted in DB regardless of Telegram delivery status.

### EC-07: Multi-Tenant Webhook Routing
**Scenario:** Webhook URL must identify which tenant the message belongs to.
**Mitigation (implemented):** tenantId passed as URL query parameter. Fallback to
`TELEGRAM_DEFAULT_TENANT_ID` env var for single-tenant deployments.
**Risk:** Query parameter is not cryptographically verified -- an attacker could forge tenantId.

### EC-08: Callback Query Without Chat Context
**Scenario:** A callback_query may lack the `message` field (old messages).
**Mitigation (implemented):** Falls back to `{ id: callback_query.from.id, type: "private" }`
when `callback_query.message?.chat` is undefined.

## Known Risks

### R-01: No HMAC Webhook Verification (MEDIUM)
**Current state:** The webhook endpoint does not verify Telegram's secret token header.
Telegram supports setting a `secret_token` parameter in setWebhook, which is then sent
in the `X-Telegram-Bot-Api-Secret-Token` header of each update.
**Impact:** Anyone who discovers the webhook URL could send fake updates.
**Recommendation:** Add secret_token verification in v2. Generate a per-tenant secret,
pass it to setWebhook, and validate the header on each incoming request.

### R-02: No Circuit Breaker on Bot API Calls (MEDIUM)
**Current state:** TelegramBotService makes direct HTTP calls without circuit breaker (opossum).
Per FF-04, every MCP adapter should have a circuit breaker.
**Impact:** If Telegram API is down, outbound calls will fail repeatedly without backoff.
**Recommendation:** Wrap TelegramBotService calls with opossum circuit breaker in v2.

### R-03: Single Bot Token Per Deployment (LOW)
**Current state:** Bot token is a single env var (TELEGRAM_BOT_TOKEN).
**Impact:** All tenants share the same bot, which limits multi-tenant isolation.
**Recommendation:** Store per-tenant bot tokens in TenantSettings (encrypted with AES-256-GCM
per SH-01) and decrypt at request time.

### R-04: No Rate Limiting on Webhook Endpoint (LOW)
**Current state:** The webhook endpoint has no rate limiting.
**Impact:** A malicious actor could flood the endpoint with fake updates.
**Recommendation:** Add IP-based rate limiting or Telegram IP range whitelisting.

### R-05: Cross-BC Direct Imports (LOW)
**Current state:** telegram-adapter.ts imports directly from BC-01 repositories.
chat-routes.ts imports from BC-04 telegram-outbound.ts.
**Impact:** Violates strict BC isolation (FF-02). However, the adapter functions as an ACL.
**Recommendation:** Introduce domain events via Redis Streams to fully decouple in v2.

## Performance Considerations

- Webhook processing is synchronous (await dialog lookup + message create + Socket.io emit)
- Typical latency: ~50-200ms for DB operations + negligible Socket.io emit
- No queuing -- messages are processed inline in the webhook handler
- Future optimization: publish to Redis Stream for async processing (matches ADR-006)

## Testing Gaps

- No integration test with real Telegram API (would require bot token + test chat)
- No load test for webhook endpoint under high message volume
- No test for concurrent messages from same chat (potential race condition on dialog creation)
- No test for HMAC verification (not yet implemented)
