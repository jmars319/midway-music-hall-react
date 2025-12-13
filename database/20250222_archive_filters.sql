-- Archive support indexes + admin updated_at column

-- Events adjustments (safe guards for existing columns/indexes)
DELIMITER $$
CREATE PROCEDURE ensure_events_archive()
BEGIN
  DECLARE col_exists INT DEFAULT 0;
  DECLARE idx1_exists INT DEFAULT 0;
  DECLARE idx2_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO col_exists
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'events' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'archived_at';

  IF col_exists = 0 THEN
    ALTER TABLE `events`
      ADD COLUMN `archived_at` DATETIME NULL DEFAULT NULL AFTER `deleted_at`;
  END IF;

  SELECT COUNT(*) INTO idx1_exists
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_NAME = 'events' AND TABLE_SCHEMA = DATABASE() AND INDEX_NAME = 'idx_events_archived_at';

  IF idx1_exists = 0 THEN
    ALTER TABLE `events`
      ADD INDEX `idx_events_archived_at` (`archived_at`);
  END IF;

  SELECT COUNT(*) INTO idx2_exists
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_NAME = 'events' AND TABLE_SCHEMA = DATABASE() AND INDEX_NAME = 'idx_events_status_visibility';

  IF idx2_exists = 0 THEN
    ALTER TABLE `events`
      ADD INDEX `idx_events_status_visibility` (`status`, `visibility`);
  END IF;
END $$
DELIMITER ;
CALL ensure_events_archive();
DROP PROCEDURE ensure_events_archive;

-- Admins updated_at column
DELIMITER $$
CREATE PROCEDURE ensure_admins_updated_at()
BEGIN
  DECLARE col_exists INT DEFAULT 0;
  SELECT COUNT(*) INTO col_exists
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'admins' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'updated_at';
  IF col_exists = 0 THEN
    ALTER TABLE `admins`
      ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
  END IF;
END $$
DELIMITER ;
CALL ensure_admins_updated_at();
DROP PROCEDURE ensure_admins_updated_at;
