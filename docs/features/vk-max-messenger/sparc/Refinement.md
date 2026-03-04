# FR-09: VK Max / Messenger Max MCP -- Refinement

## Edge Cases

### EC-01: VK Max Retry Storms
**Scenario:** VK Max retries webhooks on non-200 responses.
**Mitigation:** Webhook always returns `'ok'` string, even when processing fails.
All errors are logged server-side but never exposed to VK Max.

### EC-02: Missing Tenant Context in Webhook
**Scenario:** VK Max webhooks carry no tenant identification.
**Mitigation:** tenantId is appended as a query parameter to the webhook URL during
setup (POST /api/vkmax/setup). Fallback: VKMAX_DEFAULT_TENANT_ID env var.
If neither is available, return 400.

### EC-03: Duplicate Messages
**Scenario:** VK Max may deliver the same message_new event multiple times.
**Current behavior:** Each delivery creates a new message record.
**Risk:** Low -- VK Max deduplication is reliable when webhook returns 'ok'.
**Future mitigation:** Add message deduplication by VK Max message date + peer_id.

### EC-04: Empty or Missing Text
**Scenario:** message_new with empty text (e.g., image-only, sticker).
**Behavior:** Adapter returns false (skips processing). No dialog created.
**Impact:** Media-only messages from VK Max are silently dropped in v1.

### EC-05: MCP Service Unavailable
**Scenario:** Cloud.ru Messenger Max MCP is down or unreachable.
**Mitigation:** Circuit breaker opens after 50% error rate. Inbound messages
are still processed (dialog created, message persisted, Socket.io broadcast).
Only outbound replies fail gracefully.

### EC-06: Circuit Breaker Open During Operator Reply
**Scenario:** Operator sends a reply while circuit breaker is open.
**Behavior:** opossum rejects immediately. Error is caught in outbound handler,
logged, but not propagated to the operator. Message is saved locally but not
delivered to VK Max.
**Future:** Queue failed outbound messages for retry when circuit closes.

### EC-07: Confirmation Callback
**Scenario:** VK Max sends `type=confirmation` to verify webhook ownership.
**Behavior:** Webhook responds with VKMAX_CONFIRMATION_TOKEN env var (default: 'ok').
This must happen before any other processing; the response must be fast.

### EC-08: Invalid Webhook Payload
**Scenario:** Malformed JSON or missing `type` field in webhook body.
**Behavior:** Return 400 `{ error: 'Invalid VK Max update' }`.
Note: this is the only case where webhook does NOT return 'ok'.

### EC-09: Large Message Text
**Scenario:** VK Max message with text exceeding 5000 characters.
**Current behavior:** Full text is stored in message.content without truncation.
**Risk:** Aligns with EC-02 from global refinement.md -- should apply same truncation.

## Technical Risks

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|-----------|
| VK Max API changes | Medium | Low | MCP adapter abstracts API details; changes isolated to MCP service |
| Token expiration | Medium | Medium | Monitor via /status endpoint; alert on `connected: false` |
| Rate limiting by VK Max | Low | Low | Circuit breaker prevents burst; webhook returns 'ok' |
| Multi-tenant webhook conflicts | Medium | Low | tenantId in URL query params; validation before processing |
| Mock mode in production | High | Low | Log warning when MCP URL is not configured |

## Quality Attributes

### Performance
- Inbound webhook processing: < 500ms (dialog lookup + message create + Socket.io emit)
- Outbound MCP call: < 5000ms (circuit breaker timeout)
- Overall PQL pipeline (including VK Max): < 2000ms p95 (FF-01)

### Reliability
- Circuit breaker prevents cascade failures
- Webhook always returns 'ok' to prevent retries
- Mock mode enables graceful degradation

### Observability
- Console logging at all key points (webhook, adapter, MCP service, outbound)
- Circuit breaker state transitions logged with severity levels
- /status endpoint exposes circuit breaker state

### Security
- Webhook endpoint has no auth (VK Max requirement)
- Management endpoints require JWT authentication
- Access token stored in env var, never logged
- Data residency: Cloud.ru MCP is Russian infrastructure (FF-10)

## Testing Gaps

| Gap | Severity | Recommendation |
|-----|----------|---------------|
| No integration test with real VK Max API | Medium | Add contract test with recorded API responses |
| No test for confirmation callback in routes | Low | Add route-level test for `type=confirmation` |
| No test for webhook error recovery | Low | Test that errors still return 'ok' |
| No test for dual outbound paths | Medium | Test forwardToVKMaxIfNeeded() function |
| No load test for webhook throughput | Low | Benchmark with concurrent webhook deliveries |

## Future Improvements

1. **Media support:** Handle image, document, and sticker attachments from VK Max
2. **Message deduplication:** Prevent duplicate processing from VK Max retries
3. **Outbound retry queue:** Queue failed messages when circuit breaker is open
4. **Webhook HMAC verification:** Validate VK Max webhook signatures (SH-04)
5. **Client profile enrichment:** Fetch VK Max user profile for dialog metadata
6. **Group chat support:** Handle multi-party conversations
7. **Typing indicators:** Forward typing status between workspace and VK Max
