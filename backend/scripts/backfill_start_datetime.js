/* Backfill start_datetime from event_date + event_time when missing

Usage:
  node scripts/backfill_start_datetime.js

This script will:
 - connect to the DB using the same env config as the server
 - find events with NULL start_datetime and where event_date and event_time are present
 - compute a DATETIME and update the start_datetime column
 - print a summary

It is idempotent and safe to run multiple times.
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
    // Avoid direct DATETIME comparisons (zero-dates can cause errors depending on SQL mode).
    // Select all rows that have event_date and event_time; we'll inspect start_datetime as CHAR
    const [rows] = await conn.query("SELECT id, event_date, event_time, CAST(start_datetime AS CHAR) AS start_raw FROM events WHERE event_date IS NOT NULL AND event_time IS NOT NULL");
    // Filter in JS to find rows where start_datetime is missing or is a zero-date string
    const toUpdate = rows.filter(r => (r.start_raw === null || r.start_raw === '' || r.start_raw === '0000-00-00 00:00:00'));
    console.log(`Found ${toUpdate.length} rows to backfill`);
    let updated = 0;
    const pad = n => String(n).padStart(2, '0');
    const formatLocal = d => {
      // Format Date `d` as 'YYYY-MM-DD HH:MM:SS' in local timezone
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    for(const r of toUpdate){
      let parsed = null;

      // Try to parse event_date directly
      if (r.event_date) {
        const d = new Date(r.event_date);
        if (!isNaN(d.getTime())) parsed = d;
      }

      // If we parsed event_date and have event_time, set the time components
      if (parsed && r.event_time) {
        const parts = String(r.event_time).split(':').map(x => parseInt(x, 10));
        if (parts.length >= 2) {
          const hh = isNaN(parts[0]) ? 0 : parts[0];
          const mm = isNaN(parts[1]) ? 0 : parts[1];
          const ss = parts.length >= 3 && !isNaN(parts[2]) ? parts[2] : 0;
          parsed.setHours(hh, mm, ss, 0);
        }
      }

      // If parsing failed earlier, try combined string fallback
      if (!parsed) {
        const combined = `${r.event_date || ''} ${r.event_time || ''}`.trim();
        const d2 = new Date(combined);
        if (!isNaN(d2.getTime())) parsed = d2;
      }

      if (parsed) {
        const dt = formatLocal(parsed);
        try{
          await conn.query('UPDATE events SET start_datetime = ? WHERE id = ?', [dt, r.id]);
          updated++;
        }catch(e){
          console.error('Failed to update id', r.id, e.message);
        }
      } else {
        console.warn('Skipping id, could not parse date/time', r.id, r.event_date, r.event_time);
      }
    }
    console.log(`Updated ${updated} rows`);
  }catch(e){
    console.error('Migration error', e);
  }finally{
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
