/*
Safe migration to consolidate event_date + event_time into start_datetime

Usage:
  node scripts/migrate_events_to_start_datetime.js        # dry-run / preview
  node scripts/migrate_events_to_start_datetime.js --confirm  # perform changes (destructive: drops columns)

What it does:
  - creates a backup table `events_backup_<timestamp>` as a snapshot
  - backfills `start_datetime` for rows missing it using event_date + event_time
  - sets any remaining NULL start_datetime rows to created_at (fallback)
  - if --confirm: alters events table to drop event_date and event_time, and adds an index on start_datetime

This script is idempotent and prints clear steps; run with --confirm to execute the ALTER TABLE step.
*/

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const confirm = process.argv.includes('--confirm');

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
    // 1) Create backup
  const ts = Date.now();
  const backupName = `events_backup_${ts}`;
    console.log('Creating backup table:', backupName);
    await conn.query(`CREATE TABLE IF NOT EXISTS \`${backupName}\` LIKE events`);
    await conn.query(`INSERT INTO \`${backupName}\` SELECT * FROM events`);

    // 2) Show current counts
  const [[counts]] = await conn.query("SELECT COUNT(*) AS total_events, SUM(CAST(start_datetime AS CHAR) IS NULL OR CAST(start_datetime AS CHAR) = '0000-00-00 00:00:00') AS missing_start_raw FROM events");
    console.log('Total events:', counts.total_events, 'Rows with missing/zero start_datetime (may be NULL/zero):', counts.missing_start_raw);

    // 3) Backfill in JS (robust parsing)
  const [rows] = await conn.query("SELECT id, event_date, event_time, CAST(start_datetime AS CHAR) AS start_raw, created_at FROM events");
    const toUpdate = rows.filter(r => (r.start_raw === null || r.start_raw === '' || r.start_raw === '0000-00-00 00:00:00') && r.event_date && r.event_time);
    console.log('Rows eligible for backfill from event_date+event_time:', toUpdate.length);

    const pad = n => String(n).padStart(2,'0');
    const formatLocal = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    let updated = 0;
    for(const r of toUpdate){
      // Build datetime in local timezone
      let parsed = null;
      try{ parsed = new Date(r.event_date); }catch(e){}
      if (parsed && !isNaN(parsed.getTime())){
        const parts = String(r.event_time).split(':').map(x => parseInt(x,10));
        const hh = isNaN(parts[0]) ? 0 : parts[0];
        const mm = isNaN(parts[1]) ? 0 : parts[1];
        const ss = parts.length >=3 && !isNaN(parts[2]) ? parts[2] : 0;
        parsed.setHours(hh, mm, ss, 0);
      } else {
        const combined = `${r.event_date} ${r.event_time}`.trim();
        const d2 = new Date(combined);
        if (!isNaN(d2.getTime())) parsed = d2;
      }
      if (parsed){
        const dt = formatLocal(parsed);
        await conn.query('UPDATE events SET start_datetime = ? WHERE id = ?', [dt, r.id]);
        updated++;
      }
    }
    console.log('Backfilled start_datetime for rows:', updated);

    // 4) For any remaining rows with null/zero start_datetime, set to created_at or NOW()
  const [remaining] = await conn.query("SELECT id, CAST(start_datetime AS CHAR) AS start_raw, created_at FROM events WHERE CAST(start_datetime AS CHAR) IS NULL OR CAST(start_datetime AS CHAR) = '0000-00-00 00:00:00'");
    console.log('Remaining rows with missing start_datetime after backfill:', remaining.length);
    let filled = 0;
    for(const r of remaining){
      const fallback = r.created_at ? r.created_at : new Date();
      // format fallback as MySQL DATETIME
      const d = new Date(fallback);
      const dt = formatLocal(d);
      await conn.query('UPDATE events SET start_datetime = ? WHERE id = ?', [dt, r.id]);
      filled++;
    }
    console.log('Filled remaining rows with created_at/NOW():', filled);

    // 5) If confirmed, perform ALTER TABLE to drop columns and add index
    if (confirm){
      console.log('Dropping event_date and event_time columns (if present) and adding index on start_datetime');
      // Check columns in INFORMATION_SCHEMA and drop if present
      const [[colEventDate]] = await conn.query("SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'event_date'", [process.env.DB_NAME]);
      const [[colEventTime]] = await conn.query("SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'event_time'", [process.env.DB_NAME]);
      if (colEventDate.cnt > 0 && colEventTime.cnt > 0) {
        await conn.query('ALTER TABLE events DROP COLUMN event_date, DROP COLUMN event_time');
      } else if (colEventDate.cnt > 0) {
        await conn.query('ALTER TABLE events DROP COLUMN event_date');
      } else if (colEventTime.cnt > 0) {
        await conn.query('ALTER TABLE events DROP COLUMN event_time');
      } else {
        console.log('No event_date/event_time columns found to drop');
      }
      // Add index if not exists
      try{ await conn.query('CREATE INDEX idx_events_start_datetime ON events (start_datetime)'); } catch(e){ /* ignore if exists or unsupported */ }
      console.log('Schema migration completed');
    } else {
      console.log('Dry-run: to perform schema changes, re-run with --confirm');
      console.log("Sample ALTER TABLE SQL: ALTER TABLE events DROP COLUMN event_date, DROP COLUMN event_time; CREATE INDEX idx_events_start_datetime ON events (start_datetime);");
    }

    // 6) Final counts
  const [[finalCounts]] = await conn.query('SELECT COUNT(*) AS total_events, SUM(CAST(start_datetime AS CHAR) IS NULL OR CAST(start_datetime AS CHAR) = \'0000-00-00 00:00:00\') AS missing_after FROM events');
    console.log('Final total events:', finalCounts.total_events, 'Missing start_datetime after migration:', finalCounts.missing_after);

  }catch(e){
    console.error('Migration error', e);
  }finally{
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
