-- Midway Music Hall canonical schema (MySQL 8.0+)
-- Includes events, recurrence, reservations, seating layouts, CMS content, and media metadata.

CREATE DATABASE IF NOT EXISTS midway_music_hall;
USE midway_music_hall;

-- Admin accounts
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  display_name VARCHAR(191) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- General key/value CMS + business settings
CREATE TABLE IF NOT EXISTS business_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(191) UNIQUE NOT NULL,
  setting_value LONGTEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Media metadata (files live on disk under /uploads)
CREATE TABLE IF NOT EXISTS media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_size INT DEFAULT 0,
  width INT DEFAULT NULL,
  height INT DEFAULT NULL,
  mime_type VARCHAR(100),
  checksum CHAR(64) DEFAULT NULL,
  category ENUM('logo','hero','gallery','other') DEFAULT 'other',
  alt_text VARCHAR(255),
  caption TEXT,
  optimized_path VARCHAR(500) DEFAULT NULL,
  webp_path VARCHAR(500) DEFAULT NULL,
  optimization_status ENUM('pending','processing','complete','skipped','failed') DEFAULT 'pending',
  processing_notes TEXT,
  uploaded_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_media_category (category),
  INDEX idx_media_created (created_at DESC)
);

-- Stage settings for the layout editor (kept separate from business_settings)
CREATE TABLE IF NOT EXISTS stage_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  key_name VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seating layout templates (metadata only; rows stored in layout_data JSON)
CREATE TABLE IF NOT EXISTS seating_layouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default TINYINT(1) DEFAULT 0,
  layout_data JSON NOT NULL,
  stage_position JSON DEFAULT NULL,
  stage_size JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_seating_layout_default (is_default)
);

-- Version snapshots of layout templates (used when attaching a chart to an event)
CREATE TABLE IF NOT EXISTS seating_layout_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  layout_id INT NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  version_label VARCHAR(100) DEFAULT NULL,
  layout_data JSON NOT NULL,
  stage_position JSON DEFAULT NULL,
  stage_size JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(191) DEFAULT NULL,
  change_note VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_layout_versions_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_layout_version (layout_id, version_number)
);

-- Event categories (used for routing + admin filters)
CREATE TABLE IF NOT EXISTS event_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(191) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  seat_request_email_to VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_event_categories_slug (slug)
);

-- Events table (stores both single events and recurrence masters)
CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  artist_name VARCHAR(255) NOT NULL,
  title VARCHAR(255) DEFAULT NULL,
  slug VARCHAR(255) DEFAULT NULL,
  description TEXT,
  notes TEXT,
  genre VARCHAR(100),
  category_tags JSON DEFAULT NULL,
  category_id INT DEFAULT NULL,
  image_url VARCHAR(500),
  hero_image_id INT DEFAULT NULL,
  poster_image_id INT DEFAULT NULL,
  ticket_price DECIMAL(10,2) DEFAULT NULL,
  door_price DECIMAL(10,2) DEFAULT NULL,
  min_ticket_price DECIMAL(10,2) DEFAULT NULL,
  max_ticket_price DECIMAL(10,2) DEFAULT NULL,
  ticket_type ENUM('general_admission','reserved_seating','hybrid') DEFAULT 'general_admission',
  seating_enabled TINYINT(1) DEFAULT 0,
  venue_code ENUM('MMH','TGP') DEFAULT 'MMH',
  venue_section VARCHAR(100),
  timezone VARCHAR(64) DEFAULT 'America/New_York',
  start_datetime DATETIME,
  end_datetime DATETIME,
  door_time DATETIME DEFAULT NULL,
  event_date DATE DEFAULT NULL,
  event_time TIME DEFAULT NULL,
  age_restriction VARCHAR(50) DEFAULT 'All Ages',
  status ENUM('draft','published','archived') DEFAULT 'draft',
  visibility ENUM('public','private') DEFAULT 'public',
  publish_at DATETIME DEFAULT NULL,
  layout_id INT DEFAULT NULL,
  layout_version_id BIGINT DEFAULT NULL,
  series_master_id INT DEFAULT NULL,
  is_series_master TINYINT(1) DEFAULT 0,
  ticket_url VARCHAR(500),
  contact_name VARCHAR(255),
  contact_phone_raw VARCHAR(50),
  contact_phone_normalized VARCHAR(20),
  contact_email VARCHAR(255),
  contact_notes TEXT,
  seat_request_email_override VARCHAR(255) DEFAULT NULL,
  change_note VARCHAR(255),
  created_by VARCHAR(191),
  updated_by VARCHAR(191),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  INDEX idx_events_start (start_datetime),
  INDEX idx_events_status (status),
  INDEX idx_events_venue (venue_code),
  INDEX idx_events_category (category_id),
  UNIQUE KEY idx_events_slug (slug),
  CONSTRAINT fk_events_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE SET NULL,
  CONSTRAINT fk_events_layout_version FOREIGN KEY (layout_version_id) REFERENCES seating_layout_versions(id) ON DELETE SET NULL,
  CONSTRAINT fk_events_series_master FOREIGN KEY (series_master_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT fk_events_hero_media FOREIGN KEY (hero_image_id) REFERENCES media(id) ON DELETE SET NULL,
  CONSTRAINT fk_events_poster_media FOREIGN KEY (poster_image_id) REFERENCES media(id) ON DELETE SET NULL,
  CONSTRAINT fk_events_category FOREIGN KEY (category_id) REFERENCES event_categories(id) ON DELETE SET NULL
);

-- Recurrence rules (one per series master event)
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

-- Recurrence exceptions / overrides
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

-- Audit trail for admin actions
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(191) NOT NULL,
  action VARCHAR(191) NOT NULL,
  entity_type VARCHAR(191) NOT NULL,
  entity_id VARCHAR(191) DEFAULT NULL,
  meta_json JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_log_action (action),
  INDEX idx_audit_log_entity (entity_type, entity_id),
  INDEX idx_audit_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seating rows (legacy row list + spatial metadata)
CREATE TABLE IF NOT EXISTS seating (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT DEFAULT NULL,
  layout_id INT DEFAULT NULL,
  section VARCHAR(100),
  row_label VARCHAR(50),
  seat_number INT,
  total_seats INT DEFAULT 1,
  seat_type VARCHAR(50) DEFAULT 'general',
  table_shape VARCHAR(50) DEFAULT 'table-6',
  is_active TINYINT(1) DEFAULT 1,
  selected_seats JSON DEFAULT NULL,
  pos_x DECIMAL(6,3) DEFAULT NULL,
  pos_y DECIMAL(6,3) DEFAULT NULL,
  rotation INT DEFAULT 0,
  status ENUM('available','reserved','sold') DEFAULT 'available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_seating_layout (layout_id),
  INDEX idx_seating_event (event_id),
  CONSTRAINT fk_seating_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT fk_seating_layout FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) ON DELETE SET NULL
);

-- Seat / reservation requests (request workflow only)
CREATE TABLE IF NOT EXISTS seat_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT DEFAULT NULL,
  layout_version_id BIGINT DEFAULT NULL,
  seat_map_snapshot JSON DEFAULT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(50),
  customer_phone_normalized VARCHAR(20),
  contact JSON DEFAULT NULL,
  selected_seats JSON NOT NULL,
  total_seats INT DEFAULT 0,
  special_requests TEXT,
  status ENUM('hold','pending','finalized','approved','denied','cancelled') DEFAULT 'hold',
  hold_expires_at DATETIME DEFAULT NULL,
  finalized_at DATETIME DEFAULT NULL,
  cutoff_override TINYINT(1) DEFAULT 0,
  staff_notes TEXT,
  change_note VARCHAR(255),
  created_by VARCHAR(191),
  updated_by VARCHAR(191),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_seat_requests_status (status),
  INDEX idx_seat_requests_event (event_id),
  INDEX idx_seat_requests_hold (hold_expires_at),
  CONSTRAINT fk_seat_requests_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT fk_seat_requests_layout_version FOREIGN KEY (layout_version_id) REFERENCES seating_layout_versions(id) ON DELETE SET NULL
);

-- Layout history snapshots for undo/redo support
CREATE TABLE IF NOT EXISTS layout_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Public artist suggestions / contact submissions
CREATE TABLE IF NOT EXISTS suggestions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  contact JSON DEFAULT NULL,
  notes TEXT,
  submission_type VARCHAR(50) DEFAULT 'general',
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
