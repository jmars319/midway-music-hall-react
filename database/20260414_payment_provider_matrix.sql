-- Multi-provider payment settings upgrade.
-- Run after database/20251212_schema_upgrade.sql.
-- This expands payment_settings from one row per scope/category to one row per scope/category/provider.

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

DROP PROCEDURE IF EXISTS drop_index_if_exists;
DELIMITER $$
CREATE PROCEDURE drop_index_if_exists(
    IN in_schema VARCHAR(64),
    IN in_table VARCHAR(64),
    IN in_index VARCHAR(64)
)
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.statistics
        WHERE table_schema = in_schema
          AND table_name = in_table
          AND index_name = in_index
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', in_schema, '`.`', in_table, '` DROP INDEX `', in_index, '`');
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL add_column_if_missing(@TARGET_DB, 'payment_settings', 'provider_scope_key', 'provider_scope_key VARCHAR(255) DEFAULT NULL AFTER category_id');
CALL add_column_if_missing(@TARGET_DB, 'payment_settings', 'square_enable_cash_app_pay', 'square_enable_cash_app_pay TINYINT(1) NOT NULL DEFAULT 0 AFTER paypal_enable_venmo');

UPDATE payment_settings
SET provider_scope_key = CONCAT(
    LOWER(COALESCE(scope, '' )),
    ':',
    COALESCE(CAST(category_id AS CHAR), '0'),
    ':',
    LOWER(COALESCE(provider_type, 'external_link'))
)
WHERE provider_scope_key IS NULL OR TRIM(provider_scope_key) = '';

ALTER TABLE payment_settings
  MODIFY COLUMN provider_scope_key VARCHAR(255) NOT NULL;

CALL add_index_if_missing(@TARGET_DB, 'payment_settings', 'idx_payment_category', 'ADD INDEX idx_payment_category (category_id)');
CALL drop_index_if_exists(@TARGET_DB, 'payment_settings', 'uniq_payment_category');
CALL add_index_if_missing(@TARGET_DB, 'payment_settings', 'uniq_payment_provider_scope', 'ADD UNIQUE INDEX uniq_payment_provider_scope (provider_scope_key)');
CALL add_index_if_missing(@TARGET_DB, 'payment_settings', 'idx_payment_scope_category', 'ADD INDEX idx_payment_scope_category (scope, category_id)');

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
DROP PROCEDURE IF EXISTS drop_index_if_exists;
