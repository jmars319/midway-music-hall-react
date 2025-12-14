-- Adds event_categories table and backfills existing events with system categories.
-- Run with: mysql -uUSER -pPASS midway_music_hall < database/20250305_event_categories.sql

USE midway_music_hall;

CREATE TABLE IF NOT EXISTS event_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(191) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_event_categories_slug (slug)
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS category_id INT DEFAULT NULL AFTER category_tags;

ALTER TABLE events
  ADD INDEX IF NOT EXISTS idx_events_category (category_id);

DROP PROCEDURE IF EXISTS add_fk_events_category;
DELIMITER $$
CREATE PROCEDURE add_fk_events_category()
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = DATABASE()
          AND table_name = 'events'
          AND constraint_name = 'fk_events_category'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT fk_events_category FOREIGN KEY (category_id) REFERENCES event_categories(id) ON DELETE SET NULL;
    END IF;
END$$
DELIMITER ;
CALL add_fk_events_category();
DROP PROCEDURE IF EXISTS add_fk_events_category;

INSERT INTO event_categories (slug, name, is_active, is_system)
VALUES
    ('normal', 'Normal', 1, 1),
    ('recurring', 'Recurring', 1, 1),
    ('beach-bands', 'Beach Bands', 1, 1),
    ('lessons', 'Lessons', 1, 1)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    is_system = VALUES(is_system),
    is_active = 1;

-- Beach Music Series (2026) slugs
UPDATE events e
JOIN event_categories c ON c.slug = 'beach-bands'
SET e.category_id = c.id
WHERE e.slug IN (
    'the-embers-20260125',
    'special-occasion-band-20260215',
    'gary-lowder-and-smokin-hot-20260315',
    'the-entertainers-20260419',
    'the-catalinas-20260503',
    'jim-quick-and-coastline-20260920',
    'too-much-sylvia-20261018',
    'band-of-oz-20261115'
)
AND (e.category_id IS NULL OR e.category_id = c.id);

-- Recurring masters + generated occurrences
UPDATE events e
JOIN event_categories c ON c.slug = 'recurring'
SET e.category_id = c.id
WHERE (e.series_master_id IS NOT NULL OR e.is_series_master = 1)
  AND (e.category_id IS NULL OR e.category_id = c.id);

-- Default all other events to Normal
UPDATE events e
JOIN event_categories c ON c.slug = 'normal'
SET e.category_id = c.id
WHERE e.category_id IS NULL;
