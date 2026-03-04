-- Migration 005: BC-03 Revenue Context
-- Reference: docs/tactical-design.md — Schema: revenue

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

-- RLS (ADR-007, FF-03)
ALTER TABLE revenue.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue.attributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_reports ON revenue.reports
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation_attributions ON revenue.attributions
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
