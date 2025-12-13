-- Expands seat request statuses to support the full lifecycle (new/contacted/waiting/etc.).
-- Run with: mysql -uUSER -pPASS midway_music_hall < database/20250221_update_seat_request_status.sql

USE midway_music_hall;

ALTER TABLE seat_requests
  MODIFY COLUMN status ENUM(
    'new',
    'contacted',
    'waiting',
    'confirmed',
    'declined',
    'closed',
    'spam',
    'expired',
    'hold',
    'pending',
    'finalized',
    'approved',
    'denied',
    'cancelled'
  ) DEFAULT 'new';

UPDATE seat_requests SET status = 'new' WHERE status = 'hold';
UPDATE seat_requests SET status = 'waiting' WHERE status = 'pending';
UPDATE seat_requests SET status = 'confirmed' WHERE status IN ('finalized','approved');
UPDATE seat_requests SET status = 'declined' WHERE status = 'denied';
UPDATE seat_requests SET status = 'closed' WHERE status = 'cancelled';
