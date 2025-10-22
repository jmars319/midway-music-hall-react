const http = require('http');
const mysql = require('mysql2/promise');
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testApi(){
  return new Promise((resolve, reject) => {
    http.get('http://localhost:5001/api/dashboard-stats', res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try{
          const obj = JSON.parse(raw);
          assert(obj.success === true, 'API success flag');
          assert(obj.stats && typeof obj.stats.upcoming_events === 'number', 'upcoming_events present');
          assert(typeof obj.stats.pending_requests === 'number', 'pending_requests present');
          assert(typeof obj.stats.pending_suggestions === 'number', 'pending_suggestions present');
          resolve('API OK');
        }catch(e){ reject(e); }
      });
    }).on('error', reject);
  });
}

async function testSchema(){
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'midway_music_hall'
  });
  const conn = await pool.getConnection();
  try{
    const [cols] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events'", [process.env.DB_NAME]);
    const names = cols.map(c => c.COLUMN_NAME);
    assert(!names.includes('event_date'), 'event_date column removed');
    assert(!names.includes('event_time'), 'event_time column removed');
    return 'Schema OK';
  }finally{
    conn.release();
    await pool.end();
  }
}

(async ()=>{
  try{
    console.log('Running API test...');
    const api = await testApi();
    console.log(api);
    console.log('Running Schema test...');
    const sc = await testSchema();
    console.log(sc);
    console.log('All tests passed');
    process.exit(0);
  }catch(e){
    console.error('Tests failed', e.message || e);
    process.exit(2);
  }
})();
