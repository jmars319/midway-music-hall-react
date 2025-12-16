-- Seeds default Site Content values so the admin form loads with current public info.
-- Run from repo root: mysql -uroot -p'YOURPASS' midway_music_hall < database/20250312_site_content_seed.sql

USE midway_music_hall;

INSERT INTO business_settings (setting_key, setting_value) VALUES
('business_name', 'Midway Music Hall'),
('business_address', '11141 Old US Hwy 52, Winston-Salem, NC 27107'),
('business_phone', '336-793-4218'),
('business_email', 'midwayeventcenter@gmail.com'),
('map_address_label', '11141 Old U.S. Hwy 52, Winston-Salem, NC 27107'),
('map_subtext', 'Midway Town Center · Exit 100 off Hwy 52'),
('map_embed_url', 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3274.058364949036!2d-80.22422352346647!3d35.99506067241762!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8853e93a2da3c6f3%3A0x7fe2bff7e76bc3ab!2s11141%20Old%20U.S.%2052%2C%20Winston-Salem%2C%20NC%2027107!5e0!3m2!1sen!2sus!4v1734046800!5m2!1sen!2sus'),
('box_office_note', 'Seat reservations are request-only with a 24-hour hold window. Staff will call or text to confirm every request.'),
('policy_family_text', 'Family venue – please keep language respectful.'),
('policy_refund_text', 'All ticket sales are final. NO REFUNDS.'),
('policy_additional_text', ''),
('facebook_url', 'https://www.facebook.com/midwaymusichall'),
('instagram_url', 'https://www.instagram.com/midwaymusichall'),
('twitter_url', 'https://twitter.com/midwaymusichall'),
('beach_price_label', ''),
('beach_price_note', ''),
('site_contacts_json', '[
  {
    "name": "Donna Cheek",
    "title": "Venue Manager",
    "phone": "336-793-4218",
    "email": "midwayeventcenter@gmail.com",
    "notes": "Main contact for all events and seat requests."
  },
  {
    "name": "Sandra Marshall",
    "title": "Beach Music Coordinator",
    "phone": "336-223-5570",
    "email": "mmhbeachbands@gmail.com",
    "notes": "Carolina Beach Music Series bookings."
  }
]'),
('lessons_json', '[
  {
    "id": "line-all-levels",
    "title": "Line Dance Lessons - All Skill Levels",
    "schedule": "Mondays · 5:30 – 7:30 PM",
    "price": "$7 / person",
    "instructor": "Jackie Phillips",
    "phone": "727-776-1555",
    "description": "High-energy session covering foundations plus new choreography each week."
  },
  {
    "id": "line-seniors",
    "title": "Line Dance Lessons - 55+ Beginner",
    "schedule": "Wednesdays · 11:00 AM – Noon",
    "price": "$7 / person",
    "instructor": "Brenda Holcomb",
    "phone": "336-816-5544",
    "description": "Gentle pacing for beginners and seniors who want to get comfortable on the floor."
  },
  {
    "id": "shag-all-levels",
    "title": "Shag Dance Lessons - All Levels",
    "schedule": "Tuesdays · 6:30 PM",
    "price": "$12 / person",
    "instructor": "Vickie Chambers",
    "phone": "336-989-0156",
    "description": "Classic beach music shag instruction with individualized coaching."
  }
]')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
