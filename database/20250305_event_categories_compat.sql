-- Compatible migration for adding event_categories table and assigning defaults.
-- Uses helper procedures to avoid duplicate column/index errors.

USE midway_music_hall;
SET @TARGET_DB = DATABASE();

DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE add_column_if_missing(
    IN in_schema VARCHAR(64),
    IN in_table VARCHAR(64),
    IN in_column VARCHAR(64),
    IN column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = in_schema
          AND table_name = in_table
          AND column_name = in_column
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', in_schema, '`.`', in_table, '` ADD COLUMN ', column_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS add_index_if_missing;
DELIMITER $$
CREATE PROCEDURE add_index_if_missing(
    IN in_schema VARCHAR(64),
    IN in_table VARCHAR(64),
    IN in_index VARCHAR(64),
    IN index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.statistics
        WHERE table_schema = in_schema
          AND table_name = in_table
          AND index_name = in_index
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', in_schema, '`.`', in_table, '` ', index_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS add_constraint_if_missing;
DELIMITER $$
CREATE PROCEDURE add_constraint_if_missing(
    IN in_schema VARCHAR(64),
    IN in_table VARCHAR(64),
    IN in_constraint VARCHAR(64),
    IN constraint_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = in_schema
          AND table_name = in_table
          AND constraint_name = in_constraint
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', in_schema, '`.`', in_table, '` ', constraint_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

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

CALL add_column_if_missing(@TARGET_DB, 'events', 'category_id', 'category_id INT DEFAULT NULL AFTER category_tags');
CALL add_index_if_missing(@TARGET_DB, 'events', 'idx_events_category', 'ADD INDEX idx_events_category (category_id)');
CALL add_constraint_if_missing(@TARGET_DB, 'events', 'fk_events_category', 'ADD CONSTRAINT fk_events_category FOREIGN KEY (category_id) REFERENCES event_categories(id) ON DELETE SET NULL');

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

UPDATE events e
JOIN event_categories c ON c.slug = 'recurring'
SET e.category_id = c.id
WHERE (e.series_master_id IS NOT NULL OR e.is_series_master = 1)
  AND (e.category_id IS NULL OR e.category_id = c.id);

UPDATE events e
JOIN event_categories c ON c.slug = 'normal'
SET e.category_id = c.id
WHERE e.category_id IS NULL;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
DROP PROCEDURE IF EXISTS add_constraint_if_missing;
