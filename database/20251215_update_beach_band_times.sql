-- One-time adjustment to align existing Beach Bands events with the standard schedule (doors 1 PM, dance party 1-3 PM, band 3-6 PM)
USE midway_music_hall;

UPDATE events e
INNER JOIN event_categories c ON c.id = e.category_id
SET
  e.door_time = IF(e.event_date IS NOT NULL, CONCAT(e.event_date, ' 13:00:00'), e.door_time),
  e.start_datetime = IF(e.event_date IS NOT NULL, CONCAT(e.event_date, ' 15:00:00'), e.start_datetime),
  e.end_datetime = IF(e.event_date IS NOT NULL, CONCAT(e.event_date, ' 18:00:00'), e.end_datetime),
  e.event_time = '15:00:00',
  e.notes = 'Doors 1:00 PM · Donna''s Dance Party 1:00–3:00 PM · Beach band 3:00–6:00 PM'
WHERE c.slug = 'beach-bands';
