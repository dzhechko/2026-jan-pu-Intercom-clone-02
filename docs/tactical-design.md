# DDD Tactical Design: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04

---

## AGG-01: Dialog (BC-01 Conversation)

```typescript
// AGGREGATE ROOT
class Dialog {
  id: DialogId                    // UUID
  tenantId: TenantId
  channelType: ChannelType        // WEB_CHAT | TELEGRAM | VK_MAX
  externalChannelId: string       // Telegram chat_id / VK peer_id
  status: DialogStatus            // OPEN | ASSIGNED | CLOSED | ARCHIVED
  assignedOperatorId?: OperatorId
  contactEmail?: string           // для Memory AI lookup
  pqlScore?: PQLScore             // денормализация для быстрой очереди
  messages: Message[]             // Value Object collection
  createdAt: DateTime
  updatedAt: DateTime

  // Domain Methods
  assignTo(operator: OperatorId): void        // → DialogAssigned event
  receiveMessage(msg: MessageContent): void   // → MessageReceived event
  markAsPQL(score: PQLScore): void            // → DialogPQLFlagged event
  close(resolution: Resolution): void         // → DialogClosed event
}

// Value Objects
class Message {
  id: MessageId
  direction: Direction            // INBOUND | OUTBOUND
  content: MessageContent         // text | attachment
  senderType: SenderType          // CLIENT | OPERATOR | BOT
  timestamp: DateTime
  pqlSignals?: PQLSignalRef[]     // ссылки на найденные сигналы
}

class PQLScore {
  value: number                   // 0.0 – 1.0
  tier: PQLTier                   // HOT | WARM | COLD
  topSignals: SignalType[]        // top-3 сработавших сигнала
}
```

### Domain Events: Dialog

| Event | Payload | Consumer |
|-------|---------|----------|
| `DialogStarted` | dialogId, tenantId, channel | PQL Intelligence, Notification |
| `MessageReceived` | dialogId, messageId, content | PQL Intelligence |
| `DialogAssigned` | dialogId, operatorId | Notification, WS push |
| `DialogPQLFlagged` | dialogId, pqlScore | Revenue, Notification |
| `DialogClosed` | dialogId, resolution | Revenue |

---

## AGG-02: PQLDetector (BC-02 PQL Intelligence) ⭐ CORE

```typescript
// AGGREGATE ROOT
class PQLDetector {
  id: DetectorId
  tenantId: TenantId
  ruleSet: RuleSet                // кастомные правила клиента
  mlModelRef?: MLModelRef         // ссылка на fine-tuned модель v2
  threshold: PQLThreshold         // min score для флага (default: 0.65)
  stats: DetectorStats            // accuracy, total_detections

  // Domain Methods
  analyze(message: Message, context: MemoryContext): PQLAnalysisResult
  updateRuleSet(rules: SignalRule[]): void     // → RuleSetUpdated
  recordFeedback(signal: PQLFeedback): void   // → FeedbackRecorded (для ML)
}

// Value Object: RuleSet с 15 базовыми сигналами
class RuleSet {
  rules: SignalRule[]

  static DEFAULT_RULES: SignalRule[] = [
    { id: "R01", pattern: /тариф|pricing|стоимость/i,       weight: 0.40, type: "PRICING" },
    { id: "R02", pattern: /enterprise|корпоратив/i,          weight: 0.50, type: "ENTERPRISE" },
    { id: "R03", pattern: /команда|пользователей|seats/i,    weight: 0.35, type: "SCALE" },
    { id: "R04", pattern: /интеграц|api|webhook/i,           weight: 0.30, type: "TECHNICAL" },
    { id: "R05", pattern: /демо|показать|посмотреть/i,       weight: 0.45, type: "DEMO" },
    { id: "R06", pattern: /договор|счёт|оплат/i,             weight: 0.60, type: "PURCHASE" },
    { id: "R07", pattern: /руководитель|директор|ceo|cto/i,  weight: 0.40, type: "DECISION_MAKER" },
    { id: "R08", pattern: /сравни|vs|альтернатив/i,          weight: 0.35, type: "EVALUATION" },
    { id: "R09", pattern: /внедрен|migrate|перейти/i,        weight: 0.45, type: "MIGRATION" },
    { id: "R10", pattern: /sla|uptime|гарантия/i,            weight: 0.30, type: "RELIABILITY" },
    { id: "R11", pattern: /безопасност|152-фз|gdpr/i,        weight: 0.30, type: "COMPLIANCE" },
    { id: "R12", pattern: /пилот|тест|попробова/i,           weight: 0.40, type: "TRIAL" },
    { id: "R13", pattern: /бюджет|квартал|план/i,            weight: 0.45, type: "BUDGET" },
    { id: "R14", pattern: /партнёр|реселл|агент/i,           weight: 0.35, type: "PARTNERSHIP" },
    { id: "R15", pattern: /обучен|onboard|внедр/i,           weight: 0.30, type: "ONBOARDING" },
  ]
}

// Value Object: Memory Context (CRM + RAG)
class MemoryContext {
  contactEmail: string
  crmData?: {
    deals: CRMDeal[]              // открытые сделки из amoCRM MCP
    contacts: CRMContact[]
    lastInteraction?: DateTime
    currentPlan?: string
    accountAge?: number           // дней с регистрации
  }
  ragContext?: string             // relevant KB chunks из Evolution RAG MCP
  enrichmentScore: number         // 0–1, насколько полон контекст
}
```

### Domain Events: PQLDetector

| Event | Payload | Consumer |
|-------|---------|----------|
| `PQLDetected` | dialogId, score, signals, context | Revenue, Notification, WS |
| `PQLFeedbackRecorded` | detectorId, signal, wasCorrect | ML Pipeline |
| `RuleSetUpdated` | tenantId, newRules | PQLDetector (self) |
| `MLModelRetrained` | modelId, accuracy, trainingSize | PQLDetector |

---

## AGG-03: RevenueReport (BC-03 Revenue) ⭐ CORE

```typescript
// AGGREGATE ROOT
class RevenueReport {
  id: ReportId
  tenantId: TenantId
  period: ReportPeriod            // { month, year }
  status: ReportStatus            // DRAFT | GENERATED | SENT
  attributions: PQLAttribution[]
  summary: RevenueSummary

  // Domain Methods
  addAttribution(pql: PQLDeal): void         // → AttributionAdded
  generate(): ReportDocument                 // → ReportGenerated
  markSent(recipients: Email[]): void        // → ReportSent
}

// Value Object: Attribution
class PQLAttribution {
  pqlDialogId: DialogId
  dealId: CRMDealId               // amoCRM deal ID
  dealValue: Money                // ₽
  closedAt: DateTime
  timeToClose: Duration           // от PQL detection до close
  operatorId: OperatorId
  confidence: number              // 0–1 уверенность атрибуции
}

// Value Object: Summary
class RevenueSummary {
  totalDialogs: number
  pqlDetected: number
  pqlConvertedToDeals: number
  pqlConversionRate: number       // %
  totalRevenue: Money             // ₽ атрибутированная выручка
  avgTimeToClose: Duration
  topOperators: OperatorStat[]
}
```

### Domain Events: RevenueReport

| Event | Payload | Consumer |
|-------|---------|----------|
| `PQLDealClosed` | dealId, dialogId, value | RevenueReport |
| `RevenueAttributed` | reportId, attribution | — |
| `ReportGenerated` | reportId, pdfUrl | Notification |
| `ReportSent` | reportId, recipients | — |

---

## AGG-04: Tenant (BC-05 Identity)

```typescript
// AGGREGATE ROOT
class Tenant {
  id: TenantId
  name: string
  plan: SubscriptionPlan          // TRIAL | GROWTH | REVENUE | OUTCOME
  status: TenantStatus            // ACTIVE | SUSPENDED | CHURNED
  operators: OperatorRef[]
  settings: TenantSettings
  billingEmail: string
  createdAt: DateTime

  // Domain Methods
  inviteOperator(email: string, role: Role): void  // → OperatorInvited
  upgradePlan(plan: SubscriptionPlan): void         // → PlanUpgraded
  suspend(): void                                   // → TenantSuspended
}

// Value Object: Settings
class TenantSettings {
  pqlThreshold: number            // override default 0.65
  notifyChannels: NotifyChannel[] // EMAIL | PUSH | BOTH
  crmIntegration?: CRMConfig      // { type: 'AMOCRM' | 'BITRIX24', apiKey: encrypted }
  customBranding?: BrandConfig
}
```

---

## Domain Events — Полная карта

```
BC-01 Conversation              BC-02 PQL Intelligence        BC-03 Revenue
──────────────────              ──────────────────────        ─────────────
DialogStarted ──────────────▶  (subscribes)
MessageReceived ────────────▶  PQLDetector.analyze()
                                       │
                               [amoCRM MCP] ← Memory AI
                               [RAG MCP]   ← KB context
                                       │
                               PQLDetected ─────────────────▶ Attribution.create()
                                       │                              │
                               [WS push → operator]           RevenueAttributed
                               [PQL Pulse notification]               │
                                       │                       ReportGenerated
                               PQLFeedbackRecorded                    │
                                       │                       ReportSent ──▶ [Resend]
                               MLModelRetrained
                               (flywheel ↻)
```

---

## Database Schema: PostgreSQL 16

### Schema: `conversations`

```sql
CREATE TABLE conversations.dialogs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  channel_type  VARCHAR(20) NOT NULL
                  CHECK (channel_type IN ('WEB_CHAT','TELEGRAM','VK_MAX')),
  external_id   VARCHAR(255),
  status        VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','ASSIGNED','CLOSED','ARCHIVED')),
  operator_id   UUID REFERENCES iam.operators(id),
  contact_email VARCHAR(255),
  pql_score     NUMERIC(3,2),
  pql_tier      VARCHAR(10) CHECK (pql_tier IN ('HOT','WARM','COLD')),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dialogs_tenant_status ON conversations.dialogs(tenant_id, status);
CREATE INDEX idx_dialogs_pql_tier ON conversations.dialogs(tenant_id, pql_tier)
  WHERE pql_tier IS NOT NULL;

CREATE TABLE conversations.messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dialog_id     UUID NOT NULL REFERENCES conversations.dialogs(id),
  tenant_id     UUID NOT NULL,
  direction     VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  sender_type   VARCHAR(10) NOT NULL CHECK (sender_type IN ('CLIENT','OPERATOR','BOT')),
  content       TEXT NOT NULL,
  attachments   JSONB DEFAULT '[]',
  pql_signals   JSONB DEFAULT '[]',   -- [{signalId, type, weight}]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_dialog ON conversations.messages(dialog_id);

-- Row Level Security
ALTER TABLE conversations.dialogs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dialogs  ON conversations.dialogs
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation_messages ON conversations.messages
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

### Schema: `pql`

```sql
CREATE TABLE pql.detectors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL UNIQUE REFERENCES iam.tenants(id),
  rule_set      JSONB NOT NULL DEFAULT '[]',
  threshold     NUMERIC(3,2) NOT NULL DEFAULT 0.65,
  ml_model_ref  VARCHAR(255),
  stats         JSONB DEFAULT '{"total": 0, "correct": 0}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pql.detections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  dialog_id     UUID NOT NULL REFERENCES conversations.dialogs(id),
  message_id    UUID NOT NULL REFERENCES conversations.messages(id),
  score         NUMERIC(3,2) NOT NULL,
  tier          VARCHAR(10) NOT NULL,
  signals       JSONB NOT NULL,          -- [{ruleId, type, weight, matched_text}]
  memory_ctx    JSONB DEFAULT '{}',      -- CRM snapshot at detection time
  feedback      VARCHAR(10)              -- CORRECT | INCORRECT | NULL
                  CHECK (feedback IN ('CORRECT','INCORRECT')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_detections_tenant_dialog ON pql.detections(tenant_id, dialog_id);
CREATE INDEX idx_detections_tier ON pql.detections(tenant_id, tier, created_at DESC);

CREATE TABLE pql.ml_training_data (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  message_text  TEXT NOT NULL,
  label         BOOLEAN NOT NULL,       -- true = is PQL
  signals       JSONB,
  model_version VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Schema: `revenue`

```sql
CREATE TABLE revenue.reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  period_month  SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year   SMALLINT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','GENERATED','SENT')),
  summary       JSONB NOT NULL DEFAULT '{}',
  pdf_url       VARCHAR(500),
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, period_month, period_year)
);

CREATE TABLE revenue.attributions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES revenue.reports(id),
  tenant_id         UUID NOT NULL,
  pql_detection_id  UUID NOT NULL REFERENCES pql.detections(id),
  dialog_id         UUID NOT NULL REFERENCES conversations.dialogs(id),
  crm_deal_id       VARCHAR(255) NOT NULL,
  deal_value        NUMERIC(15,2) NOT NULL,
  currency          VARCHAR(3) NOT NULL DEFAULT 'RUB',
  operator_id       UUID REFERENCES iam.operators(id),
  closed_at         TIMESTAMPTZ NOT NULL,
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attributions_tenant_period
  ON revenue.attributions(tenant_id, report_id);
```

### Schema: `iam`

```sql
CREATE TABLE iam.tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  plan          VARCHAR(20) NOT NULL DEFAULT 'TRIAL'
                  CHECK (plan IN ('TRIAL','GROWTH','REVENUE','OUTCOME')),
  status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','CHURNED')),
  settings      JSONB DEFAULT '{}',
  billing_email VARCHAR(255) NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE iam.operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'OPERATOR'
                  CHECK (role IN ('ADMIN','OPERATOR')),
  status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  password_hash VARCHAR(255) NOT NULL,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);
```

### Schema: `notifications`

```sql
CREATE TABLE notifications.jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  type          VARCHAR(50) NOT NULL,   -- PQL_PULSE | REVENUE_REPORT | OPERATOR_INVITE
  recipient     VARCHAR(255) NOT NULL,
  channel       VARCHAR(20) NOT NULL,   -- EMAIL | PUSH | BOTH
  payload       JSONB NOT NULL DEFAULT '{}',
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempts      SMALLINT DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_pending
  ON notifications.jobs(status, created_at)
  WHERE status = 'PENDING';
```

---

## Value Objects Summary

| Value Object | Aggregate | Fields |
|-------------|-----------|--------|
| `Message` | Dialog | id, direction, content, senderType, timestamp, pqlSignals |
| `PQLScore` | Dialog | value(0-1), tier(HOT/WARM/COLD), topSignals |
| `SignalRule` | PQLDetector | id, pattern(regex), weight, type |
| `MemoryContext` | PQLDetector | contactEmail, crmData, ragContext, enrichmentScore |
| `PQLAttribution` | RevenueReport | pqlDialogId, dealId, dealValue, closedAt, confidence |
| `RevenueSummary` | RevenueReport | totalDialogs, pqlDetected, conversionRate, totalRevenue |
| `Money` | RevenueReport | amount(NUMERIC 15,2), currency(RUB) |
| `TenantSettings` | Tenant | pqlThreshold, notifyChannels, crmIntegration, branding |
