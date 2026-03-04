-- Migration 007: FR-10 PQL ML v1 — Feedback collection + adaptive model weights
-- Reference: ADR Progressive AI Enhancement — Phase 2

-- Add top_signals column to detections (used by rule engine but was missing)
ALTER TABLE pql.detections
  ADD COLUMN IF NOT EXISTS top_signals JSONB DEFAULT '[]';

-- Operator feedback on individual detections (richer than the inline feedback column)
CREATE TABLE IF NOT EXISTS pql.detection_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id  UUID NOT NULL REFERENCES pql.detections(id),
  tenant_id     UUID NOT NULL,
  operator_id   UUID NOT NULL REFERENCES iam.operators(id),
  label         VARCHAR(10) NOT NULL CHECK (label IN ('CORRECT','INCORRECT','UNSURE')),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(detection_id, operator_id)
);

CREATE INDEX idx_detection_feedback_tenant ON pql.detection_feedback(tenant_id);
CREATE INDEX idx_detection_feedback_detection ON pql.detection_feedback(detection_id);

-- Repurpose ml_training_data for model weights storage (drop old columns, add new ones)
-- The old schema stored raw training samples; the new one stores per-tenant model weights.
ALTER TABLE pql.ml_training_data
  ADD COLUMN IF NOT EXISTS weights JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS adjustments JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS trained_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sample_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add unique constraint on tenant_id for upsert support
-- (only if not already exists — the detectors table has one, ml_training_data does not)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_training_data_tenant
  ON pql.ml_training_data(tenant_id);

-- RLS for new table
ALTER TABLE pql.detection_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_feedback ON pql.detection_feedback
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
