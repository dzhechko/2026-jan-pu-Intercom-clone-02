# Security Rules — КоммуниК

## Data Residency (FF-10) — CRITICAL
- ALL data stored on Russian VPS (HOSTKEY/AdminVPS) only
- FORBIDDEN: OpenAI, Anthropic, or any foreign LLM API for production data
- ALLOWED: on-premise vLLM, Cloud.ru AI Fabric MCP servers
- Resend API: only for metadata (email delivery), never for PII

## Tenant Isolation (FF-03) — CRITICAL
- ALWAYS set `SET app.tenant_id` via middleware before DB queries
- NEVER pass tenant_id as WHERE clause filter — RLS handles it
- All tables with tenant_id MUST have Row-Level Security enabled
- Integration test: tenant A must never see tenant B data

## API Key Storage (SH-01)
- Encrypt with AES-256-GCM via Node.js crypto
- Encryption key from env var ENCRYPTION_KEY (never in DB)
- Decrypt only at MCP request time, immediately zero memory
- NEVER log API keys, even partially

## PII Protection (SH-02)
- NEVER send raw dialog content to foreign APIs
- v1: rate limit + operator "possible PII" badge
- v2: SpaCy NER masking before DB storage
- Logs: sanitize all PII before writing

## Rate Limiting (SH-03)
```
/api/dialogs:        100 req/min per operator
/api/pql/feedback:   300 req/min per operator
WebSocket:           50 events/sec per tenant namespace
Chat Widget:         10 msg/min per session (anti-spam)
```
Implementation: express-rate-limit + Redis store

## Webhook Verification (SH-04)
- Telegram: HMAC-SHA256 signature
- amoCRM: shared secret in header
- Max MCP: MCP protocol auth
- REJECT any unverified webhook → HTTP 401

## MCP Security
- Circuit Breaker (opossum) on every MCP adapter (FF-04)
- Timeout: ≤3000ms per MCP call
- Fallback: graceful degradation, never throw to domain
- Credentials: encrypted in TenantSettings, decrypted in memory only
