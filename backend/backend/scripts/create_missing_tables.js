const mysql = require('mysql2/promise');
(async()=>{
  try{
    const c = await mysql.createConnection({host:'localhost',user:'root',password:'JaMar@319!',database:'midway_music_hall'});
    console.log('Connected to DB');
    const stmts = [
      `CREATE TABLE IF NOT EXISTS suggestions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        contact JSON DEFAULT NULL,
        notes TEXT,
        submission_type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS business_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT
      )`
    ];
    for (const s of stmts){
      console.log('Executing: ', s.split('\n')[0]);
      await c.query(s);
    }
    console.log('Tables ensured');
    await c.end();
  }catch(err){
    console.error('ERROR', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
