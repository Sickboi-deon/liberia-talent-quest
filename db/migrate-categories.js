/**
 * Migrate categories to the 6 official LTQ categories.
 * Run: node db/migrate-categories.js
 *
 * This script:
 *  1. Adds/renames the 6 correct categories (Dancing, Singing, Rapping, Comedy, Creative Arts, Spoken Words)
 *  2. Re-maps any contestants from old merged slugs to the best-fit new category
 *  3. Deletes obsolete category rows (singing-rapping, spoken-word, others, fashion, other)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const NEW_CATEGORIES = [
  { name: 'Dancing',       slug: 'dancing',       display_order: 1 },
  { name: 'Singing',       slug: 'singing',       display_order: 2 },
  { name: 'Rapping',       slug: 'rapping',       display_order: 3 },
  { name: 'Comedy',        slug: 'comedy',        display_order: 4 },
  { name: 'Creative Arts', slug: 'creative-arts', display_order: 5 },
  { name: 'Spoken Words',  slug: 'spoken-words',  display_order: 6 },
];

// Old slugs → best-fit new slug (for re-mapping contestants)
const REMAP = {
  'singing-rapping': 'singing', // merged → default to singing; admin can reassign rappers
  'spoken-word':     'spoken-words',
  'others':          null,       // no clear mapping — will warn and leave null
  'fashion':         null,
  'other':           null,
};

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert correct categories
    console.log('[migrate-categories] Upserting 6 official categories…');
    for (const cat of NEW_CATEGORIES) {
      await client.query(
        `INSERT INTO categories (name, slug, display_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, display_order = EXCLUDED.display_order`,
        [cat.name, cat.slug, cat.display_order]
      );
      console.log(`  ✓ ${cat.name} (${cat.slug})`);
    }

    // 2. Re-map contestants from obsolete categories
    for (const [oldSlug, newSlug] of Object.entries(REMAP)) {
      const { rows: oldCat } = await client.query('SELECT id FROM categories WHERE slug = $1', [oldSlug]);
      if (!oldCat.length) continue;
      const oldId = oldCat[0].id;

      const { rows: affected } = await client.query(
        'SELECT id, full_name FROM contestants WHERE category_id = $1',
        [oldId]
      );
      if (!affected.length) continue;

      if (!newSlug) {
        console.warn(`\n  ⚠ ${affected.length} contestant(s) were in "${oldSlug}" which has no new equivalent.`);
        console.warn('    Their category will be set to NULL. Assign them manually in the admin panel.');
        await client.query('UPDATE contestants SET category_id = NULL WHERE category_id = $1', [oldId]);
        continue;
      }

      const { rows: newCat } = await client.query('SELECT id FROM categories WHERE slug = $1', [newSlug]);
      if (!newCat.length) { console.error(`  ERR: new category "${newSlug}" not found`); continue; }
      const newId = newCat[0].id;

      await client.query('UPDATE contestants SET category_id = $1 WHERE category_id = $2', [newId, oldId]);
      console.log(`  ↪ Moved ${affected.length} contestant(s) from "${oldSlug}" → "${newSlug}":`);
      for (const c of affected) console.log(`      - ${c.full_name}`);
    }

    // 3. Delete obsolete categories (only if no contestants remain)
    const obsolete = Object.keys(REMAP);
    for (const slug of obsolete) {
      const { rows: inUse } = await client.query(
        'SELECT COUNT(*) FROM contestants WHERE category_id = (SELECT id FROM categories WHERE slug = $1)',
        [slug]
      );
      if (Number(inUse[0].count) > 0) {
        console.warn(`  ⚠ Cannot delete "${slug}" — still has contestants. Fix manually.`);
        continue;
      }
      await client.query('DELETE FROM categories WHERE slug = $1', [slug]);
      console.log(`  🗑 Deleted obsolete category: ${slug}`);
    }

    await client.query('COMMIT');
    console.log('\n[migrate-categories] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate-categories] FAILED — rolled back.', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
