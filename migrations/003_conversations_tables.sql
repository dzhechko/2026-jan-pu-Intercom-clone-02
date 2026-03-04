-- Migration 003: BC-01 Conversation Context
-- Reference: docs/tactical-design.md — Schema: conversations

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
  pql_signals   JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_dialog ON conversations.messages(dialog_id);

-- RLS (ADR-007, FF-03)
ALTER TABLE conversations.dialogs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dialogs ON conversations.dialogs
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation_messages ON conversations.messages
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
