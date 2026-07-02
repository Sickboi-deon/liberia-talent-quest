/**
 * Group entry seed — inserts 7 group contestants across all 6 categories.
 * Also seeds 6 event_photos for gallery verification.
 * Safe to re-run (skips existing by email).
 *
 * Run: node db/seed-groups.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production. This seeds demo/mock contestant data.');
  process.exit(1);
}
const { Pool } = require('pg');
const { getCurrentSeasonId } = require('../lib/seasons');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Placeholder photo — static asset, never auto-deleted
const PLACEHOLDER_PHOTO = '/assets/hero-singer.png';

const GROUPS = [
  // ── Dancing ──────────────────────────────────────────────────────────
  {
    fullName: 'The Kru Warriors',
    stageName: 'Warriors',
    county: 'Grand Kru',
    phone: '0776100001',
    email: 'kru.warriors@ltq.local',
    categorySlug: 'dancing',
    bio: 'Six young men from Grand Kru bringing traditional Kru warrior dance to the national stage.',
    talentDesc: 'High-energy traditional Kru war dance fused with contemporary street moves. Costumes, drums, and fire.',
    status: 'qualified',
    members: [
      { name: 'Cletus Nyefor',   dob: '2002-04-10', phone: '0776200001' },
      { name: 'Aaron Gboryeh',   dob: '2003-07-22', phone: '0886200002' },
      { name: 'Prince Tarr',     dob: '2001-11-05', phone: '0776200003' },
      { name: 'Musa Flomo',      dob: '2004-01-18', phone: null         },
      { name: 'James Nimely',    dob: '2002-09-30', phone: '0886200005' },
      { name: 'Victor Kla',      dob: '2003-03-14', phone: null         },
    ],
  },

  // ── Singing ──────────────────────────────────────────────────────────
  {
    fullName: 'Harmony Sisters',
    stageName: null,
    county: 'Montserrado',
    phone: '0886100002',
    email: 'harmony.sisters@ltq.local',
    categorySlug: 'singing',
    bio: 'Three sisters from Paynesville who have sung together since childhood. Known for tight a-cappella harmonies.',
    talentDesc: 'Gospel-rooted three-part a-cappella harmonies transitioning into original Liberian Afrobeats originals.',
    status: 'qualified',
    members: [
      { name: 'Faith Kollie',    dob: '1999-06-12', phone: '0886300001' },
      { name: 'Hope Kollie',     dob: '2001-02-28', phone: '0886300002' },
      { name: 'Joy Kollie',      dob: '2003-08-19', phone: null         },
    ],
  },

  // ── Rapping ──────────────────────────────────────────────────────────
  {
    fullName: 'Broad Street Cipher',
    stageName: 'BSC',
    county: 'Montserrado',
    phone: '0776100003',
    email: 'bsc.rap@ltq.local',
    categorySlug: 'rapping',
    bio: 'Four emcees who met on Broad Street in Monrovia. Freestyling since 2019, now writing serious material.',
    talentDesc: 'Original Liberian hip-hop in English and Kpelle. Topics: youth unemployment, identity, city life.',
    status: 'registered',
    members: [
      { name: 'Marco Pewee',     dob: '2000-05-03', phone: '0776400001' },
      { name: 'Jay Sumo',        dob: '1999-12-17', phone: '0776400002' },
      { name: 'Flex Donzo',      dob: '2001-08-25', phone: '0886400003' },
      { name: 'Blaze Wlah',      dob: '2002-03-09', phone: null         },
    ],
  },

  // ── Comedy ───────────────────────────────────────────────────────────
  {
    fullName: 'Too Much Pepper',
    stageName: 'TMP Comedy',
    county: 'Nimba',
    phone: '0886100004',
    email: 'tmp.comedy@ltq.local',
    categorySlug: 'comedy',
    bio: 'A comic duo from Sanniquellie. Their sketches about Nimba market life went viral on Facebook last year.',
    talentDesc: 'Live sketch comedy. Two-person scenes: a market seller and her customer — painfully relatable.',
    status: 'registered',
    members: [
      { name: 'Blessing Konneh', dob: '1998-10-04', phone: '0886500001' },
      { name: 'Samuel Duo',      dob: '2000-07-21', phone: '0776500002' },
    ],
  },

  // ── Creative Arts ─────────────────────────────────────────────────────
  {
    fullName: 'Liberia Craft Collective',
    stageName: 'LCC',
    county: 'Lofa',
    phone: '0776100005',
    email: 'lcc.arts@ltq.local',
    categorySlug: 'creative-arts',
    bio: 'Five artisans from Voinjama showcasing handmade crafts — weaving, pottery, and batik fashion on a live stage.',
    talentDesc: 'A live creative performance: weaving, batik dyeing, and pottery demonstrated simultaneously on stage.',
    status: 'waiting_list',
    members: [
      { name: 'Jenneh Wolo',     dob: '2000-01-15', phone: '0886600001' },
      { name: 'Korto Mulbah',    dob: '2001-05-27', phone: null         },
      { name: 'Finda Tamba',     dob: '1999-11-08', phone: '0776600003' },
      { name: 'Mary Bility',     dob: '2003-02-14', phone: '0886600004' },
      { name: 'Fatou Kamara',    dob: '2002-06-30', phone: null         },
    ],
  },

  // ── Spoken Words ──────────────────────────────────────────────────────
  {
    fullName: 'Roots & Rhetoric',
    stageName: null,
    county: 'Margibi',
    phone: '0886100006',
    email: 'roots.rhetoric@ltq.local',
    categorySlug: 'spoken-words',
    bio: 'Three spoken word artists from Kakata telling Liberia\'s untold stories through verse.',
    talentDesc: 'Alternating and choral spoken word poetry. Themes: post-war memory, land rights, and women\'s stories.',
    status: 'pending_payment',
    members: [
      { name: 'Alice Nyahn',     dob: '2001-03-22', phone: '0776700001' },
      { name: 'Moses Togba',     dob: '2000-09-14', phone: '0886700002' },
      { name: 'Lucia Gbor',      dob: '2002-12-05', phone: null         },
    ],
  },

  // ── Dancing (second group, different county + status) ────────────────
  {
    fullName: 'Bong County Steppers',
    stageName: 'BC Steppers',
    county: 'Bong',
    phone: '0776100007',
    email: 'bc.steppers@ltq.local',
    categorySlug: 'dancing',
    bio: 'Youth dance crew from Gbarnga competing for the first time after winning the county youth festival.',
    talentDesc: 'Afrobeats street dance and locking/popping. Synchronized 4-person routines with live drumming.',
    status: 'qualified',
    members: [
      { name: 'David Togba',     dob: '2003-07-01', phone: '0776800001' },
      { name: 'Nancy Wreh',      dob: '2004-02-18', phone: '0886800002' },
      { name: 'Emmanuel Bah',    dob: '2002-10-11', phone: null         },
      { name: 'Patience Quiaye', dob: '2003-05-28', phone: '0776800004' },
    ],
  },
];

// Gallery event photos (reference static assets — won't break if uploads/ is empty)
const GALLERY_PHOTOS = [
  { caption: 'Registration day — Monrovia', wide: false, order: 1 },
  { caption: 'Backstage before auditions', wide: true,  order: 2 },
  { caption: 'Judges panel deliberating',  wide: false, order: 3 },
  { caption: 'Opening night crowd',        wide: true,  order: 4 },
  { caption: 'Group performers on stage',  wide: false, order: 5 },
  { caption: 'Award ceremony rehearsal',   wide: false, order: 6 },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('[seed-groups] Connected.\n');

    // Fetch category map
    const { rows: cats } = await client.query('SELECT id, slug FROM categories');
    const catMap = Object.fromEntries(cats.map((c) => [c.slug, c.id]));

    const seasonId = await getCurrentSeasonId();

    // Superuser id for gallery uploads
    const { rows: suRows } = await client.query("SELECT id FROM users WHERE role = 'superuser' LIMIT 1");
    const suId = suRows[0]?.id || null;

    // ── Groups ────────────────────────────────────────────────────────
    console.log('[seed-groups] Inserting group contestants…\n');
    for (const g of GROUPS) {
      const catId = catMap[g.categorySlug];
      if (!catId) { console.log(`  SKIP — category not found: ${g.categorySlug}`); continue; }

      // Skip if already exists
      const { rows: ex } = await client.query('SELECT id FROM contestants WHERE email = $1', [g.email]);
      if (ex.length) {
        console.log(`  skipped (exists): ${g.email}`);
        continue;
      }

      const needsPayment = ['registered', 'qualified', 'waiting_list'].includes(g.status);
      const payRef       = needsPayment ? `OM-GRP-${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` : null;

      const { rows } = await client.query(
        `INSERT INTO contestants
           (full_name, stage_name, gender, date_of_birth, county, phone, email,
            category_id, short_bio, talent_description, profile_photo_url,
            status, season_id, entry_type,
            payment_method, payment_reference, payment_verified_at)
         VALUES ($1,$2,NULL,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,'group',$12,$13,$14)
         RETURNING id`,
        [
          g.fullName,
          g.stageName || null,
          g.county,
          g.phone,
          g.email,
          catId,
          g.bio,
          g.talentDesc,
          PLACEHOLDER_PHOTO,
          g.status,
          seasonId || null,
          needsPayment ? 'Orange Money' : null,
          payRef,
          needsPayment ? new Date().toISOString() : null,
        ]
      );

      const contestantId = rows[0].id;

      // Insert members
      for (let i = 0; i < g.members.length; i++) {
        const m = g.members[i];
        await client.query(
          `INSERT INTO contestant_members (contestant_id, member_name, member_dob, member_phone, display_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [contestantId, m.name, m.dob || null, m.phone || null, i]
        );
      }

      console.log(`  ${g.status.padEnd(16)} ${g.fullName.padEnd(28)} [${g.members.length} members] — ${g.categorySlug}`);
    }

    // ── Audition scores for groups that need them ─────────────────────
    const { rows: judges }   = await client.query("SELECT id FROM users WHERE role IN ('judge','head_judge')");
    const { rows: criteria } = await client.query('SELECT id, max_score FROM audition_criteria WHERE active = TRUE');

    if (judges.length && criteria.length) {
      const { rows: scoreable } = await client.query(
        `SELECT id, status FROM contestants
         WHERE entry_type = 'group'
           AND status IN ('registered','qualified','waiting_list')
           AND email = ANY($1::text[])`,
        [GROUPS.map((g) => g.email)]
      );

      let scoreCount = 0;
      for (const c of scoreable) {
        for (const judge of judges) {
          const { rows: ex } = await client.query(
            'SELECT id FROM audition_scores WHERE contestant_id = $1 AND judge_id = $2',
            [c.id, judge.id]
          );
          if (ex.length) continue;

          const baseQ = c.status === 'qualified' ? 0.78 : c.status === 'waiting_list' ? 0.52 : 0.68;
          const scores = {};
          let total = 0;
          for (const cr of criteria) {
            const val = Math.max(0, Math.min(cr.max_score,
              Math.round(cr.max_score * (baseQ + (Math.random() - 0.5) * 0.25))
            ));
            scores[cr.id] = val;
            total += val;
          }
          await client.query(
            'INSERT INTO audition_scores (contestant_id, judge_id, scores, total_score) VALUES ($1,$2,$3,$4)',
            [c.id, judge.id, JSON.stringify(scores), total]
          );
          scoreCount++;
        }
      }
      if (scoreCount) console.log(`\n[seed-groups] ${scoreCount} audition score rows added.`);
    } else {
      console.log('\n[seed-groups] No judges or criteria found — skipping audition scores.');
    }

    // ── Event photos (gallery) ─────────────────────────────────────────
    console.log('\n[seed-groups] Seeding gallery event photos…');
    for (const p of GALLERY_PHOTOS) {
      const { rows: ex } = await client.query(
        'SELECT id FROM event_photos WHERE caption = $1', [p.caption]
      );
      if (ex.length) { console.log(`  skipped (exists): "${p.caption}"`); continue; }

      await client.query(
        `INSERT INTO event_photos (file_path, media_type, caption, wide, display_order, active, uploaded_by, season_id)
         VALUES ($1,'photo',$2,$3,$4,TRUE,$5,$6)`,
        [PLACEHOLDER_PHOTO, p.caption, p.wide, p.order, suId, seasonId || null]
      );
      console.log(`  added: "${p.caption}" (wide=${p.wide})`);
    }

    // ── Verification summary ──────────────────────────────────────────
    const { rows: counts } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM contestants WHERE entry_type = 'group') AS groups,
        (SELECT COUNT(*) FROM contestant_members)                      AS members,
        (SELECT COUNT(*) FROM event_photos WHERE active = TRUE)        AS gallery_photos
    `);
    console.log('\n══════════════════════════════════════════════════════');
    console.log(' GROUP SEED SUMMARY');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Total groups in DB   : ${counts[0].groups}`);
    console.log(`  Total members in DB  : ${counts[0].members}`);
    console.log(`  Active gallery photos: ${counts[0].gallery_photos}`);
    console.log('══════════════════════════════════════════════════════\n');

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => { console.error('[seed-groups] ERROR:', err.message); process.exit(1); });
