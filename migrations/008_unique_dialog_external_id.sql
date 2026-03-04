-- Migration 008: Add UNIQUE constraint on (tenant_id, external_id) for dialogs
-- Prevents race condition creating duplicate dialogs for same channel session
-- Reference: FR-05/FR-09 review findings

CREATE UNIQUE INDEX idx_dialogs_tenant_external_id
  ON conversations.dialogs (tenant_id, external_id)
  WHERE external_id IS NOT NULL;
