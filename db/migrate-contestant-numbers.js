// One-time backfill: assigns a public contestant_number to any existing
// contestant that doesn't already have one, in registration order
// (created_at) per season.
//
// contestant_number is now assigned immediately at registration time (see
// routes/contestants.routes.js POST /) for every new applicant regardless of
// status. This script only needs to run once, to backfill contestants that
// were created before that change shipped. It is safe to re-run: contestants
// that already have a number are left untouched.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock each season one at a time and assign the next available number,
    // in registration order, to that season's un-numbered contestants only.
    const { rows: seasons } = await client.query('SELECT id FROM seasons');
    for (const season of seasons) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [season.id]);

      const { rows: unnumbered } = await client.query(
        `SELECT id FROM contestants
         WHERE season_id = $1 AND contestant_number IS NULL
         ORDER BY created_at, id`,
        [season.id]
      );
      if (!unnumbered.length) continue;

      const { rows: maxRows } = await client.query(
        'SELECT COALESCE(MAX(contestant_number), 0) AS n FROM contestants WHERE season_id = $1',
        [season.id]
      );
      let next = maxRows[0].n;
      for (const c of unnumbered) {
        next += 1;
        await client.query('UPDATE contestants SET contestant_number = $1 WHERE id = $2', [next, c.id]);
      }
      console.log(`  season ${season.id}: backfilled ${unnumbered.length} contestant number(s)`);
    }

    await client.query('COMMIT');
    console.log('[migrate-contestant-numbers] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate-contestant-numbers] Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
