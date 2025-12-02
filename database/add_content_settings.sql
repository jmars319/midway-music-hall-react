-- Add content settings for hero, about, and social media links
USE midway_music_hall;

-- Insert default settings if they don't exist
INSERT INTO business_settings (setting_key, setting_value) 
VALUES 
  ('hero_title', 'Midway Music Hall'),
  ('hero_subtitle', 'Experience local and touring acts in an intimate venue — weekly shows, great sound, and a welcoming community.'),
  ('about_title', 'About Midway Music Hall'),
  ('about_description', 'Midway Music Hall is an intimate live music venue dedicated to bringing outstanding local and touring acts to Lexington. We focus on great sound, curated lineups, and an inclusive community experience.\n\nJoin us for weekly shows, private events, and community nights.'),
  ('facebook_url', 'https://facebook.com/midwaymusichal'),
  ('instagram_url', 'https://instagram.com/midwaymusichal'),
  ('twitter_url', 'https://twitter.com/midwaymusichal')
ON DUPLICATE KEY UPDATE setting_key=setting_key;
