-- Compatible migration for per-category and per-event seat request overrides.

USE midway_music_hall;
SET @TARGET_DB = DATABASE();

DROP PROCEDURE IF EXISTS add_column_if_missing_simple;
DELIMITER $$
CREATE PROCEDURE add_column_if_missing_simple(
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

CALL add_column_if_missing_simple(@TARGET_DB, 'event_categories', 'seat_request_email_to', 'seat_request_email_to VARCHAR(255) DEFAULT NULL AFTER is_system');
CALL add_column_if_missing_simple(@TARGET_DB, 'events', 'seat_request_email_override', 'seat_request_email_override VARCHAR(255) DEFAULT NULL AFTER contact_email');

DROP PROCEDURE IF EXISTS add_column_if_missing_simple;
