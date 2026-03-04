-- Migration 004: BC-02 PQL Intelligence Context
-- Reference: docs/tactical-design.md — Schema: pql

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
  tier          VARCHAR(10) NOT NULL CHECK (tier IN ('HOT','WARM','COLD')),
  signals       JSONB NOT NULL,
  memory_ctx    JSONB DEFAULT '{}',
  feedback      VARCHAR(10)
                  CHECK (feedback IN ('CORRECT','INCORRECT')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_detections_tenant_dialog ON pql.detections(tenant_id, dialog_id);
CREATE INDEX idx_detections_tier ON pql.detections(tenant_id, tier, created_at DESC);

CREATE TABLE pql.ml_training_data (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  message_text  TEXT NOT NULL,
  label         BOOLEAN NOT NULL,
  signals       JSONB,
  model_version VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS (ADR-007, FF-03)
ALTER TABLE pql.detectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE pql.detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE pql.ml_training_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_detectors ON pql.detectors
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation_detections ON pql.detections
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation_ml_data ON pql.ml_training_data
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
