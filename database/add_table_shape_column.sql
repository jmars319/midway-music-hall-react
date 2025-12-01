-- Migration: Add table_shape column to seating table
-- Purpose: Support flexible table types (table-2, table-4, round-6, bar-6, booth-4, standing-10, etc.)
-- Date: November 30, 2025

USE midway_music_hall;

-- Add table_shape column to seating table
ALTER TABLE seating 
ADD COLUMN table_shape VARCHAR(50) DEFAULT 'table-6' AFTER seat_type;

-- Note: The table_shape column allows each seating row to have a specific visual layout:
-- Supported values: table-2, table-4, table-6, table-8, round-6, round-8, bar-6, booth-4, standing-10, standing-20
-- This integrates with the frontend TableComponent for flexible rendering
