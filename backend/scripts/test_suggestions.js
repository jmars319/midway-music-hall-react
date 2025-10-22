const http = require('http');
const mysql = require('mysql2/promise');
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function testApi() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:5001/api/suggestions', res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const obj = JSON.parse(raw);
          assert(obj.success === true, 'API success flag');
          assert(Array.isArray(obj.suggestions), 'suggestions array present');
          // If there is at least one suggestion, check normalized fields
          if (obj.suggestions.length > 0) {
            const s = obj.suggestions[0];
            assert('artist_name' in s, 'artist_name present');
            assert('contact_email' in s, 'contact_email present');
            assert('contact_phone' in s, 'contact_phone present');
            assert('message' in s, 'message/notes present');
          }
          resolve('API OK');
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function testSchema() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'midway_music_hall'
  });
  const conn = await pool.getConnection();
  try {
    const [cols] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'suggestions'", [process.env.DB_NAME]);
    const names = cols.map(c => c.COLUMN_NAME);
    assert(names.includes('contact'), 'suggestions.contact column exists');
    return 'Schema OK';
  } finally {
    conn.release();
    await pool.end();
  }
}

(async () => {
  try {
    console.log('Running Suggestions API test...');
    const api = await testApi();
    console.log(api);
    console.log('Running Suggestions schema test...');
    const sc = await testSchema();
    console.log(sc);
    console.log('All suggestion tests passed');
    process.exit(0);
  } catch (e) {
    console.error('Tests failed', e.message || e);
    process.exit(2);
  }
})();
