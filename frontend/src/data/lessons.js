// Structured data for weekly classes & lessons. Keeping this in a config
// makes it easy to migrate into the CMS later without touching the layout.
const lessons = [
  {
    id: 'line-all-levels',
    title: 'Line Dance Lessons - All Skill Levels',
    schedule: 'Mondays · 5:30 – 7:30 PM',
    price: '$7 / person',
    instructor: 'Jackie Phillips',
    phone: '727-776-1555',
    description: 'High-energy session covering foundations plus new choreography each week.',
  },
  {
    id: 'line-seniors',
    title: 'Line Dance Lessons - 55+ Beginner',
    schedule: 'Wednesdays · 11:00 AM – Noon',
    price: '$7 / person',
    instructor: 'Brenda Holcomb',
    phone: '336-816-5544',
    description: 'Gentle pacing for beginners and seniors who want to get comfortable on the floor.',
  },
  {
    id: 'shag-all-levels',
    title: 'Shag Dance Lessons - All Levels',
    schedule: 'Tuesdays · 6:30 PM',
    price: '$12 / person',
    instructor: 'Vickie Chambers',
    phone: '336-989-0156',
    description: 'Classic beach music shag instruction with individualized coaching.',
  },
];

export default lessons;
