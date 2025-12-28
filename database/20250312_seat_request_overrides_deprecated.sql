-- DEPRECATED MIGRATION
-- Retained for historical reference only.
-- Do NOT run in new deployments.
-- Canonical schema is maintained via non-deprecated migrations.

-- Adds per-category and per-event seat request routing overrides.
-- Run with: mysql -uUSER -pPASS midway_music_hall < database/20250312_seat_request_overrides.sql

USE midway_music_hall;

ALTER TABLE event_categories
  ADD COLUMN IF NOT EXISTS seat_request_email_to VARCHAR(255) DEFAULT NULL AFTER is_system;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS seat_request_email_override VARCHAR(255) DEFAULT NULL AFTER contact_email;
