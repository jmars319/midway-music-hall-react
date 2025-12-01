-- Add stage_position and stage_size columns to seating_layouts table
ALTER TABLE seating_layouts 
ADD COLUMN stage_position JSON DEFAULT NULL,
ADD COLUMN stage_size JSON DEFAULT NULL;
