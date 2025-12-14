-- Compatible migration for the audit_log table with idempotent index creation.

USE midway_music_hall;
SET @TARGET_DB = DATABASE();

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(191) NOT NULL,
  action VARCHAR(191) NOT NULL,
  entity_type VARCHAR(191) NOT NULL,
  entity_id VARCHAR(191) DEFAULT NULL,
  meta_json JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS add_audit_index_if_missing;
DELIMITER $$
CREATE PROCEDURE add_audit_index_if_missing(
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

CALL add_audit_index_if_missing(@TARGET_DB, 'audit_log', 'idx_audit_log_action', 'ADD INDEX idx_audit_log_action (action)');
CALL add_audit_index_if_missing(@TARGET_DB, 'audit_log', 'idx_audit_log_entity', 'ADD INDEX idx_audit_log_entity (entity_type, entity_id)');
CALL add_audit_index_if_missing(@TARGET_DB, 'audit_log', 'idx_audit_log_created', 'ADD INDEX idx_audit_log_created (created_at)');

DROP PROCEDURE IF EXISTS add_audit_index_if_missing;
