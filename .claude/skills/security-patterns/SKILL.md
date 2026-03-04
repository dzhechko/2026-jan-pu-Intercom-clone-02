---
name: security-patterns
description: >
  КоммуниК security patterns for API key encryption, tenant isolation,
  data residency, MCP credential management, and PII protection.
version: "1.0"
maturity: production
---

# Security Patterns: КоммуниК

## 1. API Key Encryption (TenantSettings.crmIntegration)

```typescript
// src/shared/utils/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function encrypt(plaintext: string, key: Buffer): EncryptedValue {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return { encrypted: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') }
}

function decrypt(value: EncryptedValue, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(value.iv, 'base64'), key)
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(value.encrypted, 'base64')), decipher.final()])
  return decrypted.toString()
}
```

Key: from `process.env.ENCRYPTION_KEY` (never in DB).
Decrypt only at MCP request time. Zero memory immediately after.

## 2. Row-Level Security (PostgreSQL)

```sql
-- Every table with tenant_id:
ALTER TABLE {schema}.{table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON {schema}.{table}
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

Middleware sets `SET app.tenant_id` from JWT before every query.

## 3. Circuit Breaker on MCP

```typescript
import CircuitBreaker from 'opossum'

const breaker = new CircuitBreaker(mcpCall, {
  timeout: 2000,           // 2s timeout
  errorThresholdPercentage: 50,
  resetTimeout: 30000,     // 30s before retry
  rollingCountTimeout: 10000
})

breaker.fallback(() => Result.unavailable())
```

## 4. Data Residency
- ALL storage: Russian VPS (HOSTKEY/AdminVPS)
- FORBIDDEN: foreign LLM APIs for production data
- MCP: Cloud.ru AI Fabric (Russian infrastructure)
- Email delivery (Resend): only metadata, never PII content

## 5. PII Protection
- NEVER log raw dialog content
- NEVER send dialogs to foreign APIs
- Sanitize before logging: mask email, phone, card numbers
- v2: SpaCy NER masking before DB storage
