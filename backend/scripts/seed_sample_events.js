/* Seed sample events for development. Safe to run multiple times.
   It will insert events only if events table is empty or if a --force flag is passed.
*/
const mysql = require('mysql2/promise');
require('dotenv').config({ path: __dirname + '/../.env' });

async function main(){
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'midway_music_hall',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });
  const conn = await pool.getConnection();
  try{
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM events');
    const force = process.argv.includes('--force');
    if (cnt > 0 && !force) {
      console.log('Events already exist; use --force to insert sample events');
      return;
    }
    const samples = [
      { title: 'Midway Folk Night', date: '2025-11-15', time: '20:00:00' },
      { title: 'Indie Friday', date: '2025-11-22', time: '19:30:00' },
      { title: 'Retro Rock', date: '2025-11-29', time: '21:00:00' },
      { title: 'Acoustic Sunday', date: '2025-12-06', time: '19:00:00' },
      { title: 'Singer-Songwriter Showcase', date: '2025-12-13', time: '20:30:00' },
      { title: 'Winter Warmup', date: '2025-12-20', time: '19:00:00' }
    ];
    for(const s of samples){
      await conn.query('INSERT INTO events (title, event_date, event_time, start_datetime, created_at) VALUES (?, ?, ?, ?, NOW())', [s.title, s.date, s.time, `${s.date} ${s.time}`]);
    }
    console.log('Inserted sample events');
  }catch(e){
    console.error('Seed error', e);
  }finally{
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
