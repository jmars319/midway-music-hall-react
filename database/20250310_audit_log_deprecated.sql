-- DEPRECATED MIGRATION
-- Retained for historical reference only.
-- Do NOT run in new deployments.
-- Canonical schema is maintained via non-deprecated migrations.

-- Adds audit_log table for recording admin activity.
-- Run with: mysql -uUSER -pPASS midway_music_hall < database/20250310_audit_log.sql

USE midway_music_hall;

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
