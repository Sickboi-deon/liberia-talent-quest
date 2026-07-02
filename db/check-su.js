require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
pool.query("SELECT email, role FROM users WHERE role = 'superuser'")
  .then(r => { console.log('Superuser accounts:', r.rows); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
