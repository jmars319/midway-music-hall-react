-- MySQL 8/9 compatible schema upgrade for Midway Music Hall
-- Uses helper procedures to only add columns, indexes, and constraints that are missing.
-- Run after selecting the target database (this script assumes DATABASE() is midway_music_hall).

USE midway_music_hall;
SET @TARGET_DB = DATABASE();

-- Helper: add column if it does not exist
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

-- Helper: add index (or unique index) if it does not exist
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

-- Helper: add foreign key constraint if it does not exist.
-- Compatibility note: we check both constraint-name AND an equivalent FK relationship
-- (single-column FKs) so older DBs with different FK names do not error.
DROP PROCEDURE IF EXISTS add_constraint_if_missing;
DELIMITER $$
CREATE PROCEDURE add_constraint_if_missing(
    IN in_schema VARCHAR(64),
    IN in_table VARCHAR(64),
    IN in_constraint VARCHAR(64),
    IN in_column VARCHAR(64),
    IN in_ref_table VARCHAR(64),
    IN in_ref_column VARCHAR(64),
    IN constraint_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.table_schema = in_schema
          AND tc.table_name = in_table
          AND tc.constraint_name = in_constraint
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.key_column_usage kcu
        WHERE kcu.table_schema = in_schema
          AND kcu.table_name = in_table
          AND kcu.referenced_table_name = in_ref_table
          AND kcu.column_name = in_column
          AND kcu.referenced_column_name = in_ref_column
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', in_schema, '`.`', in_table, '` ', constraint_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

-- MEDIA TABLE ENHANCEMENTS
CALL add_column_if_missing(@TARGET_DB, 'media', 'width', 'width INT DEFAULT NULL AFTER file_size');
CALL add_column_if_missing(@TARGET_DB, 'media', 'height', 'height INT DEFAULT NULL AFTER width');
CALL add_column_if_missing(@TARGET_DB, 'media', 'checksum', 'checksum CHAR(64) DEFAULT NULL AFTER height');
CALL add_column_if_missing(@TARGET_DB, 'media', 'optimized_path', 'optimized_path VARCHAR(500) DEFAULT NULL AFTER caption');
CALL add_column_if_missing(@TARGET_DB, 'media', 'webp_path', 'webp_path VARCHAR(500) DEFAULT NULL AFTER optimized_path');
CALL add_column_if_missing(@TARGET_DB, 'media', 'optimization_status', 'optimization_status ENUM(''pending'',''processing'',''complete'',''skipped'',''failed'') DEFAULT ''pending'' AFTER webp_path');
CALL add_column_if_missing(@TARGET_DB, 'media', 'processing_notes', 'processing_notes TEXT AFTER optimization_status');

CALL add_column_if_missing(@TARGET_DB, 'seating_layouts', 'stage_position', 'stage_position JSON DEFAULT NULL AFTER layout_data');
CALL add_column_if_missing(@TARGET_DB, 'seating_layouts', 'stage_size', 'stage_size JSON DEFAULT NULL AFTER stage_position');
CALL add_column_if_missing(@TARGET_DB, 'seating_layouts', 'canvas_settings', 'canvas_settings JSON DEFAULT NULL AFTER stage_size');

-- PAYMENT SETTINGS TABLE
CREATE TABLE IF NOT EXISTS payment_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('global','category') NOT NULL DEFAULT 'category',
  category_id INT DEFAULT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  provider_label VARCHAR(191) DEFAULT NULL,
  payment_url VARCHAR(500) DEFAULT NULL,
  button_text VARCHAR(191) DEFAULT 'Pay Online',
  limit_seats INT NOT NULL DEFAULT 2,
  over_limit_message TEXT,
  fine_print TEXT,
  created_by VARCHAR(191) DEFAULT NULL,
  updated_by VARCHAR(191) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_payment_category (category_id),
  KEY idx_payment_scope (scope)
);

CALL add_constraint_if_missing(@TARGET_DB, 'payment_settings', 'fk_payment_category', 'category_id', 'event_categories', 'id', 'ADD CONSTRAINT fk_payment_category FOREIGN KEY (category_id) REFERENCES event_categories(id) ON DELETE CASCADE');

-- VERSIONED LAYOUT SNAPSHOTS
CREATE TABLE IF NOT EXISTS seating_layout_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  layout_id INT NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  version_label VARCHAR(100) DEFAULT NULL,
  layout_data JSON NOT NULL,
  stage_position JSON DEFAULT NULL,
  stage_size JSON DEFAULT NULL,
  canvas_settings JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(191) DEFAULT NULL,
  change_note VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_layout_versions_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_layout_version (layout_id, version_number)
);

-- Ensure any newer layout version columns exist even if the table was created earlier (safe no-ops)
CALL add_column_if_missing(@TARGET_DB, 'seating_layout_versions', 'stage_position', 'stage_position JSON DEFAULT NULL AFTER layout_data');
CALL add_column_if_missing(@TARGET_DB, 'seating_layout_versions', 'stage_size', 'stage_size JSON DEFAULT NULL AFTER stage_position');
CALL add_column_if_missing(@TARGET_DB, 'seating_layout_versions', 'canvas_settings', 'canvas_settings JSON DEFAULT NULL AFTER stage_size');

-- EVENTS TABLE EXTENSIONS
CALL add_column_if_missing(@TARGET_DB, 'events', 'artist_name', 'artist_name VARCHAR(255) NOT NULL DEFAULT '''' AFTER id');
CALL add_column_if_missing(@TARGET_DB, 'events', 'title', 'title VARCHAR(255) DEFAULT NULL AFTER artist_name');
CALL add_column_if_missing(@TARGET_DB, 'events', 'slug', 'slug VARCHAR(255) DEFAULT NULL AFTER title');
CALL add_column_if_missing(@TARGET_DB, 'events', 'description', 'description TEXT AFTER slug');
CALL add_column_if_missing(@TARGET_DB, 'events', 'notes', 'notes TEXT AFTER description');
CALL add_column_if_missing(@TARGET_DB, 'events', 'genre', 'genre VARCHAR(100) DEFAULT NULL AFTER notes');
CALL add_column_if_missing(@TARGET_DB, 'events', 'category_tags', 'category_tags JSON DEFAULT NULL AFTER genre');
CALL add_column_if_missing(@TARGET_DB, 'events', 'image_url', 'image_url VARCHAR(500) DEFAULT NULL AFTER category_tags');
CALL add_column_if_missing(@TARGET_DB, 'events', 'hero_image_id', 'hero_image_id INT DEFAULT NULL AFTER image_url');
CALL add_column_if_missing(@TARGET_DB, 'events', 'poster_image_id', 'poster_image_id INT DEFAULT NULL AFTER hero_image_id');
CALL add_column_if_missing(@TARGET_DB, 'events', 'ticket_price', 'ticket_price DECIMAL(10,2) DEFAULT NULL AFTER poster_image_id');
CALL add_column_if_missing(@TARGET_DB, 'events', 'door_price', 'door_price DECIMAL(10,2) DEFAULT NULL AFTER ticket_price');
CALL add_column_if_missing(@TARGET_DB, 'events', 'min_ticket_price', 'min_ticket_price DECIMAL(10,2) DEFAULT NULL AFTER door_price');
CALL add_column_if_missing(@TARGET_DB, 'events', 'max_ticket_price', 'max_ticket_price DECIMAL(10,2) DEFAULT NULL AFTER min_ticket_price');
CALL add_column_if_missing(@TARGET_DB, 'events', 'ticket_type', 'ticket_type ENUM(''general_admission'',''reserved_seating'',''hybrid'') DEFAULT ''general_admission'' AFTER max_ticket_price');
CALL add_column_if_missing(@TARGET_DB, 'events', 'seating_enabled', 'seating_enabled TINYINT(1) DEFAULT 0 AFTER ticket_type');
CALL add_column_if_missing(@TARGET_DB, 'events', 'venue_code', 'venue_code ENUM(''MMH'',''TGP'') DEFAULT ''MMH'' AFTER seating_enabled');
CALL add_column_if_missing(@TARGET_DB, 'events', 'venue_section', 'venue_section VARCHAR(100) DEFAULT NULL AFTER venue_code');
CALL add_column_if_missing(@TARGET_DB, 'events', 'timezone', 'timezone VARCHAR(64) DEFAULT ''America/New_York'' AFTER venue_section');
CALL add_column_if_missing(@TARGET_DB, 'events', 'start_datetime', 'start_datetime DATETIME AFTER timezone');
CALL add_column_if_missing(@TARGET_DB, 'events', 'end_datetime', 'end_datetime DATETIME AFTER start_datetime');
CALL add_column_if_missing(@TARGET_DB, 'events', 'door_time', 'door_time DATETIME DEFAULT NULL AFTER end_datetime');
CALL add_column_if_missing(@TARGET_DB, 'events', 'event_date', 'event_date DATE DEFAULT NULL AFTER door_time');
CALL add_column_if_missing(@TARGET_DB, 'events', 'event_time', 'event_time TIME DEFAULT NULL AFTER event_date');
CALL add_column_if_missing(@TARGET_DB, 'events', 'age_restriction', 'age_restriction VARCHAR(50) DEFAULT ''All Ages'' AFTER event_time');
CALL add_column_if_missing(@TARGET_DB, 'events', 'status', 'status ENUM(''draft'',''published'',''archived'') DEFAULT ''draft'' AFTER age_restriction');
CALL add_column_if_missing(@TARGET_DB, 'events', 'visibility', 'visibility ENUM(''public'',''private'') DEFAULT ''public'' AFTER status');
CALL add_column_if_missing(@TARGET_DB, 'events', 'publish_at', 'publish_at DATETIME DEFAULT NULL AFTER visibility');
CALL add_column_if_missing(@TARGET_DB, 'events', 'layout_id', 'layout_id INT DEFAULT NULL AFTER publish_at');
CALL add_column_if_missing(@TARGET_DB, 'events', 'layout_version_id', 'layout_version_id BIGINT DEFAULT NULL AFTER layout_id');
CALL add_column_if_missing(@TARGET_DB, 'events', 'series_master_id', 'series_master_id INT DEFAULT NULL AFTER layout_version_id');
CALL add_column_if_missing(@TARGET_DB, 'events', 'is_series_master', 'is_series_master TINYINT(1) DEFAULT 0 AFTER series_master_id');
CALL add_column_if_missing(@TARGET_DB, 'events', 'ticket_url', 'ticket_url VARCHAR(500) DEFAULT NULL AFTER is_series_master');
CALL add_column_if_missing(@TARGET_DB, 'events', 'contact_name', 'contact_name VARCHAR(255) DEFAULT NULL AFTER ticket_url');
CALL add_column_if_missing(@TARGET_DB, 'events', 'contact_phone_raw', 'contact_phone_raw VARCHAR(50) DEFAULT NULL AFTER contact_name');
CALL add_column_if_missing(@TARGET_DB, 'events', 'contact_phone_normalized', 'contact_phone_normalized VARCHAR(20) DEFAULT NULL AFTER contact_phone_raw');
CALL add_column_if_missing(@TARGET_DB, 'events', 'contact_email', 'contact_email VARCHAR(255) DEFAULT NULL AFTER contact_phone_normalized');
CALL add_column_if_missing(@TARGET_DB, 'events', 'contact_notes', 'contact_notes TEXT DEFAULT NULL AFTER contact_email');
CALL add_column_if_missing(@TARGET_DB, 'events', 'payment_enabled', 'payment_enabled TINYINT(1) DEFAULT 0 AFTER contact_notes');
CALL add_column_if_missing(@TARGET_DB, 'events', 'change_note', 'change_note VARCHAR(255) DEFAULT NULL AFTER payment_enabled');
CALL add_column_if_missing(@TARGET_DB, 'events', 'created_by', 'created_by VARCHAR(191) DEFAULT NULL AFTER change_note');
CALL add_column_if_missing(@TARGET_DB, 'events', 'updated_by', 'updated_by VARCHAR(191) DEFAULT NULL AFTER created_by');
CALL add_column_if_missing(@TARGET_DB, 'events', 'created_at', 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER updated_by');
CALL add_column_if_missing(@TARGET_DB, 'events', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
CALL add_column_if_missing(@TARGET_DB, 'events', 'deleted_at', 'deleted_at DATETIME DEFAULT NULL AFTER updated_at');

CALL add_index_if_missing(@TARGET_DB, 'events', 'idx_events_start', 'ADD INDEX idx_events_start (start_datetime)');
CALL add_index_if_missing(@TARGET_DB, 'events', 'idx_events_status', 'ADD INDEX idx_events_status (status)');
CALL add_index_if_missing(@TARGET_DB, 'events', 'idx_events_venue', 'ADD INDEX idx_events_venue (venue_code)');
CALL add_index_if_missing(@TARGET_DB, 'events', 'idx_events_slug', 'ADD UNIQUE INDEX idx_events_slug (slug)');

CALL add_constraint_if_missing(@TARGET_DB, 'events', 'fk_events_layout', 'layout_id', 'seating_layouts', 'id', 'ADD CONSTRAINT fk_events_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE SET NULL');
CALL add_constraint_if_missing(@TARGET_DB, 'events', 'fk_events_layout_version', 'layout_version_id', 'seating_layout_versions', 'id', 'ADD CONSTRAINT fk_events_layout_version FOREIGN KEY (layout_version_id) REFERENCES seating_layout_versions(id) ON DELETE SET NULL');
CALL add_constraint_if_missing(@TARGET_DB, 'events', 'fk_events_series_master', 'series_master_id', 'events', 'id', 'ADD CONSTRAINT fk_events_series_master FOREIGN KEY (series_master_id) REFERENCES events(id) ON DELETE SET NULL');
CALL add_constraint_if_missing(@TARGET_DB, 'events', 'fk_events_hero_media', 'hero_image_id', 'media', 'id', 'ADD CONSTRAINT fk_events_hero_media FOREIGN KEY (hero_image_id) REFERENCES media(id) ON DELETE SET NULL');
CALL add_constraint_if_missing(@TARGET_DB, 'events', 'fk_events_poster_media', 'poster_image_id', 'media', 'id', 'ADD CONSTRAINT fk_events_poster_media FOREIGN KEY (poster_image_id) REFERENCES media(id) ON DELETE SET NULL');

CREATE TABLE IF NOT EXISTS event_series_meta (
  event_id INT PRIMARY KEY,
  schedule_label VARCHAR(255) DEFAULT NULL,
  summary TEXT,
  footer_note TEXT,
  created_by VARCHAR(191) DEFAULT NULL,
  updated_by VARCHAR(191) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_series_meta_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- RECURRENCE TABLES
CREATE TABLE IF NOT EXISTS event_recurrence_rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  frequency ENUM('daily','weekly','monthly','yearly','custom') NOT NULL DEFAULT 'weekly',
  `interval` INT NOT NULL DEFAULT 1,
  byweekday VARCHAR(50) DEFAULT NULL,
  bymonthday VARCHAR(50) DEFAULT NULL,
  bysetpos VARCHAR(50) DEFAULT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE DEFAULT NULL,
  occurrence_count INT DEFAULT NULL,
  timezone VARCHAR(64) DEFAULT 'America/New_York',
  rule_payload JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by VARCHAR(191) DEFAULT NULL,
  updated_by VARCHAR(191) DEFAULT NULL,
  change_note VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_recurrence_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'frequency', 'frequency ENUM(''daily'',''weekly'',''monthly'',''yearly'',''custom'') NOT NULL DEFAULT ''weekly''');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'interval', '`interval` INT NOT NULL DEFAULT 1');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'byweekday', 'byweekday VARCHAR(50) DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'bymonthday', 'bymonthday VARCHAR(50) DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'bysetpos', 'bysetpos VARCHAR(50) DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'starts_on', 'starts_on DATE NOT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'ends_on', 'ends_on DATE DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'occurrence_count', 'occurrence_count INT DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'timezone', 'timezone VARCHAR(64) DEFAULT ''America/New_York''');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'rule_payload', 'rule_payload JSON DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'created_at', 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'created_by', 'created_by VARCHAR(191) DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'updated_by', 'updated_by VARCHAR(191) DEFAULT NULL');
CALL add_column_if_missing(@TARGET_DB, 'event_recurrence_rules', 'change_note', 'change_note VARCHAR(255) DEFAULT NULL');

CREATE TABLE IF NOT EXISTS event_recurrence_exceptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  recurrence_id BIGINT NOT NULL,
  exception_date DATE NOT NULL,
  exception_type ENUM('skip','override') DEFAULT 'skip',
  override_payload JSON DEFAULT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(191) DEFAULT NULL,
  UNIQUE KEY uniq_recurrence_exception (recurrence_id, exception_date),
  CONSTRAINT fk_recurrence_exception FOREIGN KEY (recurrence_id) REFERENCES event_recurrence_rules(id) ON DELETE CASCADE
);

-- SEATING TABLE UPDATES
CALL add_column_if_missing(@TARGET_DB, 'seating', 'layout_id', 'layout_id INT DEFAULT NULL AFTER event_id');
CALL add_column_if_missing(@TARGET_DB, 'seating', 'table_shape', 'table_shape VARCHAR(50) DEFAULT ''table-6'' AFTER seat_type');
CALL add_column_if_missing(@TARGET_DB, 'seating', 'created_at', 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status');
CALL add_column_if_missing(@TARGET_DB, 'seating', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');

CALL add_index_if_missing(@TARGET_DB, 'seating', 'idx_seating_layout', 'ADD INDEX idx_seating_layout (layout_id)');
CALL add_index_if_missing(@TARGET_DB, 'seating', 'idx_seating_event', 'ADD INDEX idx_seating_event (event_id)');

CALL add_constraint_if_missing(@TARGET_DB, 'seating', 'fk_seating_event', 'event_id', 'events', 'id', 'ADD CONSTRAINT fk_seating_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL');
CALL add_constraint_if_missing(@TARGET_DB, 'seating', 'fk_seating_layout', 'layout_id', 'seating_layouts', 'id', 'ADD CONSTRAINT fk_seating_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE SET NULL');

-- SEAT REQUESTS TABLE UPDATES
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'layout_version_id', 'layout_version_id BIGINT DEFAULT NULL AFTER event_id');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'seat_map_snapshot', 'seat_map_snapshot JSON DEFAULT NULL AFTER layout_version_id');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'customer_phone_normalized', 'customer_phone_normalized VARCHAR(20) DEFAULT NULL AFTER customer_phone');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'total_seats', 'total_seats INT DEFAULT 0 AFTER selected_seats');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'special_requests', 'special_requests TEXT AFTER total_seats');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'hold_expires_at', 'hold_expires_at DATETIME DEFAULT NULL AFTER status');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'finalized_at', 'finalized_at DATETIME DEFAULT NULL AFTER hold_expires_at');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'cutoff_override', 'cutoff_override TINYINT(1) DEFAULT 0 AFTER finalized_at');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'staff_notes', 'staff_notes TEXT AFTER cutoff_override');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'change_note', 'change_note VARCHAR(255) DEFAULT NULL AFTER staff_notes');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'created_by', 'created_by VARCHAR(191) DEFAULT NULL AFTER change_note');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'updated_by', 'updated_by VARCHAR(191) DEFAULT NULL AFTER created_by');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'created_at', 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER updated_by');
CALL add_column_if_missing(@TARGET_DB, 'seat_requests', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');

ALTER TABLE seat_requests
  MODIFY COLUMN status ENUM(
    'new',
    'contacted',
    'waiting',
    'confirmed',
    'declined',
    'closed',
    'spam',
    'expired',
    'hold',
    'pending',
    'approved',
    'denied',
    'finalized',
    'cancelled'
  ) DEFAULT 'new';

CALL add_index_if_missing(@TARGET_DB, 'seat_requests', 'idx_seat_requests_event', 'ADD INDEX idx_seat_requests_event (event_id)');
CALL add_index_if_missing(@TARGET_DB, 'seat_requests', 'idx_seat_requests_hold', 'ADD INDEX idx_seat_requests_hold (hold_expires_at)');

CALL add_constraint_if_missing(@TARGET_DB, 'seat_requests', 'fk_seat_requests_event', 'event_id', 'events', 'id', 'ADD CONSTRAINT fk_seat_requests_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL');
CALL add_constraint_if_missing(@TARGET_DB, 'seat_requests', 'fk_seat_requests_layout_version', 'layout_version_id', 'seating_layout_versions', 'id', 'ADD CONSTRAINT fk_seat_requests_layout_version FOREIGN KEY (layout_version_id) REFERENCES seating_layout_versions(id) ON DELETE SET NULL');
CALL add_constraint_if_missing(@TARGET_DB, 'seating_layout_versions', 'fk_layout_versions_layout', 'layout_id', 'seating_layouts', 'id', 'ADD CONSTRAINT fk_layout_versions_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE CASCADE');
CALL add_constraint_if_missing(@TARGET_DB, 'event_series_meta', 'fk_series_meta_event', 'event_id', 'events', 'id', 'ADD CONSTRAINT fk_series_meta_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE');
CREATE TABLE IF NOT EXISTS event_seating_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  layout_id INT DEFAULT NULL,
  layout_version_id BIGINT DEFAULT NULL,
  snapshot_type ENUM('pre_layout_change','manual','pre_disable') NOT NULL DEFAULT 'pre_layout_change',
  reserved_seats JSON NOT NULL,
  pending_seats JSON DEFAULT NULL,
  hold_seats JSON DEFAULT NULL,
  notes VARCHAR(255) DEFAULT NULL,
  created_by VARCHAR(191) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_seating_snapshot_event (event_id, created_at),
  CONSTRAINT fk_event_snapshot_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CALL add_constraint_if_missing(@TARGET_DB, 'event_recurrence_rules', 'fk_recurrence_event', 'event_id', 'events', 'id', 'ADD CONSTRAINT fk_recurrence_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE');
CALL add_constraint_if_missing(@TARGET_DB, 'event_recurrence_exceptions', 'fk_recurrence_exception', 'recurrence_id', 'event_recurrence_rules', 'id', 'ADD CONSTRAINT fk_recurrence_exception FOREIGN KEY (recurrence_id) REFERENCES event_recurrence_rules(id) ON DELETE CASCADE');
CALL add_constraint_if_missing(@TARGET_DB, 'event_seating_snapshots', 'fk_event_snapshot_event', 'event_id', 'events', 'id', 'ADD CONSTRAINT fk_event_snapshot_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE');

-- CLEANUP HELPERS
DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
DROP PROCEDURE IF EXISTS add_constraint_if_missing;
