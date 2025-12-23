-- Schema upgrade for events/recurrence/reservations/media (December 12, 2025)
USE midway_music_hall;

-- Media enhancements (dimensions + optimization metadata)
ALTER TABLE media
  ADD COLUMN IF NOT EXISTS width INT DEFAULT NULL AFTER file_size,
  ADD COLUMN IF NOT EXISTS height INT DEFAULT NULL AFTER width,
  ADD COLUMN IF NOT EXISTS checksum CHAR(64) DEFAULT NULL AFTER height,
  ADD COLUMN IF NOT EXISTS optimized_path VARCHAR(500) DEFAULT NULL AFTER caption,
  ADD COLUMN IF NOT EXISTS webp_path VARCHAR(500) DEFAULT NULL AFTER optimized_path,
  ADD COLUMN IF NOT EXISTS optimization_status ENUM('pending','processing','complete','skipped','failed') DEFAULT 'pending' AFTER webp_path,
  ADD COLUMN IF NOT EXISTS processing_notes TEXT AFTER optimization_status;

-- Seating layouts already include stage metadata via previous migrations; ensure columns exist
ALTER TABLE seating_layouts
  ADD COLUMN IF NOT EXISTS stage_position JSON DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stage_size JSON DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS canvas_settings JSON DEFAULT NULL;

-- Versioned seating chart snapshots
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

ALTER TABLE seating_layout_versions
  ADD COLUMN IF NOT EXISTS canvas_settings JSON DEFAULT NULL;

-- Events table extensions
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS artist_name VARCHAR(255) NOT NULL DEFAULT '' AFTER id,
  ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT NULL AFTER artist_name,
  ADD COLUMN IF NOT EXISTS slug VARCHAR(255) DEFAULT NULL AFTER title,
  ADD COLUMN IF NOT EXISTS description TEXT AFTER slug,
  ADD COLUMN IF NOT EXISTS notes TEXT AFTER description,
  ADD COLUMN IF NOT EXISTS genre VARCHAR(100) DEFAULT NULL AFTER notes,
  ADD COLUMN IF NOT EXISTS category_tags JSON DEFAULT NULL AFTER genre,
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) DEFAULT NULL AFTER category_tags,
  ADD COLUMN IF NOT EXISTS hero_image_id INT DEFAULT NULL AFTER image_url,
  ADD COLUMN IF NOT EXISTS poster_image_id INT DEFAULT NULL AFTER hero_image_id,
  ADD COLUMN IF NOT EXISTS ticket_price DECIMAL(10,2) DEFAULT NULL AFTER poster_image_id,
  ADD COLUMN IF NOT EXISTS door_price DECIMAL(10,2) DEFAULT NULL AFTER ticket_price,
  ADD COLUMN IF NOT EXISTS min_ticket_price DECIMAL(10,2) DEFAULT NULL AFTER door_price,
  ADD COLUMN IF NOT EXISTS max_ticket_price DECIMAL(10,2) DEFAULT NULL AFTER min_ticket_price,
  ADD COLUMN IF NOT EXISTS ticket_type ENUM('general_admission','reserved_seating','hybrid') DEFAULT 'general_admission' AFTER max_ticket_price,
  ADD COLUMN IF NOT EXISTS seating_enabled TINYINT(1) DEFAULT 0 AFTER ticket_type,
  ADD COLUMN IF NOT EXISTS venue_code ENUM('MMH','TGP') DEFAULT 'MMH' AFTER seating_enabled,
  ADD COLUMN IF NOT EXISTS venue_section VARCHAR(100) DEFAULT NULL AFTER venue_code,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'America/New_York' AFTER venue_section,
  ADD COLUMN IF NOT EXISTS start_datetime DATETIME AFTER timezone,
  ADD COLUMN IF NOT EXISTS end_datetime DATETIME AFTER start_datetime,
  ADD COLUMN IF NOT EXISTS door_time DATETIME DEFAULT NULL AFTER end_datetime,
  ADD COLUMN IF NOT EXISTS event_date DATE DEFAULT NULL AFTER door_time,
  ADD COLUMN IF NOT EXISTS event_time TIME DEFAULT NULL AFTER event_date,
  ADD COLUMN IF NOT EXISTS age_restriction VARCHAR(50) DEFAULT 'All Ages' AFTER event_time,
  ADD COLUMN IF NOT EXISTS status ENUM('draft','published','archived') DEFAULT 'draft' AFTER age_restriction,
  ADD COLUMN IF NOT EXISTS visibility ENUM('public','private') DEFAULT 'public' AFTER status,
  ADD COLUMN IF NOT EXISTS publish_at DATETIME DEFAULT NULL AFTER visibility,
  ADD COLUMN IF NOT EXISTS layout_id INT DEFAULT NULL AFTER publish_at,
  ADD COLUMN IF NOT EXISTS layout_version_id BIGINT DEFAULT NULL AFTER layout_id,
  ADD COLUMN IF NOT EXISTS series_master_id INT DEFAULT NULL AFTER layout_version_id,
  ADD COLUMN IF NOT EXISTS is_series_master TINYINT(1) DEFAULT 0 AFTER series_master_id,
  ADD COLUMN IF NOT EXISTS ticket_url VARCHAR(500) DEFAULT NULL AFTER is_series_master,
  ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255) DEFAULT NULL AFTER ticket_url,
  ADD COLUMN IF NOT EXISTS contact_phone_raw VARCHAR(50) DEFAULT NULL AFTER contact_name,
  ADD COLUMN IF NOT EXISTS contact_phone_normalized VARCHAR(20) DEFAULT NULL AFTER contact_phone_raw,
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) DEFAULT NULL AFTER contact_phone_normalized,
  ADD COLUMN IF NOT EXISTS contact_notes TEXT DEFAULT NULL AFTER contact_email,
  ADD COLUMN IF NOT EXISTS change_note VARCHAR(255) DEFAULT NULL AFTER contact_notes,
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(191) DEFAULT NULL AFTER change_note,
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(191) DEFAULT NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER updated_by,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME DEFAULT NULL AFTER updated_at;

ALTER TABLE events
  ADD UNIQUE INDEX IF NOT EXISTS idx_events_slug (slug),
  ADD INDEX IF NOT EXISTS idx_events_start (start_datetime),
  ADD INDEX IF NOT EXISTS idx_events_status (status),
  ADD INDEX IF NOT EXISTS idx_events_venue (venue_code);

ALTER TABLE events
  ADD CONSTRAINT IF NOT EXISTS fk_events_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS fk_events_layout_version FOREIGN KEY (layout_version_id) REFERENCES seating_layout_versions(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS fk_events_series_master FOREIGN KEY (series_master_id) REFERENCES events(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS fk_events_hero_media FOREIGN KEY (hero_image_id) REFERENCES media(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS fk_events_poster_media FOREIGN KEY (poster_image_id) REFERENCES media(id) ON DELETE SET NULL;

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

-- Recurrence tables
CREATE TABLE IF NOT EXISTS event_recurrence_rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  frequency ENUM('daily','weekly','monthly','yearly','custom') NOT NULL DEFAULT 'weekly',
  interval INT NOT NULL DEFAULT 1,
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

-- Seating table adjustments
ALTER TABLE seating
  ADD COLUMN IF NOT EXISTS layout_id INT DEFAULT NULL AFTER event_id,
  ADD COLUMN IF NOT EXISTS table_shape VARCHAR(50) DEFAULT 'table-6' AFTER seat_type,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE seating
  ADD INDEX IF NOT EXISTS idx_seating_layout (layout_id),
  ADD INDEX IF NOT EXISTS idx_seating_event (event_id);

ALTER TABLE seating
  ADD CONSTRAINT IF NOT EXISTS fk_seating_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS fk_seating_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE SET NULL;

-- Seat request workflow updates
ALTER TABLE seat_requests
  ADD COLUMN IF NOT EXISTS layout_version_id BIGINT DEFAULT NULL AFTER event_id,
  ADD COLUMN IF NOT EXISTS seat_map_snapshot JSON DEFAULT NULL AFTER layout_version_id,
  ADD COLUMN IF NOT EXISTS customer_phone_normalized VARCHAR(20) DEFAULT NULL AFTER customer_phone,
  ADD COLUMN IF NOT EXISTS total_seats INT DEFAULT 0 AFTER selected_seats,
  ADD COLUMN IF NOT EXISTS special_requests TEXT AFTER total_seats,
  ADD COLUMN IF NOT EXISTS hold_expires_at DATETIME DEFAULT NULL AFTER status,
  ADD COLUMN IF NOT EXISTS finalized_at DATETIME DEFAULT NULL AFTER hold_expires_at,
  ADD COLUMN IF NOT EXISTS cutoff_override TINYINT(1) DEFAULT 0 AFTER finalized_at,
  ADD COLUMN IF NOT EXISTS staff_notes TEXT AFTER cutoff_override,
  ADD COLUMN IF NOT EXISTS change_note VARCHAR(255) DEFAULT NULL AFTER staff_notes,
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(191) DEFAULT NULL AFTER change_note,
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(191) DEFAULT NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER updated_by,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

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

ALTER TABLE seat_requests
  ADD INDEX IF NOT EXISTS idx_seat_requests_event (event_id),
  ADD INDEX IF NOT EXISTS idx_seat_requests_hold (hold_expires_at);

ALTER TABLE seat_requests
  ADD CONSTRAINT IF NOT EXISTS fk_seat_requests_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  ADD CONSTRAINT IF NOT EXISTS fk_seat_requests_layout_version FOREIGN KEY (layout_version_id) REFERENCES seating_layout_versions(id) ON DELETE SET NULL;

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
