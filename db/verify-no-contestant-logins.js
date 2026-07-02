require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
Promise.all([
  pool.query("SELECT role, COUNT(*) AS n FROM users GROUP BY role ORDER BY role"),
  pool.query("SELECT COUNT(*) AS n FROM contestants WHERE user_id IS NOT NULL")
]).then(([r1, r2]) => {
  console.log('Users by role:');
  r1.rows.forEach(r => console.log(`  ${r.role}: ${r.n}`));
  console.log('Contestants with user_id set:', r2.rows[0].n);
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
