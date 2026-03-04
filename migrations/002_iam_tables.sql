-- Migration 002: BC-05 Identity & Access Management
-- Reference: docs/tactical-design.md — Schema: iam

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

-- RLS for operators (ADR-007, FF-03)
ALTER TABLE iam.operators ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_operators ON iam.operators
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
