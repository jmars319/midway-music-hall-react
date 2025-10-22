#!/usr/bin/env node
// Run all migration scripts in this directory in alphabetical order.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname);
const scripts = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'run_migrations.js').sort();

async function run(){
  console.log('Found migration scripts:', scripts);
  for(const s of scripts){
    const full = path.join(dir, s);
    console.log('Running', s);
    await new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [full], { cwd: path.join(__dirname, '..') }, (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (err) return reject(err);
        resolve();
      });
      child.stdin && child.stdin.end();
    }).catch(err => { console.error('Migration failed', s, err); process.exit(1); });
  }
  console.log('All migrations completed');
}

run().catch(err => { console.error(err); process.exit(1); });
