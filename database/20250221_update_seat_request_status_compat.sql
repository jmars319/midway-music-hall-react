-- Compat-safe ENUM expansion for seat request statuses (MySQL builds without easy ALTER helpers).
-- Run this after selecting the `midway_music_hall` database.

USE midway_music_hall;
SET @TARGET_DB = DATABASE();

DROP PROCEDURE IF EXISTS ensure_seat_request_enum;
DELIMITER $$
CREATE PROCEDURE ensure_seat_request_enum(
    IN in_schema VARCHAR(64),
    IN in_table VARCHAR(64),
    IN in_column VARCHAR(64)
)
BEGIN
    DECLARE existing_type TEXT;
    SELECT COLUMN_TYPE INTO existing_type
    FROM information_schema.columns
    WHERE table_schema = in_schema
      AND table_name = in_table
      AND column_name = in_column
    LIMIT 1;

    IF existing_type NOT LIKE '%''spam''%' THEN
        SET @ddl = CONCAT(
            'ALTER TABLE `', in_schema, '`.`', in_table, '` MODIFY COLUMN `', in_column, '` ENUM(''new'',''contacted'',''waiting'',''confirmed'',''declined'',''closed'',''spam'',''expired'',''hold'',''pending'',''finalized'',''approved'',''denied'',''cancelled'') DEFAULT ''new''' 
        );
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL ensure_seat_request_enum(@TARGET_DB, 'seat_requests', 'status');

UPDATE seat_requests SET status = 'new' WHERE status = 'hold';
UPDATE seat_requests SET status = 'waiting' WHERE status = 'pending';
UPDATE seat_requests SET status = 'confirmed' WHERE status IN ('finalized','approved');
UPDATE seat_requests SET status = 'declined' WHERE status = 'denied';
UPDATE seat_requests SET status = 'closed' WHERE status = 'cancelled';

DROP PROCEDURE IF EXISTS ensure_seat_request_enum;
