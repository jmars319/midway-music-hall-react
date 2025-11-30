-- Migration: Add seating layout templates system
-- Purpose: Allow saving multiple seating layouts and assigning them to events
-- Date: November 30, 2025

USE midway_music_hall;

-- Create seating_layouts table to store named layout templates
CREATE TABLE IF NOT EXISTS seating_layouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default TINYINT(1) DEFAULT 0,
  layout_data JSON NOT NULL, -- Stores array of seating rows with all config
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_is_default (is_default)
);

-- Add layout_id column to events table to link events to specific layouts
ALTER TABLE events 
ADD COLUMN layout_id INT DEFAULT NULL AFTER end_datetime,
ADD CONSTRAINT fk_events_layout 
  FOREIGN KEY (layout_id) REFERENCES seating_layouts(id) 
  ON DELETE SET NULL;

-- Add layout_id to seating table for tracking which layout a row belongs to
ALTER TABLE seating 
ADD COLUMN layout_id INT DEFAULT NULL AFTER event_id,
ADD INDEX idx_layout_id (layout_id);

-- Insert a default "Standard Layout" as the base template
INSERT INTO seating_layouts (name, description, is_default, layout_data) 
VALUES (
  'Standard Layout',
  'Default seating arrangement for general events',
  1,
  '[]'
) ON DUPLICATE KEY UPDATE name=name;

-- Note: After running this migration, you should:
-- 1. Use admin panel to configure the Standard Layout with actual seating data
-- 2. Create additional layout templates as needed
-- 3. Assign layouts to specific events via event editor
