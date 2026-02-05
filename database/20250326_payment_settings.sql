-- Compatible migration for payment settings table and payment_enabled column

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

CREATE TABLE IF NOT EXISTS payment_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('global','category') NOT NULL DEFAULT 'category',
  category_id INT DEFAULT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  provider_label VARCHAR(191) DEFAULT NULL,
  provider_type ENUM('external_link','paypal_hosted_button') NOT NULL DEFAULT 'external_link',
  payment_url VARCHAR(500) DEFAULT NULL,
  paypal_hosted_button_id VARCHAR(64) DEFAULT NULL,
  paypal_currency VARCHAR(8) DEFAULT 'USD',
  paypal_enable_venmo TINYINT(1) NOT NULL DEFAULT 0,
  button_text VARCHAR(191) DEFAULT 'Pay Online',
  limit_seats INT NOT NULL DEFAULT 6,
  over_limit_message TEXT,
  fine_print TEXT,
  created_by VARCHAR(191) DEFAULT NULL,
  updated_by VARCHAR(191) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_payment_category (category_id),
  KEY idx_payment_scope (scope)
);

CALL add_constraint_if_missing(@TARGET_DB, 'payment_settings', 'fk_payment_category', 'ADD CONSTRAINT fk_payment_category FOREIGN KEY (category_id) REFERENCES event_categories(id) ON DELETE CASCADE');
CALL add_column_if_missing(@TARGET_DB, 'payment_settings', 'provider_type', 'provider_type ENUM(''external_link'',''paypal_hosted_button'') NOT NULL DEFAULT ''external_link'' AFTER provider_label');
CALL add_column_if_missing(@TARGET_DB, 'payment_settings', 'paypal_hosted_button_id', 'paypal_hosted_button_id VARCHAR(64) DEFAULT NULL AFTER payment_url');
CALL add_column_if_missing(@TARGET_DB, 'payment_settings', 'paypal_currency', 'paypal_currency VARCHAR(8) DEFAULT ''USD'' AFTER paypal_hosted_button_id');
CALL add_column_if_missing(@TARGET_DB, 'payment_settings', 'paypal_enable_venmo', 'paypal_enable_venmo TINYINT(1) NOT NULL DEFAULT 0 AFTER paypal_currency');

CALL add_column_if_missing(@TARGET_DB, 'events', 'payment_enabled', 'payment_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER seat_request_email_override');

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
DROP PROCEDURE IF EXISTS add_constraint_if_missing;
