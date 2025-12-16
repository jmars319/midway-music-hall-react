-- Add content settings for hero, about, and social media links
USE midway_music_hall;

-- Insert default settings if they don't exist
INSERT INTO business_settings (setting_key, setting_value) 
VALUES 
  ('hero_title', 'Midway Music Hall'),
  ('hero_subtitle', 'Experience local and touring acts in an intimate venue - weekly shows, great sound, and a welcoming community.'),
  ('hero_images', '[]'),
  ('hero_slideshow_enabled', 'false'),
  ('hero_slideshow_interval', '5000'),
  ('tgp_hero_title', 'The Gathering Place'),
  ('tgp_hero_subtitle', 'Neighboring room for DJs, shag events, and private-friendly gatherings.'),
  ('tgp_hero_images', '[]'),
  ('tgp_hero_slideshow_enabled', 'false'),
  ('tgp_hero_slideshow_interval', '5000'),
  ('about_title', 'About Midway Music Hall'),
  ('about_description', 'Midway Music Hall is an intimate live music venue in Winston-Salem, North Carolina. We focus on reliable sound, curated dance nights, and a welcoming community experience.\n\nJoin us for weekly shows, private rentals, and community gatherings that celebrate Carolina beach music, shag culture, and country roots.'),
  ('facebook_url', 'https://facebook.com/midwaymusichall'),
  ('instagram_url', 'https://instagram.com/midwaymusichal'),
  ('twitter_url', 'https://twitter.com/midwaymusichal'),
  ('beach_price_label', ''),
  ('beach_price_note', '')
ON DUPLICATE KEY UPDATE setting_key=setting_key;
