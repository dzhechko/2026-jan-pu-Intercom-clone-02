-- Migration 006: BC-06 Notification Context
-- Reference: docs/tactical-design.md — Schema: notifications

CREATE TABLE notifications.jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  type          VARCHAR(50) NOT NULL,
  recipient     VARCHAR(255) NOT NULL,
  channel       VARCHAR(20) NOT NULL
                  CHECK (channel IN ('EMAIL','PUSH','BOTH')),
  payload       JSONB NOT NULL DEFAULT '{}',
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','SENT','FAILED')),
  attempts      SMALLINT DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_pending
  ON notifications.jobs(status, created_at)
  WHERE status = 'PENDING';

-- RLS (ADR-007, FF-03)
ALTER TABLE notifications.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notifications ON notifications.jobs
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
