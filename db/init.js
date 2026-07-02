require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { hashPassword } = require('../lib/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('[init] Connected to PostgreSQL.');

    // 1. Run schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('[init] Schema applied.');

    // 2. Default season (Season 1 on first install)
    const { rows: existingSeasons } = await client.query('SELECT COUNT(*) FROM seasons');
    if (Number(existingSeasons[0].count) === 0) {
      await client.query(
        `INSERT INTO seasons (number, name, status, is_current) VALUES (1, 'Season One', 'active', TRUE)`
      );
      console.log('[init] Default Season One created and set as current.');
    } else {
      console.log('[init] Seasons already exist — skipping.');
    }

    // 4. Default categories
    const categories = [
      { name: 'Dancing',       slug: 'dancing',       display_order: 1 },
      { name: 'Singing',       slug: 'singing',       display_order: 2 },
      { name: 'Rapping',       slug: 'rapping',       display_order: 3 },
      { name: 'Comedy',        slug: 'comedy',        display_order: 4 },
      { name: 'Creative Arts', slug: 'creative-arts', display_order: 5 },
      { name: 'Spoken Words',  slug: 'spoken-words',  display_order: 6 },
    ];
    for (const cat of categories) {
      await client.query(
        `INSERT INTO categories (name, slug, display_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, display_order = EXCLUDED.display_order`,
        [cat.name, cat.slug, cat.display_order]
      );
    }
    // Remove old/merged slugs no longer used — but only if no contestant still
    // references them. On a fresh install this is always true; on an upgraded
    // install with legacy data, run `node db/migrate-categories.js` first to
    // remap those contestants onto the 6 current categories.
    await client.query(`
      DELETE FROM categories c
      WHERE c.slug IN ('singing-rapping','spoken-word','others','fashion','other')
        AND NOT EXISTS (SELECT 1 FROM contestants k WHERE k.category_id = c.id)
    `);

    console.log('[init] Default categories seeded.');

    // 5. Default audition criteria
    const auditionCriteria = [
      { name: 'Creativity',     max_score: 10, display_order: 1 },
      { name: 'Talent',         max_score: 10, display_order: 2 },
      { name: 'Stage Presence', max_score: 10, display_order: 3 },
      { name: 'Confidence',     max_score: 10, display_order: 4 }
    ];
    const { rows: existingAC } = await client.query('SELECT COUNT(*) FROM audition_criteria');
    if (Number(existingAC[0].count) === 0) {
      for (const ac of auditionCriteria) {
        await client.query(
          'INSERT INTO audition_criteria (name, max_score, display_order) VALUES ($1, $2, $3)',
          [ac.name, ac.max_score, ac.display_order]
        );
      }
      console.log('[init] Default audition criteria seeded.');
    }

    // 6. Default performance/live scoring criteria
    const performanceCriteria = [
      { name: 'Performance',    max_score: 20, display_order: 1 },
      { name: 'Creativity',     max_score: 20, display_order: 2 },
      { name: 'Audience Impact',max_score: 20, display_order: 3 },
      { name: 'Confidence',     max_score: 20, display_order: 4 },
      { name: 'Professionalism',max_score: 20, display_order: 5 }
    ];
    const { rows: existingSC } = await client.query('SELECT COUNT(*) FROM scoring_criteria');
    if (Number(existingSC[0].count) === 0) {
      for (const sc of performanceCriteria) {
        await client.query(
          'INSERT INTO scoring_criteria (name, max_score, display_order) VALUES ($1, $2, $3)',
          [sc.name, sc.max_score, sc.display_order]
        );
      }
      console.log('[init] Default performance criteria seeded.');
    }

    // 7. Create superuser if none exists
    const { rows: existing } = await client.query("SELECT id FROM users WHERE role = 'superuser' LIMIT 1");
    if (!existing.length) {
      const email    = process.env.SUPERUSER_EMAIL    || 'admin@liberiatalentquest.local';
      const password = process.env.SUPERUSER_PASSWORD || 'ChangeMe123!';
      const name     = process.env.SUPERUSER_NAME     || 'Super Admin';

      await client.query(
        `INSERT INTO users (name, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, 'superuser', TRUE)`,
        [name, email.toLowerCase(), hashPassword(password)]
      );

      console.log('\n========================================================');
      console.log(' Super User account created:');
      console.log(' Email:    ' + email);
      console.log(' Password: ' + password);
      console.log(' Log in at /login.html and CHANGE THIS PASSWORD immediately.');
      console.log('========================================================\n');
    } else {
      console.log('[init] Super User already exists — skipping.');
    }

    console.log('[init] Done. Database is ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[init] FAILED:', err.message);
  process.exit(1);
});
