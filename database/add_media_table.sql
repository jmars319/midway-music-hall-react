-- Migration: Add media table for organized file uploads
-- Purpose: Track uploaded images with categories (logo, hero, gallery, other)
-- Date: December 1, 2025

USE midway_music_hall;

CREATE TABLE IF NOT EXISTS media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_size INT DEFAULT 0,
  mime_type VARCHAR(100),
  category ENUM('logo', 'hero', 'gallery', 'other') DEFAULT 'other',
  alt_text VARCHAR(255),
  caption TEXT,
  uploaded_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_media_category (category),
  INDEX idx_media_created (created_at DESC)
);
