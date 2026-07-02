/**
 * Mock data seed — creates staff accounts for all 5 roles plus 10 sample contestants.
 * Run: node db/seed-mock.js
 * All staff passwords: Password123!
 * Contestant logins are set up for the 3 "qualified" contestants.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production. This seeds demo accounts with published default passwords.');
  process.exit(1);
}
const { Pool } = require('pg');
const { hashPassword } = require('../lib/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const STAFF_PASSWORD = 'Password123!';
const STAFF_HASH     = hashPassword(STAFF_PASSWORD);

const STAFF = [
  { name: 'Mary Flomo',       email: 'mary.flomo@ltq.local',       role: 'contestant_manager' },
  { name: 'Joseph Kollie',    email: 'joseph.kollie@ltq.local',     role: 'finance_manager'    },
  { name: 'Judge Sarah Doe',  email: 'sarah.doe@ltq.local',         role: 'judge'              },
  { name: 'Judge Mike Tulay', email: 'mike.tulay@ltq.local',        role: 'judge'              },
  { name: 'Alice Weah',       email: 'alice.weah@ltq.local',        role: 'content_manager'    },
];

const CONTESTANTS_RAW = [
  {
    fullName: 'Emmanuel Kpah',    stageName: 'EMK',          gender: 'Male',
    dob: '2002-03-14', county: 'Montserrado', phone: '0776543210',
    email: 'emk@ltq.local',       categorySlug: 'singing',
    bio: 'Born and raised in Paynesville, Emmanuel has been singing in church since age 7.',
    talentDesc: 'Gospel-inspired Afrobeats. My voice can hit notes most people only dream about.',
    status: 'qualified'
  },
  {
    fullName: 'Fatu Kollie',       stageName: 'Lady Fatu',    gender: 'Female',
    dob: '2001-07-22', county: 'Nimba', phone: '0886543211',
    email: 'fatu.k@ltq.local',    categorySlug: 'dancing',
    bio: 'From Sanniquellie. Dance has been my language since I learned to walk.',
    talentDesc: 'Liberian traditional dance fused with contemporary styles. Expect fire.',
    status: 'qualified'
  },
  {
    fullName: 'Marcus Brown',      stageName: 'MC Bravo',     gender: 'Male',
    dob: '1999-11-05', county: 'Margibi', phone: '0776543212',
    email: 'marcus.b@ltq.local',  categorySlug: 'comedy',
    bio: 'A civil engineering student who makes everyone laugh in class and on stage.',
    talentDesc: 'Stand-up comedy with Liberian social commentary. Will leave you in tears.',
    status: 'qualified'
  },
  {
    fullName: 'Janice Toe',        stageName: null,           gender: 'Female',
    dob: '2003-01-30', county: 'Grand Bassa', phone: '0886543213',
    email: 'janice.t@ltq.local',  categorySlug: 'spoken-words',
    bio: 'A spoken word poet who uses verse to tell Liberia\'s story.',
    talentDesc: 'Original spoken word poetry about resilience and Liberian identity.',
    status: 'qualified'
  },
  {
    fullName: 'Daniel Sumo',       stageName: 'D-Fresh',      gender: 'Male',
    dob: '2000-08-19', county: 'Bong', phone: '0776543214',
    email: 'daniel.s@ltq.local',  categorySlug: 'rapping',
    bio: 'Started rapping at 13 with a flip phone recorder. Now performing on real stages.',
    talentDesc: 'Original Liberian hip-hop with messages about youth empowerment.',
    status: 'registered'
  },
  {
    fullName: 'Patience Konneh',   stageName: 'PK Styles',    gender: 'Female',
    dob: '2004-05-11', county: 'Lofa', phone: '0886543215',
    email: 'patience.k@ltq.local',categorySlug: 'creative-arts',
    bio: 'Fashion designer and model from Voinjama. Putting Lofa on the fashion map.',
    talentDesc: 'Cultural fashion show featuring hand-made garments from Liberian fabrics.',
    status: 'registered'
  },
  {
    fullName: 'Samuel Pewee',      stageName: null,           gender: 'Male',
    dob: '1998-12-03', county: 'Maryland', phone: '0776543216',
    email: 'samuel.p@ltq.local',  categorySlug: 'dancing',
    bio: 'Dance instructor at a community center in Harper. Teaching is my calling.',
    talentDesc: 'Groovin Afro-fusion. Think Afrobeats meets traditional Kru dance.',
    status: 'waiting_list'
  },
  {
    fullName: 'Ruth Zarwolo',      stageName: 'Ruthie Z',     gender: 'Female',
    dob: '2002-09-27', county: 'Montserrado', phone: '0886543217',
    email: 'ruth.z@ltq.local',    categorySlug: 'singing',
    bio: 'High school senior with a big voice and bigger dreams.',
    talentDesc: 'RnB and soul ballads in English and Kpelle.',
    status: 'waiting_list'
  },
  {
    fullName: 'Tony Quiayee',      stageName: 'Q-Man',        gender: 'Male',
    dob: '2001-04-14', county: 'Sinoe', phone: '0776543218',
    email: 'tony.q@ltq.local',    categorySlug: 'comedy',
    bio: 'A former radio presenter who found his calling doing stand-up.',
    talentDesc: 'Observational comedy about life in rural Liberia.',
    status: 'rejected'
  },
  {
    fullName: 'Grace Wleh',        stageName: null,           gender: 'Female',
    dob: '2005-02-09', county: 'Montserrado', phone: '0886543219',
    email: 'grace.w@ltq.local',   categorySlug: 'dancing',
    bio: 'Just submitted my application! Super excited to audition.',
    talentDesc: 'Contemporary dance to original Liberian Afrobeats tracks.',
    status: 'pending_payment'
  },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('[seed-mock] Connected.\n');

    // ── Fetch category IDs ─────────────────────────────────────────
    const { rows: cats } = await client.query('SELECT id, slug FROM categories');
    const catMap = Object.fromEntries(cats.map((c) => [c.slug, c.id]));

    // ── Staff accounts ─────────────────────────────────────────────
    console.log('[seed-mock] Creating staff accounts…');
    for (const s of STAFF) {
      const { rows: ex } = await client.query('SELECT id FROM users WHERE email = $1', [s.email]);
      if (ex.length) { console.log(`  skipped (exists): ${s.email}`); continue; }
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, FALSE)`,
        [s.name, s.email, STAFF_HASH, s.role]
      );
      console.log(`  created: ${s.role} — ${s.email}`);
    }

    // ── Contestants ────────────────────────────────────────────────
    console.log('\n[seed-mock] Creating contestants…');
    const createdContestants = [];

    for (const c of CONTESTANTS_RAW) {
      const catId = catMap[c.categorySlug];
      if (!catId) { console.log(`  SKIP — category not found: ${c.categorySlug}`); continue; }

      const { rows: ex } = await client.query('SELECT id FROM contestants WHERE email = $1', [c.email]);
      if (ex.length) {
        console.log(`  skipped (exists): ${c.email}`);
        createdContestants.push({ id: ex[0].id, ...c });
        continue;
      }

      const paymentFields = ['registered','qualified','waiting_list','rejected'].includes(c.status)
        ? { payment_method: 'Orange Money', payment_reference: `OM-MOCK-${Math.floor(Math.random()*1e7)}` }
        : {};

      const { rows } = await client.query(
        `INSERT INTO contestants
           (full_name, stage_name, gender, date_of_birth, county, phone, email,
            category_id, short_bio, talent_description, status,
            payment_method, payment_reference, payment_verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          c.fullName, c.stageName || null, c.gender, c.dob, c.county, c.phone, c.email,
          catId, c.bio, c.talentDesc, c.status,
          paymentFields.payment_method || null,
          paymentFields.payment_reference || null,
          paymentFields.payment_method ? new Date().toISOString() : null
        ]
      );
      console.log(`  ${c.status.padEnd(15)} ${c.fullName}`);
      createdContestants.push({ id: rows[0].id, ...c });
    }

    // ── Contestant login accounts (for qualified) ──────────────────
    console.log('\n[seed-mock] Creating contestant login accounts for qualified contestants…');
    const CONT_PASSWORD = 'Contestant123!';
    const CONT_HASH     = hashPassword(CONT_PASSWORD);

    for (const c of createdContestants.filter((x) => x.status === 'qualified')) {
      const { rows: ex } = await client.query('SELECT id FROM users WHERE email = $1', [c.email]);
      if (ex.length) {
        console.log(`  skipped (user exists): ${c.email}`);
        await client.query('UPDATE contestants SET user_id = $1 WHERE id = $2', [ex[0].id, c.id]);
        continue;
      }
      const { rows: uRows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, must_change_password, contestant_id)
         VALUES ($1, $2, $3, 'contestant', FALSE, $4) RETURNING id`,
        [c.fullName, c.email, CONT_HASH, c.id]
      );
      await client.query('UPDATE contestants SET user_id = $1 WHERE id = $2', [uRows[0].id, c.id]);
      console.log(`  created: contestant — ${c.email}`);
    }

    // ── Audition scores (for registered + qualified + waiting_list + rejected) ──
    const { rows: judges } = await client.query("SELECT id FROM users WHERE role = 'judge'");
    const { rows: criteria } = await client.query('SELECT id, max_score FROM audition_criteria WHERE active = TRUE');

    console.log('\n[seed-mock] Seeding audition scores…');
    const scoreable = createdContestants.filter((c) => ['registered','qualified','waiting_list','rejected'].includes(c.status));

    for (const c of scoreable) {
      for (const judge of judges) {
        const { rows: ex } = await client.query(
          'SELECT id FROM audition_scores WHERE contestant_id = $1 AND judge_id = $2',
          [c.id, judge.id]
        );
        if (ex.length) continue;

        const scores = {};
        let total = 0;
        const baseQuality = c.status === 'qualified' ? 0.75 : c.status === 'waiting_list' ? 0.55 : c.status === 'registered' ? 0.7 : 0.3;
        for (const cr of criteria) {
          const val = Math.max(0, Math.min(cr.max_score, Math.round(cr.max_score * (baseQuality + (Math.random() - 0.5) * 0.3))));
          scores[cr.id] = val;
          total += val;
        }
        await client.query(
          `INSERT INTO audition_scores (contestant_id, judge_id, scores, total_score)
           VALUES ($1, $2, $3, $4)`,
          [c.id, judge.id, JSON.stringify(scores), total]
        );
      }
    }
    console.log(`  scores added for ${scoreable.length} contestants × ${judges.length} judges`);

    // ── Open registration in settings ─────────────────────────────
    await client.query(
      `UPDATE settings SET
         registration_open = TRUE, voting_open = TRUE,
         qualify_min_score = 28, waitlist_min_score = 20,
         contact_phone = '+231 77-874-7441', contact_email = 'legacyhubinc@gmail.com'
       WHERE id = 1`
    );
    console.log('\n[seed-mock] Settings updated (registration open, voting open).');

    // ── Seed some voting codes ─────────────────────────────────────
    const { rows: finManager } = await client.query("SELECT id FROM users WHERE role = 'finance_manager' LIMIT 1");
    if (finManager.length) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      function genCode() { let c = 'LTQ'; for (let i = 0; i < 7; i++) c += chars[Math.floor(Math.random() * chars.length)]; return c; }
      for (let i = 0; i < 20; i++) {
        const code = genCode();
        await client.query(
          'INSERT INTO voting_codes (code, payment_method, generated_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [code, 'Orange Money', finManager[0].id]
        );
      }
      console.log('[seed-mock] 20 voting codes generated.');

      // Cast 5 votes for qualified contestants
      const { rows: codes } = await client.query("SELECT id FROM voting_codes WHERE used = FALSE LIMIT 12");
      const qualified = createdContestants.filter((x) => x.status === 'qualified');
      let voteIdx = 0;
      for (const q of qualified) {
        for (let i = 0; i < 4 && voteIdx < codes.length; i++, voteIdx++) {
          await client.query(
            `INSERT INTO votes (contestant_id, voting_code_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [q.id, codes[voteIdx].id]
          );
          await client.query('UPDATE voting_codes SET used = TRUE, used_by_id = $1, used_at = NOW() WHERE id = $2', [q.id, codes[voteIdx].id]);
        }
      }
      console.log('[seed-mock] Sample votes cast for qualified contestants.');
    }

    // ── Announcements ──────────────────────────────────────────────
    const { rows: superuser } = await client.query("SELECT id FROM users WHERE role = 'superuser' LIMIT 1");
    if (superuser.length) {
      const announcements = [
        { title: 'Welcome to Liberia Talent Quest Season 2!', message: 'Applications are now open. Register before spots fill up. All categories welcome.' },
        { title: 'Payment deadline reminder', message: 'Please ensure your registration fee is paid within 5 days of submitting your application.' },
        { title: 'Audition results — check your email', message: 'Judges have completed audition reviews. Check your email for your qualification status.' }
      ];
      for (const a of announcements) {
        const { rows: ex } = await client.query('SELECT id FROM announcements WHERE title = $1', [a.title]);
        if (!ex.length) await client.query('INSERT INTO announcements (title, message, posted_by) VALUES ($1, $2, $3)', [a.title, a.message, superuser[0].id]);
      }
      console.log('[seed-mock] Announcements seeded.');
    }

    // ── Schedule ──────────────────────────────────────────────────
    const schedule = [
      { title: 'Registration Closes', datetime: '2026-07-15T23:59:00Z', location: 'Online', notes: 'Last day to submit applications' },
      { title: 'Live Show — Week 1',  datetime: '2026-08-02T18:00:00Z', location: 'Unity Conference Center, Monrovia', notes: 'Doors open 5 PM. 200 seats only.' },
      { title: 'Live Show — Week 2',  datetime: '2026-08-09T18:00:00Z', location: 'Unity Conference Center, Monrovia', notes: '' },
      { title: 'Semi-Finals',         datetime: '2026-08-16T18:00:00Z', location: 'Unity Conference Center, Monrovia', notes: 'Top 10 compete' },
      { title: 'Grand Finale',        datetime: '2026-08-23T18:00:00Z', location: 'Capitol Building, Monrovia', notes: 'Top 5 compete. Live on national TV.' }
    ];
    for (const s of schedule) {
      const { rows: ex } = await client.query('SELECT id FROM schedule_entries WHERE title = $1', [s.title]);
      if (!ex.length) await client.query('INSERT INTO schedule_entries (title, datetime, location, notes) VALUES ($1,$2,$3,$4)', [s.title, s.datetime, s.location, s.notes]);
    }
    console.log('[seed-mock] Schedule seeded.');

    // ── Summary ────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════');
    console.log(' MOCK DATA READY — Login credentials');
    console.log('══════════════════════════════════════════════════════');
    console.log('\n SUPERUSER');
    console.log('   Email:    you@example.com');
    console.log('   Password: ChangeMe123!');
    console.log('\n STAFF  (all use password: Password123!)');
    STAFF.forEach((s) => console.log(`   ${s.role.padEnd(22)} ${s.email}`));
    console.log('\n QUALIFIED CONTESTANTS  (password: Contestant123!)');
    createdContestants.filter((c) => c.status === 'qualified').forEach((c) =>
      console.log(`   ${c.fullName.padEnd(20)} ${c.email}`)
    );
    console.log('\n All pages at: http://localhost:3000');
    console.log('══════════════════════════════════════════════════════\n');

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => { console.error('[seed-mock] ERROR:', err.message); process.exit(1); });
