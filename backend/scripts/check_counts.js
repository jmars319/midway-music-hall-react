const mysql=require('mysql2/promise');
(async()=>{
  try{
    const c=await mysql.createConnection({host:'localhost',user:'root',password:'JaMar@319!',database:'midway_music_hall'});
    const [e]=await c.query('SELECT COUNT(*) AS total_events FROM events');
    const [p]=await c.query("SELECT COUNT(*) AS pending_requests FROM seat_requests WHERE status = 'pending'");
    const [s]=await c.query('SELECT COUNT(*) AS total_suggestions FROM suggestions');
    console.log(JSON.stringify({ total_events: e[0].total_events, pending_requests: p[0].pending_requests, total_suggestions: s[0].total_suggestions }));
    await c.end();
  }catch(err){
    console.error('DB ERROR', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
