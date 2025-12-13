-- Add event lifecycle helper columns / flags
-- Placeholder migration
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;
