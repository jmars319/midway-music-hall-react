-- SQL schema placeholder for midway_music_hall
-- This file contains DDL statements to create the application's MySQL
-- schema. Run these statements in your development database before
-- starting the backend.
CREATE DATABASE IF NOT EXISTS midway_music_hall;
USE midway_music_hall;

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_datetime DATETIME,
  end_datetime DATETIME,
  venue_section VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seating (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT,
  section VARCHAR(100),
  row_label VARCHAR(10),
  seat_number INT,
  -- Row-level fields to support spatial layout and table rows
  total_seats INT DEFAULT 1,
  seat_type VARCHAR(50) DEFAULT 'general',
  is_active TINYINT(1) DEFAULT 1,
  selected_seats JSON DEFAULT NULL,
  pos_x DECIMAL(5,2) DEFAULT NULL, -- percent 0.00 - 100.00
  pos_y DECIMAL(5,2) DEFAULT NULL, -- percent 0.00 - 100.00
  rotation INT DEFAULT 0,
  status ENUM('available','reserved','sold') DEFAULT 'available'
);

-- Simple table for stage settings (stored separately from business settings)
CREATE TABLE IF NOT EXISTS stage_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  key_name VARCHAR(100) UNIQUE NOT NULL,
  value TEXT
);

-- Customer seat requests (submitted from public site)
CREATE TABLE IF NOT EXISTS seat_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT DEFAULT NULL,
  customer_name VARCHAR(255) NOT NULL,
  contact JSON DEFAULT NULL,
  selected_seats JSON NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_seat_requests_status (status)
);

-- Layout history for server-side undo/redo snapshots
CREATE TABLE IF NOT EXISTS layout_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
