-- Optional one-time backfill for legacy single-day events.
-- Run only after database/20251212_schema_upgrade.sql has created event_occurrences.
-- This seeds one occurrence row for any non-deleted event that still relies only on
-- the legacy scalar schedule fields.

WITH legacy_events AS (
  SELECT
    e.id,
    e.event_date,
    e.event_time,
    e.end_datetime,
    e.door_time,
    COALESCE(
      e.start_datetime,
      CASE
        WHEN e.event_date IS NOT NULL THEN STR_TO_DATE(
          CONCAT(e.event_date, ' ', COALESCE(TIME_FORMAT(e.event_time, '%H:%i:%s'), '18:00:00')),
          '%Y-%m-%d %H:%i:%s'
        )
        ELSE NULL
      END
    ) AS canonical_start
  FROM events e
  WHERE e.deleted_at IS NULL
)
INSERT INTO event_occurrences (
  event_id,
  occurrence_date,
  start_time,
  start_datetime,
  end_datetime,
  door_datetime,
  sort_order
)
SELECT
  le.id,
  COALESCE(le.event_date, DATE(COALESCE(le.canonical_start, le.end_datetime))),
  COALESCE(le.event_time, TIME(COALESCE(le.canonical_start, le.end_datetime)), '18:00:00'),
  le.canonical_start,
  COALESCE(le.end_datetime, DATE_ADD(le.canonical_start, INTERVAL 4 HOUR)),
  le.door_time,
  0
FROM legacy_events le
LEFT JOIN event_occurrences eo
  ON eo.event_id = le.id
 AND eo.start_datetime = le.canonical_start
WHERE eo.id IS NULL
  AND le.canonical_start IS NOT NULL;
