require('dotenv').config();
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production. This seeds demo staff accounts with a published default password.');
  process.exit(1);
}
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const missing = [
  { name: 'David Kamara',             email: 'david.kamara@ltq.local',    role: 'admin'                  },
  { name: 'Chief Judge Fanta Konneh', email: 'fanta.konneh@ltq.local',    role: 'head_judge'             },
  { name: 'Emmanuel Dolo',            email: 'emmanuel.dolo@ltq.local',   role: 'media_coordinator'      },
  { name: 'Patricia Sumo',            email: 'patricia.sumo@ltq.local',   role: 'communications_manager' },
];

async function run() {
  const hash = await bcrypt.hash('Password123!', 10);
  for (const u of missing) {
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [u.email]);
    if (rows.length) { console.log('  already exists:', u.email); continue; }
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,FALSE)',
      [u.name, u.email, hash, u.role]
    );
    console.log('  created:', u.role.padEnd(24), u.email);
  }
  console.log('\nAll done. Password for new accounts: Password123!');
  await pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); process.exit(1); });
