/**
 * Clears ALL Season 2 data from the database without touching:
 *   - User accounts / login credentials
 *   - Season 1 record
 *   - Categories
 *   - Settings
 *   - Sponsors / sponsor_testimonials / sponsor_benefits / sponsor_tiers
 *
 * Run: node db/clear-season2.js --force
 *
 * Irreversible. Refuses to run in production (NODE_ENV=production) and
 * requires --force to prevent an accidental invocation.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production. This permanently deletes Season 2 data.');
  process.exit(1);
}
if (!process.argv.includes('--force')) {
  console.error('This PERMANENTLY deletes all Season 2 contestants, votes, scores, and rounds.');
  console.error('Re-run with --force to confirm: node db/clear-season2.js --force');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected.\n');

    // Find season 2 id
    const { rows: s2Rows } = await client.query(
      "SELECT id FROM seasons WHERE number = 2 LIMIT 1"
    );
    if (!s2Rows.length) {
      console.log('Season 2 not found in database — nothing to clear.');
      return;
    }
    const s2Id = s2Rows[0].id;
    console.log(`Season 2 id: ${s2Id}\n`);

    // Find contestant ids belonging to season 2
    const { rows: cRows } = await client.query(
      'SELECT id FROM contestants WHERE season_id = $1', [s2Id]
    );
    const cIds = cRows.map((r) => r.id);
    console.log(`Contestants in season 2: ${cIds.length}`);

    await client.query('BEGIN');

    // 1. Votes + voting codes
    if (cIds.length) {
      await client.query('DELETE FROM votes WHERE contestant_id = ANY($1)', [cIds]);
    }
    const { rows: vcRows } = await client.query(
      'SELECT id FROM voting_codes WHERE round_id IN (SELECT id FROM rounds WHERE season_id = $1)', [s2Id]
    );
    if (vcRows.length) {
      await client.query('DELETE FROM votes WHERE voting_code_id = ANY($1)', [vcRows.map((r) => r.id)]);
      await client.query('DELETE FROM voting_codes WHERE id = ANY($1)', [vcRows.map((r) => r.id)]);
    }
    // Also catch any orphan voting codes not linked to a round
    await client.query("DELETE FROM voting_codes WHERE round_id IS NULL AND used = FALSE");
    console.log('  votes + voting codes cleared');

    // 2. Performance scores → performances
    if (cIds.length) {
      const { rows: pRows } = await client.query(
        'SELECT id FROM performances WHERE contestant_id = ANY($1)', [cIds]
      );
      if (pRows.length) {
        await client.query('DELETE FROM performance_scores WHERE performance_id = ANY($1)', [pRows.map((r) => r.id)]);
        await client.query('DELETE FROM performances WHERE id = ANY($1)', [pRows.map((r) => r.id)]);
      }
    }
    console.log('  performances + performance scores cleared');

    // 3. Audition scores
    if (cIds.length) {
      await client.query('DELETE FROM audition_scores WHERE contestant_id = ANY($1)', [cIds]);
    }
    console.log('  audition scores cleared');

    // 4. Contestant media
    if (cIds.length) {
      await client.query('DELETE FROM contestant_media WHERE contestant_id = ANY($1)', [cIds]);
    }
    console.log('  contestant media cleared');

    // 5. Notifications (contestant-linked)
    if (cIds.length) {
      await client.query('DELETE FROM notifications WHERE contestant_id = ANY($1)', [cIds]);
    }
    console.log('  contestant notifications cleared');

    // 6. Contestant user accounts (unlink then delete)
    if (cIds.length) {
      const { rows: uRows } = await client.query(
        'SELECT user_id FROM contestants WHERE id = ANY($1) AND user_id IS NOT NULL', [cIds]
      );
      await client.query('UPDATE contestants SET user_id = NULL WHERE id = ANY($1)', [cIds]);
      if (uRows.length) {
        const uIds = uRows.map((r) => r.user_id);
        await client.query("DELETE FROM users WHERE id = ANY($1) AND role = 'contestant'", [uIds]);
      }
      // 7. Contestants
      await client.query('DELETE FROM contestants WHERE season_id = $1', [s2Id]);
    }
    console.log('  contestants + contestant user accounts cleared');

    // 8. Rounds
    await client.query('DELETE FROM rounds WHERE season_id = $1', [s2Id]);
    console.log('  rounds cleared');

    // 9. Announcements
    await client.query('DELETE FROM announcements WHERE season_id = $1', [s2Id]);
    console.log('  announcements cleared');

    // 10. Schedule entries
    await client.query('DELETE FROM schedule_entries WHERE season_id = $1', [s2Id]);
    console.log('  schedule entries cleared');

    // 11. Audit logs (optional cleanup)
    await client.query('DELETE FROM audit_log');
    await client.query('DELETE FROM permission_audit_log');
    console.log('  audit logs cleared');

    // 12. Delete season 2 record
    await client.query('DELETE FROM seasons WHERE id = $1', [s2Id]);
    console.log('  season 2 record deleted');

    await client.query('COMMIT');

    // Verify what remains
    const { rows: seasons }     = await client.query('SELECT number, name, status FROM seasons ORDER BY number');
    const { rows: users }       = await client.query("SELECT role, COUNT(*) c FROM users GROUP BY role ORDER BY role");
    const { rows: cats }        = await client.query('SELECT COUNT(*) c FROM categories');
    const { rows: testimonials} = await client.query('SELECT COUNT(*) c FROM sponsor_testimonials');
    const { rows: benefits }    = await client.query('SELECT COUNT(*) c FROM sponsor_benefits');
    const { rows: tiers }       = await client.query('SELECT COUNT(*) c FROM sponsor_tiers');

    console.log('\n══════════════════════════════════════════════════════════');
    console.log(' SEASON 2 CLEARED — remaining data:');
    console.log('══════════════════════════════════════════════════════════');
    console.log('\n Seasons:');
    seasons.forEach((s) => console.log(`   Season ${s.number} — ${s.name} [${s.status}]`));
    console.log('\n Users:');
    users.forEach((u) => console.log(`   ${u.role.padEnd(26)} × ${u.c}`));
    console.log(`\n Categories:          ${cats[0].c}`);
    console.log(` Sponsor testimonials: ${testimonials[0].c}`);
    console.log(` Sponsor benefits:     ${benefits[0].c}`);
    console.log(` Sponsor tiers:        ${tiers[0].c}`);
    console.log('\n Login credentials are unchanged.');
    console.log('══════════════════════════════════════════════════════════\n');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
