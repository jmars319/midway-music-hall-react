-- Seed initial media files (existing logos)
USE midway_music_hall;

-- Insert existing logos into media table
INSERT INTO media (filename, original_name, file_path, file_url, file_size, mime_type, category, alt_text, caption) VALUES
('logo-main.png', 'logo.png', '/uploads/logo-main.png', '/uploads/logo-main.png', 335872, 'image/png', 'logo', 'Midway Music Hall Logo', 'Main logo used in navigation'),
('logo-icon.png', 'android-chrome-192x192.png', '/uploads/logo-icon.png', '/uploads/logo-icon.png', 31744, 'image/png', 'logo', 'Midway Music Hall Icon', 'Logo icon used as default event image');

-- Add settings for site logos
INSERT INTO business_settings (setting_key, setting_value) VALUES
('site_logo', '/uploads/logo-main.png'),
('default_event_image', '/uploads/logo-icon.png')
ON DUPLICATE KEY UPDATE 
  setting_value = VALUES(setting_value);
