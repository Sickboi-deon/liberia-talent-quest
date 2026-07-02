// Resets EVERY superuser account's password to SUPERUSER_PASSWORD (or the
// ChangeMe123! default). Destructive: run only when you have physically lost
// access and need to regain it. Requires --force to actually run.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { hashPassword } = require('../lib/auth');

if (!process.argv.includes('--force')) {
  console.error('This resets the password for every superuser account.');
  console.error('Re-run with --force to confirm: node db/reset-su.js --force');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const pass = process.env.SUPERUSER_PASSWORD || 'ChangeMe123!';
pool.query(
  "UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE role = 'superuser' RETURNING email",
  [hashPassword(pass)]
).then(r => {
  if (!r.rows.length) { console.log('No superuser account found.'); return pool.end(); }
  console.log('Reset password for', r.rows.length, 'superuser account(s):');
  r.rows.forEach(row => console.log('  -', row.email));
  console.log('Temporary password:', pass, '(must be changed on next login)');
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); process.exit(1); });
