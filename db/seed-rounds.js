require('dotenv').config();
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production. This seeds demo round data.');
  process.exit(1);
}
const db = require('../lib/db');

async function run() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM rounds');
  if (rows[0].n > 0) { console.log('Rounds already exist (' + rows[0].n + '), skipping.'); process.exit(0); }
  await db.query(`
    INSERT INTO rounds (name, display_order, status) VALUES
      ('Week 1 — Audition Stage', 1, 'closed'),
      ('Week 2 — Quarter Finals', 2, 'closed'),
      ('Semi-Finals',             3, 'scoring'),
      ('Grand Finale',            4, 'upcoming')
  `);
  console.log('4 rounds seeded.');
  process.exit(0);
}

run().catch(err => { console.error(err.message); process.exit(1); });
