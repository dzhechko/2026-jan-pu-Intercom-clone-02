# Administrator Guide

## Overview

This guide covers tenant administration tasks: creating tenants, managing operators, configuring PQL rules, and setting up integrations.

## Tenant Creation

Register a new tenant (company) via the API:

```bash
curl -X POST https://your-domain.ru/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Acme Corp",
    "adminEmail": "admin@acme.ru",
    "adminPassword": "SecureP@ss123",
    "adminName": "Ivan Petrov",
    "plan": "professional"
  }'
```

Response:

```json
{
  "tenant": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "companyName": "Acme Corp",
    "plan": "professional",
    "createdAt": "2026-01-15T10:00:00Z"
  },
  "admin": {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "email": "admin@acme.ru",
    "role": "ADMIN"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

Upon registration:
- A new tenant record is created with RLS policies.
- The registering user becomes the first ADMIN operator.
- Default PQL rules (15 signals) are initialized.
- A JWT token is returned for immediate API access.

## Operator Management

### Roles

| Role | Permissions |
|------|------------|
| `ADMIN` | Full access: manage operators, configure PQL rules, integrations, view reports |
| `OPERATOR` | Handle dialogs, view PQL indicators, access Memory AI context |

### Add an operator

```bash
curl -X POST https://your-domain.ru/api/operators \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "maria@acme.ru",
    "name": "Maria Sidorova",
    "role": "OPERATOR",
    "password": "TempP@ss456"
  }'
```

### List operators

```bash
curl https://your-domain.ru/api/operators \
  -H "Authorization: Bearer <admin-jwt>"
```

### Deactivate an operator

Deactivation preserves the operator's history but prevents login:

```bash
curl -X PATCH https://your-domain.ru/api/operators/<operator-id>/deactivate \
  -H "Authorization: Bearer <admin-jwt>"
```

### Update operator role

```bash
curl -X PATCH https://your-domain.ru/api/operators/<operator-id> \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "role": "ADMIN" }'
```

## PQL Rule Configuration

### Default signals

KommuniK ships with 15 default PQL signals organized in categories:

| # | Category | Signal Pattern | Default Weight |
|---|----------|---------------|:--------------:|
| 1 | Pricing | "how much", "price", "cost" | 0.20 |
| 2 | Pricing | "pricing plans", "tariff" | 0.18 |
| 3 | Pricing | "discount", "promotion" | 0.15 |
| 4 | Trial | "trial period", "free trial" | 0.18 |
| 5 | Trial | "extend trial", "upgrade" | 0.22 |
| 6 | Scaling | "more users", "add seats" | 0.20 |
| 7 | Scaling | "enterprise plan", "team plan" | 0.18 |
| 8 | Integration | "API access", "integration" | 0.15 |
| 9 | Integration | "connect CRM", "webhook" | 0.15 |
| 10 | Comparison | "vs competitor", "alternative to" | 0.12 |
| 11 | Buying | "purchase", "buy", "pay" | 0.25 |
| 12 | Buying | "invoice", "payment method" | 0.22 |
| 13 | Timeline | "when available", "release date" | 0.10 |
| 14 | Feature | "custom domain", "SSO" | 0.12 |
| 15 | Feature | "SLA", "uptime guarantee" | 0.12 |

### PQL score thresholds

| Tier | Score Range | Meaning |
|------|:-----------:|---------|
| HOT | >= 0.80 | High purchase intent, prioritize immediately |
| WARM | 0.65 - 0.79 | Moderate intent, monitor closely |
| COLD | < 0.65 | Low intent, standard handling |

### View current rules

```bash
curl https://your-domain.ru/api/pql/rules \
  -H "Authorization: Bearer <admin-jwt>"
```

### Add a custom rule

```bash
curl -X POST https://your-domain.ru/api/pql/rules \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "pattern": "annual subscription",
    "category": "buying",
    "weight": 0.20,
    "isRegex": false,
    "caseSensitive": false
  }'
```

### Update rule weight

```bash
curl -X PATCH https://your-domain.ru/api/pql/rules/<rule-id> \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "weight": 0.25 }'
```

### Disable a rule

```bash
curl -X PATCH https://your-domain.ru/api/pql/rules/<rule-id> \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

## amoCRM Integration Setup

amoCRM integration uses the MCP adapter through Cloud.ru AI Fabric.

### Step 1: Get amoCRM credentials

1. Log into your amoCRM account.
2. Navigate to Settings > Integrations > API.
3. Create a new integration and note the Client ID, Client Secret, and Redirect URI.

### Step 2: Configure in KommuniK

```bash
curl -X POST https://your-domain.ru/api/integrations/amocrm \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "amocrmDomain": "acme.amocrm.ru",
    "clientId": "<amocrm-client-id>",
    "clientSecret": "<amocrm-client-secret>",
    "redirectUri": "https://your-domain.ru/api/integrations/amocrm/callback",
    "pipelineId": "<target-pipeline-id>",
    "responsibleUserId": "<default-responsible-user-id>"
  }'
```

### Step 3: Complete OAuth flow

After POST, the API returns an authorization URL. Open it in a browser to complete the OAuth flow. KommuniK stores the access and refresh tokens encrypted (AES-256-GCM).

### What amoCRM integration enables

- **Memory AI:** Automatic CRM context loading when an operator opens a dialog.
- **Deal creation:** Automatic deal creation in amoCRM when a PQL is detected (HOT tier).
- **Revenue attribution:** Links closed deals back to support dialogs for revenue reporting.
- **Contact enrichment:** Syncs client data between KommuniK and amoCRM.

## Telegram Bot Setup

### Step 1: Create a bot

1. Open Telegram, find @BotFather.
2. Send `/newbot`, follow the prompts.
3. Copy the bot token.

### Step 2: Configure webhook

```bash
curl -X POST https://your-domain.ru/api/integrations/telegram \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "<telegram-bot-token>",
    "webhookSecret": "<random-secret-string>"
  }'
```

KommuniK automatically registers the webhook URL with Telegram:

```
https://your-domain.ru/api/webhooks/telegram/<tenant-id>
```

### Step 3: Verify

Send a test message to your bot. It should appear in the Operator Workspace.

## VK Max Setup

VK Max uses the MCP adapter through Cloud.ru AI Fabric.

```bash
curl -X POST https://your-domain.ru/api/integrations/max \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "<max-bot-token>",
    "mcpToken": "<cloud-ru-mcp-token>"
  }'
```

Messages from VK Max appear in the Operator Workspace alongside Telegram and widget dialogs.

## PQL Pulse Notification Management

PQL Pulse sends real-time notifications when PQL events are detected.

### Configure notification channels

```bash
curl -X PUT https://your-domain.ru/api/notifications/settings \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "pqlPulse": {
      "enabled": true,
      "channels": {
        "inApp": true,
        "email": true,
        "telegram": false
      },
      "minTier": "WARM",
      "recipients": ["admin@acme.ru", "sales@acme.ru"],
      "quietHours": {
        "enabled": true,
        "from": "22:00",
        "to": "08:00",
        "timezone": "Europe/Moscow"
      }
    }
  }'
```

### Notification triggers

| Event | Condition | Notification |
|-------|-----------|-------------|
| PQL Detected (HOT) | Score >= 0.80 | Immediate push + email |
| PQL Detected (WARM) | Score 0.65-0.79 | In-app notification |
| Revenue Attributed | Deal closed in amoCRM | Email summary |
| Integration Error | MCP adapter circuit open | Admin alert |

### View notification log

```bash
curl https://your-domain.ru/api/notifications/log?limit=50 \
  -H "Authorization: Bearer <admin-jwt>"
```
