-- Content compatibility backfill for recurring series cards and lessons content.
-- Run after database/20251212_schema_upgrade.sql.
-- This script only fills missing data; it does not overwrite admin-managed content.

USE midway_music_hall;

-- Preserve public lessons content when legacy installs relied on runtime defaults.
INSERT INTO business_settings (setting_key, setting_value)
VALUES (
  'lessons_json',
  '[
    {
      "id": "line-all-levels",
      "title": "Line Dance Lessons - All Skill Levels",
      "schedule": "Mondays · 5:30 – 7:30 PM",
      "price": "$7 / person",
      "instructor": "Jackie Phillips",
      "phone": "727-776-1555",
      "description": "High-energy session covering foundations plus new choreography each week."
    },
    {
      "id": "line-seniors",
      "title": "Line Dance Lessons - 55+ Beginner",
      "schedule": "Wednesdays · 11:00 AM – Noon",
      "price": "$7 / person",
      "instructor": "Brenda Holcomb",
      "phone": "336-816-5544",
      "description": "Gentle pacing for beginners and seniors who want to get comfortable on the floor."
    },
    {
      "id": "shag-all-levels",
      "title": "Shag Dance Lessons - All Levels",
      "schedule": "Tuesdays · 6:30 PM",
      "price": "$12 / person",
      "instructor": "Vickie Chambers",
      "phone": "336-989-0156",
      "description": "Classic beach music shag instruction with individualized coaching."
    }
  ]'
)
ON DUPLICATE KEY UPDATE
  setting_value = CASE
    WHEN setting_value IS NULL OR TRIM(setting_value) = '' OR JSON_VALID(setting_value) = 0
      THEN VALUES(setting_value)
    ELSE setting_value
  END;

-- Preserve legacy recurring homepage card copy for installs that never saved explicit series metadata.
DROP TEMPORARY TABLE IF EXISTS tmp_legacy_series_meta_backfill;

CREATE TEMPORARY TABLE tmp_legacy_series_meta_backfill AS
SELECT
  e.id AS event_id,
  CASE
    WHEN LOWER(CONCAT_WS(' ', COALESCE(e.title, ''), COALESCE(e.artist_name, ''))) REGEXP 'jam session'
      THEN 'Recurring evening jam · 6:00 – 10:00 PM'
    WHEN LOWER(CONCAT_WS(' ', COALESCE(e.title, ''), COALESCE(e.artist_name, ''))) REGEXP 'dancin''? dan|friday night dj|dj dan'
      THEN 'Recurring dance party · 6:00 – 10:00 PM'
    WHEN LOWER(CONCAT_WS(' ', COALESCE(e.title, ''), COALESCE(e.artist_name, ''))) REGEXP 'cruise[- ]?in|cruise in'
      THEN 'Monthly Cruise-In'
    ELSE NULL
  END AS schedule_label,
  CASE
    WHEN LOWER(CONCAT_WS(' ', COALESCE(e.title, ''), COALESCE(e.artist_name, ''))) REGEXP 'jam session'
      THEN 'Open community jam hosted by local musicians.'
    WHEN LOWER(CONCAT_WS(' ', COALESCE(e.title, ''), COALESCE(e.artist_name, ''))) REGEXP 'dancin''? dan|friday night dj|dj dan'
      THEN 'Dance party with Dancin’ Dan.'
    WHEN LOWER(CONCAT_WS(' ', COALESCE(e.title, ''), COALESCE(e.artist_name, ''))) REGEXP 'cruise[- ]?in|cruise in'
      THEN 'Classic cars, vendors, and community hangouts.'
    ELSE NULL
  END AS summary
FROM events e
LEFT JOIN event_categories ec ON ec.id = e.category_id
WHERE
  LOWER(CONCAT_WS(' ', COALESCE(e.title, ''), COALESCE(e.artist_name, ''))) REGEXP 'jam session|dancin''? dan|friday night dj|dj dan|cruise[- ]?in|cruise in'
  AND (
    COALESCE(e.is_series_master, 0) = 1
    OR e.series_master_id IS NOT NULL
    OR LOWER(COALESCE(ec.slug, '')) = 'recurring'
  );

UPDATE event_series_meta esm
JOIN tmp_legacy_series_meta_backfill src ON src.event_id = esm.event_id
SET
  esm.schedule_label = CASE
    WHEN TRIM(COALESCE(esm.schedule_label, '')) = '' THEN src.schedule_label
    ELSE esm.schedule_label
  END,
  esm.summary = CASE
    WHEN TRIM(COALESCE(esm.summary, '')) = '' THEN src.summary
    ELSE esm.summary
  END,
  esm.updated_by = CASE
    WHEN TRIM(COALESCE(esm.schedule_label, '')) = '' OR TRIM(COALESCE(esm.summary, '')) = ''
      THEN 'content-backfill'
    ELSE esm.updated_by
  END,
  esm.updated_at = CASE
    WHEN TRIM(COALESCE(esm.schedule_label, '')) = '' OR TRIM(COALESCE(esm.summary, '')) = ''
      THEN CURRENT_TIMESTAMP
    ELSE esm.updated_at
  END
WHERE
  src.schedule_label IS NOT NULL
  AND src.summary IS NOT NULL
  AND (
    TRIM(COALESCE(esm.schedule_label, '')) = ''
    OR TRIM(COALESCE(esm.summary, '')) = ''
  );

INSERT INTO event_series_meta (event_id, schedule_label, summary, footer_note, created_by, updated_by)
SELECT
  src.event_id,
  src.schedule_label,
  src.summary,
  NULL,
  'content-backfill',
  'content-backfill'
FROM tmp_legacy_series_meta_backfill src
LEFT JOIN event_series_meta esm ON esm.event_id = src.event_id
WHERE esm.event_id IS NULL
  AND src.schedule_label IS NOT NULL
  AND src.summary IS NOT NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_legacy_series_meta_backfill;
