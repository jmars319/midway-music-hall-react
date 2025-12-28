-- DEPRECATED MIGRATION
-- Retained for historical reference only.
-- Do NOT run in new deployments.
-- Canonical schema is maintained via non-deprecated migrations.

-- Adds archive metadata for events.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL AFTER status;

CREATE INDEX IF NOT EXISTS idx_events_archived_at ON events (archived_at);

-- Backfill existing rows that were using status='archived'.
UPDATE events
SET archived_at = COALESCE(archived_at, NOW())
WHERE status = 'archived' AND archived_at IS NULL;
