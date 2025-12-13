-- Inserts missing 2026 beach music series events (idempotent via slug check).
-- Run with: mysql -uUSER -pPASS midway_music_hall < database/20250220_seed_beach_music_series.sql

USE midway_music_hall;

DELIMITER $$
CREATE PROCEDURE ensure_beach_event(
    IN in_artist VARCHAR(255),
    IN in_event_date DATE,
    IN in_slug VARCHAR(255)
)
BEGIN
    DECLARE existing_id INT DEFAULT NULL;
    SELECT id INTO existing_id FROM events WHERE slug = in_slug LIMIT 1;
    IF existing_id IS NULL THEN
        INSERT INTO events (
            artist_name,
            title,
            slug,
            description,
            notes,
            genre,
            category_tags,
            ticket_price,
            door_price,
            min_ticket_price,
            max_ticket_price,
            ticket_type,
            seating_enabled,
            venue_code,
            venue_section,
            timezone,
            start_datetime,
            end_datetime,
            door_time,
            event_date,
            event_time,
            age_restriction,
            status,
            visibility,
            publish_at,
            ticket_url,
            contact_name,
            contact_phone_raw,
            contact_phone_normalized,
            contact_email,
            change_note,
            created_by,
            updated_by
        ) VALUES (
            in_artist,
            in_artist,
            in_slug,
            CONCAT(in_artist, ' performs as part of the 2026 Carolina Beach Music Series at Midway Music Hall.'),
            NULL,
            'Beach Music',
            JSON_ARRAY('beach_music_series','beach_band','beach_music'),
            20.00,
            25.00,
            20.00,
            25.00,
            'general_admission',
            0,
            'MMH',
            'Carolina Beach Music Series',
            'America/New_York',
            CONCAT(in_event_date, ' 19:00:00'),
            CONCAT(in_event_date, ' 22:00:00'),
            CONCAT(in_event_date, ' 18:00:00'),
            in_event_date,
            '19:00:00',
            'All Ages',
            'published',
            'public',
            CONCAT(in_event_date, ' 12:00:00'),
            NULL,
            'Donna Cheek',
            '336-793-4218',
            '3367934218',
            NULL,
            'seeded beach series event 20250220',
            'seed-beach-series',
            'seed-beach-series'
        );
    END IF;
END$$
DELIMITER ;

CALL ensure_beach_event('THE EMBERS',            '2026-01-25', 'the-embers-20260125');
CALL ensure_beach_event('SPECIAL OCCASION BAND', '2026-02-15', 'special-occasion-band-20260215');
CALL ensure_beach_event('GARY LOWDER AND SMOKIN HOT', '2026-03-15', 'gary-lowder-and-smokin-hot-20260315');
CALL ensure_beach_event('THE ENTERTAINERS',      '2026-04-19', 'the-entertainers-20260419');
CALL ensure_beach_event('THE CATALINAS',         '2026-05-03', 'the-catalinas-20260503');
CALL ensure_beach_event('JIM QUICK AND COASTLINE','2026-09-20', 'jim-quick-and-coastline-20260920');
CALL ensure_beach_event('TOO MUCH SYLVIA',       '2026-10-18', 'too-much-sylvia-20261018');
CALL ensure_beach_event('BAND OF OZ',            '2026-11-15', 'band-of-oz-20261115');

DROP PROCEDURE IF EXISTS ensure_beach_event;
