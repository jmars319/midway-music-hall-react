-- Add hero image settings
USE midway_music_hall;

-- Insert default settings for hero images
INSERT INTO business_settings (setting_key, setting_value) 
VALUES 
  ('hero_images', '[]'),
  ('hero_slideshow_enabled', 'false'),
  ('hero_slideshow_interval', '5000')
ON DUPLICATE KEY UPDATE setting_key=setting_key;
