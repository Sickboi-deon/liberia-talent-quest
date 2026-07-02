/**
 * Full data seed — wipes and rebuilds ALL mock data for every part of the app.
 * Covers: staff, contestants, audition scores, rounds, performances,
 *         performance scores, voting codes, votes, announcements, schedule,
 *         sponsors, contestant_media references, settings.
 *
 * Run: node db/seed-full.js
 *
 * Superuser:  you@example.com / ChangeMe123!
 * Staff:      Password123!
 * Contestants: Contestant123!
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production. This seeds demo accounts with published default passwords.');
  process.exit(1);
}
const { Pool } = require('pg');
const { hashPassword } = require('../lib/auth');
const { ensureContestantAccount } = require('../lib/contestant-accounts');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const STAFF_HASH = hashPassword('Password123!');

// ── helpers ─────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = 'LTQ';
  for (let i = 0; i < 7; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // 1. WIPE in dependency order
    // ─────────────────────────────────────────────────────────────────────────
    console.log('Clearing existing data…');
    await client.query('DELETE FROM votes');
    await client.query('DELETE FROM voting_codes');
    await client.query('DELETE FROM performance_scores');
    await client.query('DELETE FROM performances');
    await client.query('DELETE FROM audition_scores');
    await client.query('DELETE FROM contestant_media');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM announcements');
    await client.query('DELETE FROM schedule_entries');
    await client.query('DELETE FROM sponsors');
    await client.query('UPDATE contestants SET waitlist_round_id = NULL, waitlist_position = NULL');
    await client.query('DELETE FROM rounds');
    await client.query('UPDATE contestants SET user_id = NULL');
    await client.query('DELETE FROM contestants');
    await client.query("DELETE FROM users WHERE role != 'superuser'");
    await client.query('DELETE FROM audit_log');
    await client.query('DELETE FROM permission_audit_log');
    await client.query('DELETE FROM categories');
    await client.query('DELETE FROM seasons');
    console.log('  done.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // 1b. SEASONS — create Season 1 (archived) + Season 2 (active/current)
    // ─────────────────────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO seasons (number, name, status, start_date, end_date, is_current,
                            registration_fee_lrd, voting_code_price_lrd, usd_to_lrd_rate)
       VALUES (1, 'Season One', 'archived', '2025-01-01', '2025-09-30', FALSE, 500, 100, 180)`
    );
    const { rows: s2Rows } = await client.query(
      `INSERT INTO seasons (number, name, status, start_date, end_date, is_current,
                            registration_fee_lrd, voting_code_price_lrd, usd_to_lrd_rate)
       VALUES (2, 'Season Two', 'active', '2026-01-01', '2026-09-30', TRUE, 500, 100, 180)
       RETURNING id`
    );
    const season2Id = s2Rows[0].id;
    console.log(`Seasons seeded: Season One (archived), Season Two (current, id: ${season2Id})\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // 2. CATEGORIES — re-seed with the canonical slugs that match the public UI
    // ─────────────────────────────────────────────────────────────────────────
    const CAT_DEFS = [
      { name: 'Dancing',       slug: 'dancing',       order: 1 },
      { name: 'Singing',       slug: 'singing',       order: 2 },
      { name: 'Rapping',       slug: 'rapping',       order: 3 },
      { name: 'Comedy',        slug: 'comedy',        order: 4 },
      { name: 'Creative Arts', slug: 'creative-arts', order: 5 },
      { name: 'Spoken Words',  slug: 'spoken-words',  order: 6 },
    ];
    for (const cat of CAT_DEFS) {
      await client.query(
        'INSERT INTO categories (name, slug, display_order) VALUES ($1,$2,$3)',
        [cat.name, cat.slug, cat.order]
      );
    }
    const { rows: cats } = await client.query('SELECT id, slug FROM categories');
    const catMap = Object.fromEntries(cats.map((c) => [c.slug, c.id]));
    console.log(`Categories seeded: ${Object.keys(catMap).join(', ')}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. STAFF ACCOUNTS
    // ─────────────────────────────────────────────────────────────────────────
    const STAFF_DEFS = [
      { name: 'Mary Flomo',               email: 'mary.flomo@ltq.local',            role: 'contestant_manager',    perms: ['manage_contestants', 'submit_performances'] },
      { name: 'Joseph Kollie',            email: 'joseph.kollie@ltq.local',          role: 'finance_manager',       perms: ['verify_payments', 'manage_voting_codes'] },
      { name: 'Judge Sarah Doe',          email: 'sarah.doe@ltq.local',              role: 'judge',                 perms: [] },
      { name: 'Judge Mike Tulay',         email: 'mike.tulay@ltq.local',             role: 'judge',                 perms: [] },
      { name: 'Judge Grace Nyema',        email: 'grace.nyema@ltq.local',            role: 'judge',                 perms: [] },
      { name: 'Alice Weah',               email: 'alice.weah@ltq.local',             role: 'content_manager',       perms: ['manage_content', 'manage_announcements', 'manage_schedule'] },
      { name: 'David Kamara',             email: 'david.kamara@ltq.local',           role: 'admin',                 perms: ['manage_users', 'manage_contestants', 'view_all_scores'] },
      { name: 'Chief Judge Fanta Konneh', email: 'fanta.konneh@ltq.local',           role: 'head_judge',            perms: ['view_all_scores'] },
      { name: 'Emmanuel Dolo',            email: 'emmanuel.dolo@ltq.local',          role: 'media_coordinator',     perms: ['manage_media', 'submit_performances'] },
      { name: 'Patricia Sumo',            email: 'patricia.sumo@ltq.local',          role: 'communications_manager', perms: ['send_notifications', 'configure_notifications', 'manage_announcements'] },
    ];

    const staffIds = {};
    console.log('Creating staff…');
    for (const s of STAFF_DEFS) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, permissions, must_change_password)
         VALUES ($1,$2,$3,$4,$5,FALSE) RETURNING id`,
        [s.name, s.email, STAFF_HASH, s.role, JSON.stringify(s.perms || [])]
      );
      staffIds[s.role] = staffIds[s.role] || [];
      staffIds[s.role].push(rows[0].id);
      const permStr = s.perms && s.perms.length ? `[${s.perms.join(', ')}]` : '';
      console.log(`  ${s.role.padEnd(24)} ${s.email} ${permStr}`);
    }
    const judgeIds = staffIds['judge'];
    const finId    = staffIds['finance_manager'][0];
    const cmId     = staffIds['contestant_manager'][0];

    // ─────────────────────────────────────────────────────────────────────────
    // 4. CONTESTANTS (varied statuses + rich bios)
    // ─────────────────────────────────────────────────────────────────────────
    const CONTESTANTS_DEF = [
      // ── DANCING (10) ──────────────────────────────────────────────────────────
      { fn: 'Fatu Kollie',       sn: 'Lady Fatu',    g: 'Female', dob: '2001-07-22', co: 'Nimba',        ph: '0886543211', em: 'fatu.k@ltq.local',        cat: 'dancing',       bio: 'From Sanniquellie. Dance has been my language since I learned to walk.',                       td: 'Liberian traditional dance fused with contemporary styles. Expect fire.',                      st: 'qualified'      },
      { fn: 'James Tarwoe',      sn: 'J-Blazer',     g: 'Male',   dob: '1998-04-22', co: 'Sinoe',        ph: '0776543221', em: 'james.t@ltq.local',        cat: 'dancing',       bio: 'Former member of the Liberia National Youth Dance Ensemble.',                                  td: 'High-energy acrobatic dance that fuses breakdance with traditional Krahn steps.',             st: 'qualified'      },
      { fn: 'Hawa Kollie',       sn: 'Hawa Fire',    g: 'Female', dob: '2003-02-14', co: 'Grand Cape',   ph: '0886543240', em: 'hawa.k@ltq.local',         cat: 'dancing',       bio: 'Started dance ministry at her Pentecostal church before moving into stage performance.',     td: 'Contemporary worship-meets-afrobeats choreography with original music.',                      st: 'qualified'      },
      { fn: 'Kelvin Mulbah',     sn: 'K-Moves',      g: 'Male',   dob: '2000-09-08', co: 'Margibi',      ph: '0776543241', em: 'kelvin.m@ltq.local',       cat: 'dancing',       bio: 'Self-taught street dancer from Kakata who learned from YouTube and local crews.',             td: 'Urban street dance: locking, popping and Liberian azonto mashup.',                            st: 'qualified'      },
      { fn: 'Pewu Tarr',         sn: 'PewStar',      g: 'Female', dob: '2004-11-20', co: 'Rivercess',    ph: '0886543242', em: 'pewu.t@ltq.local',          cat: 'dancing',       bio: 'County cultural ambassador. Competed in West Africa regional dance competitions at 18.',     td: 'Traditional Bassa ceremonial dance adapted for a modern competition stage.',                  st: 'qualified'      },
      { fn: 'Samuel Pewee',      sn: null,           g: 'Male',   dob: '1998-12-03', co: 'Maryland',     ph: '0776543216', em: 'samuel.p@ltq.local',        cat: 'dancing',       bio: 'Dance instructor at a community center in Harper. Teaching is my calling.',                    td: 'Groovin Afro-fusion. Think Afrobeats meets traditional Kru dance.',                           st: 'waiting_list'   },
      { fn: 'George Wiah',       sn: 'G-Wiah',       g: 'Male',   dob: '2000-11-30', co: 'Grand Gedeh',  ph: '0776543227', em: 'george.w@ltq.local',        cat: 'dancing',       bio: 'Self-taught dancer performing at local events since age 14.',                                  td: 'Contemporary African dance with original choreography inspired by Liberian folklore.',        st: 'waiting_list'   },
      { fn: 'Binah Flomo',       sn: null,           g: 'Female', dob: '2005-05-30', co: 'Bong',         ph: '0886543243', em: 'binah.f@ltq.local',         cat: 'dancing',       bio: 'Just graduated from secondary school. Dance has always been her first love.',                 td: 'Afrobeats freestyle with acrobatic elements learned from online tutorials.',                  st: 'registered'     },
      { fn: 'Grace Wleh',        sn: null,           g: 'Female', dob: '2005-02-09', co: 'Montserrado',  ph: '0886543219', em: 'grace.w@ltq.local',         cat: 'dancing',       bio: 'Just submitted her application. Super excited to audition.',                                    td: 'Contemporary dance to original Liberian Afrobeats tracks.',                                   st: 'pending_payment'},
      { fn: 'David Sayon',       sn: 'Sayon D',      g: 'Male',   dob: '2001-06-17', co: 'Nimba',        ph: '0776543244', em: 'david.s@ltq.local',         cat: 'dancing',       bio: 'Applied twice before. Ready to show the judges what changed.',                                  td: 'Fusion of Mano and Gio traditional steps with Afro-Caribbean footwork.',                      st: 'rejected'       },

      // ── SINGING (10) ──────────────────────────────────────────────────────────
      { fn: 'Emmanuel Kpah',     sn: 'EMK',          g: 'Male',   dob: '2002-03-14', co: 'Montserrado',  ph: '0776543210', em: 'emk@ltq.local',            cat: 'singing',       bio: 'Born and raised in Paynesville, Emmanuel has been singing in church since age 7.',            td: 'Gospel-inspired Afrobeats. My voice can hit notes most people only dream about.',             st: 'qualified'      },
      { fn: 'Aminata Kamara',    sn: 'Mina K',       g: 'Female', dob: '2002-06-18', co: 'Montserrado',  ph: '0886543220', em: 'aminata.k@ltq.local',       cat: 'singing',       bio: 'Studied music theory at the University of Liberia. Brings classical technique to Afrobeats.', td: 'Soulful ballads blending Liberian folk melodies with modern R&B.',                            st: 'qualified'      },
      { fn: 'Gifty Nimely',      sn: 'Queen Gifty',  g: 'Female', dob: '2001-04-05', co: 'Grand Bassa',  ph: '0886543229', em: 'gifty.n@ltq.local',         cat: 'singing',       bio: 'Three-time national choir competition winner from Buchanan.',                                  td: 'Powerhouse Afro-soul vocals blending Bassa traditions with contemporary gospel.',             st: 'qualified'      },
      { fn: 'Joseph Korvah',     sn: 'King Joseph',  g: 'Male',   dob: '1999-10-12', co: 'Lofa',         ph: '0776543245', em: 'joseph.ko@ltq.local',       cat: 'singing',       bio: 'Professional vocalist who has performed at the Executive Mansion National Day celebrations.',  td: 'Patriotic ballads in English and Lorma; hits that make the crowd stand up.',                  st: 'qualified'      },
      { fn: 'Martha Nyah',       sn: 'Lady Martha',  g: 'Female', dob: '2003-07-28', co: 'Bong',         ph: '0886543246', em: 'martha.n@ltq.local',         cat: 'singing',       bio: 'Grew up singing lullabies to her siblings. Her mother says she was born performing.',         td: 'Afropop originals with Kpelle language bridges. Think Afrobeats meets storytelling.',         st: 'qualified'      },
      { fn: 'Lorpu Kollie',      sn: 'Lor-Star',     g: 'Female', dob: '2003-09-14', co: 'Nimba',        ph: '0886543226', em: 'lorpu.k@ltq.local',          cat: 'singing',       bio: 'Choir director at her church since age 16. Trained in classical and gospel music.',           td: 'Powerful gospel-meets-pop ballads performed entirely in Liberian languages.',                 st: 'waiting_list'   },
      { fn: 'Aaron Flomo',       sn: 'A-Flo',        g: 'Male',   dob: '2004-08-01', co: 'Margibi',      ph: '0776543228', em: 'aaron.f@ltq.local',          cat: 'singing',       bio: 'High school student who performs at school events and local churches.',                        td: 'Pop and afrobeats covers with original arrangements.',                                        st: 'waiting_list'   },
      { fn: 'Ruth Zarwolo',      sn: 'Ruthie Z',     g: 'Female', dob: '2002-09-27', co: 'Montserrado',  ph: '0886543217', em: 'ruth.z@ltq.local',           cat: 'singing',       bio: 'High school senior with a big voice and bigger dreams.',                                        td: 'RnB and soul ballads in English and Kpelle.',                                                 st: 'registered'     },
      { fn: 'Cynthia Konneh',    sn: null,           g: 'Female', dob: '2005-01-09', co: 'Lofa',         ph: '0886543247', em: 'cynthia.k@ltq.local',        cat: 'singing',       bio: 'First-time applicant. Has been preparing this performance for two years.',                    td: 'Original love song performed in Mandingo and English; composed the music herself.',           st: 'pending_payment'},
      { fn: 'Francis Togba',     sn: 'F-Note',       g: 'Male',   dob: '2000-04-15', co: 'Grand Kru',    ph: '0776543248', em: 'francis.t@ltq.local',        cat: 'singing',       bio: 'Trained at a missionary music school in Harper. Tenor voice.',                                 td: 'Operatic-influenced Liberian folk songs delivered in four languages.',                        st: 'rejected'       },

      // ── RAPPING (10) ──────────────────────────────────────────────────────────
      { fn: 'Daniel Sumo',       sn: 'D-Fresh',      g: 'Male',   dob: '2000-08-19', co: 'Bong',         ph: '0776543214', em: 'daniel.s@ltq.local',        cat: 'rapping',       bio: 'Started rapping at 13 with a flip phone recorder. Now performing on real stages.',            td: 'Original Liberian hip-hop with messages about youth empowerment.',                            st: 'qualified'      },
      { fn: 'Prince Tamba',      sn: 'PrinceTee',    g: 'Male',   dob: '2001-05-23', co: 'Montserrado',  ph: '0776543249', em: 'prince.t@ltq.local',         cat: 'rapping',       bio: 'Grew up in West Point. Rapping is how he processes everything life has thrown at him.',       td: 'Raw street rap mixed with Liberian Pidgin storytelling and social commentary.',               st: 'qualified'      },
      { fn: 'Olivia Duo',        sn: 'OliviaFire',   g: 'Female', dob: '2002-11-11', co: 'Margibi',      ph: '0886543250', em: 'olivia.d@ltq.local',         cat: 'rapping',       bio: 'One of Liberia\'s rare female rappers. Studied journalism, writes lyrics like articles.',     td: 'News-rap: verses built from real Liberian headlines. Controversial and sharp.',               st: 'qualified'      },
      { fn: 'Emmanuel Dolo Jr',  sn: 'E-Dolo',       g: 'Male',   dob: '1999-08-03', co: 'Grand Bassa',  ph: '0776543251', em: 'edolo.j@ltq.local',          cat: 'rapping',       bio: 'Named after his father, a recording artist. Music is in the blood.',                           td: 'Afrobeats-infused rap: English, Bassa and Pidgin bars over custom-produced beats.',           st: 'qualified'      },
      { fn: 'Tennyson Kollie',   sn: 'Ten-K',        g: 'Male',   dob: '2003-01-25', co: 'Nimba',        ph: '0776543252', em: 'tennyson.k@ltq.local',       cat: 'rapping',       bio: 'University student studying law. Uses rap to argue for justice.',                               td: 'Spoken-word rap hybrid. Every bar is a closing argument.',                                    st: 'qualified'      },
      { fn: 'Blessing Toe',      sn: 'B-Blessed',    g: 'Female', dob: '2004-06-19', co: 'Sinoe',        ph: '0886543253', em: 'blessing.t@ltq.local',        cat: 'rapping',       bio: 'Secondary school student who freestyles during lunch breaks. Her teachers are fans.',          td: 'Positive rap about women\'s education and opportunity in rural Liberia.',                     st: 'waiting_list'   },
      { fn: 'Marcus Karnga',     sn: 'M-Killa',      g: 'Male',   dob: '2001-03-30', co: 'Maryland',     ph: '0776543254', em: 'marcus.kar@ltq.local',       cat: 'rapping',       bio: 'Recording artist with two mixtapes released online. Looking for mainstream recognition.',     td: 'Club-ready trap rap with Liberian cultural samples.',                                         st: 'waiting_list'   },
      { fn: 'Janet Weah',        sn: 'J-Weah',       g: 'Female', dob: '2005-09-02', co: 'Montserrado',  ph: '0886543255', em: 'janet.w@ltq.local',          cat: 'rapping',       bio: 'Inspired by seeing Olivia Duo perform. First time entering.',                                   td: 'Fast-flow rap in English and Kpelle. Has every bar memorised.',                               st: 'registered'     },
      { fn: 'Victor Nyahn',      sn: 'V-Nine',       g: 'Male',   dob: '2000-12-14', co: 'Lofa',         ph: '0776543256', em: 'victor.n@ltq.local',         cat: 'rapping',       bio: 'Farmer and rapper. Wakes up early to write, performs at night.',                               td: 'Afro-rap documenting life in rural Liberia. Written and produced himself.',                   st: 'pending_payment'},
      { fn: 'Chris Koleh',       sn: 'CK Rap',       g: 'Male',   dob: '2002-07-07', co: 'Bong',         ph: '0776543257', em: 'chris.k@ltq.local',          cat: 'rapping',       bio: 'Applied before but did not pass. Trained harder and returned.',                                  td: 'Conscious rap with Bong County dialect. Judges will remember this one.',                      st: 'rejected'       },

      // ── COMEDY (10) ──────────────────────────────────────────────────────────
      { fn: 'Marcus Brown',      sn: 'MC Bravo',     g: 'Male',   dob: '1999-11-05', co: 'Margibi',      ph: '0776543212', em: 'marcus.b@ltq.local',        cat: 'comedy',        bio: 'A civil engineering student who makes everyone laugh in class and on stage.',                  td: 'Stand-up comedy with Liberian social commentary. Will leave you in tears.',                   st: 'qualified'      },
      { fn: 'Moses Kpoto',       sn: 'Moe K',        g: 'Male',   dob: '2001-03-07', co: 'Bong',         ph: '0776543225', em: 'moses.k@ltq.local',          cat: 'comedy',        bio: 'Former radio presenter with a gift for mimicry and social satire.',                            td: 'Character-based stand-up rooted in Liberian politics and daily life.',                        st: 'qualified'      },
      { fn: 'Finda Gbotoe',      sn: 'Finda Funny',  g: 'Female', dob: '2000-04-18', co: 'Grand Bassa',  ph: '0886543258', em: 'finda.g@ltq.local',          cat: 'comedy',        bio: 'Nurse by day, comedian by night. Patients say she heals with laughter.',                       td: 'Medical-meets-culture comedy. Jokes about hospitals, village life and city people.',          st: 'qualified'      },
      { fn: 'Joseph Wion',       sn: 'Joey Wion',    g: 'Male',   dob: '2002-08-29', co: 'Nimba',        ph: '0776543259', em: 'joey.w@ltq.local',           cat: 'comedy',        bio: 'TikTok comedian with 40K followers in Liberia. Ready for a live stage.',                      td: 'Viral character sketches reimagined as live stand-up. Crowd participation guaranteed.',       st: 'qualified'      },
      { fn: 'Comfort Saye',      sn: 'Comfy C',      g: 'Female', dob: '2003-12-03', co: 'Montserrado',  ph: '0886543260', em: 'comfort.s@ltq.local',        cat: 'comedy',        bio: 'Market trader who tells jokes between customers. Everyone in Waterside knows her.',           td: 'Market-life comedy: everything from price hikes to traffic. Entirely observational.',         st: 'qualified'      },
      { fn: 'Tony Quiayee',      sn: 'Q-Man',        g: 'Male',   dob: '2001-04-14', co: 'Sinoe',        ph: '0776543218', em: 'tony.q@ltq.local',           cat: 'comedy',        bio: 'Former radio presenter who found his calling doing stand-up.',                                  td: 'Observational comedy about life in rural Liberia.',                                           st: 'waiting_list'   },
      { fn: 'Bernice Saah',      sn: 'B-Laughs',     g: 'Female', dob: '2004-03-22', co: 'Lofa',         ph: '0886543261', em: 'bernice.s@ltq.local',        cat: 'comedy',        bio: 'School debate champion turned comedian. Argues with punchlines.',                               td: 'Satirical stand-up about education, politics and what "development" means in the village.',   st: 'waiting_list'   },
      { fn: 'Emmanuel Nagbe',    sn: 'Nags',         g: 'Male',   dob: '2002-10-10', co: 'Rivercess',    ph: '0776543262', em: 'nags@ltq.local',              cat: 'comedy',        bio: 'Church usher whose facial expressions alone get laughs. No words needed.',                    td: 'Silent comedy: physical, deadpan, and completely original.',                                  st: 'registered'     },
      { fn: 'Satta Bestman',     sn: null,           g: 'Female', dob: '2005-08-14', co: 'Margibi',      ph: '0886543263', em: 'satta.b@ltq.local',          cat: 'comedy',        bio: 'Recent secondary school graduate. Has been writing jokes since Form 3.',                        td: 'Youth-focused comedy about phones, school crushes and strict parents.',                       st: 'pending_payment'},
      { fn: 'Alfred Blamo',      sn: 'Blamo',        g: 'Male',   dob: '1999-05-06', co: 'Maryland',     ph: '0776543264', em: 'alfred.b@ltq.local',          cat: 'comedy',        bio: 'Has a reputation for going off-script. Judges once asked him to stop — he kept going.',        td: 'Unscripted improv comedy. Every show is different. Expect the unexpected.',                   st: 'rejected'       },

      // ── CREATIVE ARTS (10) ────────────────────────────────────────────────────
      { fn: 'Patience Konneh',   sn: 'PK Styles',    g: 'Female', dob: '2004-05-11', co: 'Lofa',         ph: '0886543215', em: 'patience.k@ltq.local',       cat: 'creative-arts', bio: 'Fashion designer from Voinjama. Putting Lofa on the fashion map.',                             td: 'Cultural fashion show featuring hand-made garments from Liberian fabrics.',                   st: 'qualified'      },
      { fn: 'Albert Tarplah',    sn: 'Al-Art',       g: 'Male',   dob: '2000-07-03', co: 'Grand Bassa',  ph: '0776543265', em: 'albert.t@ltq.local',         cat: 'creative-arts', bio: 'Visual artist who paints Liberian war memory and post-war hope. Gallery shows in Buchanan.',   td: 'Live painting performance: creates a 4-foot canvas on stage in under 10 minutes.',            st: 'qualified'      },
      { fn: 'Mary Momo',         sn: 'MaryMakes',    g: 'Female', dob: '2001-09-19', co: 'Montserrado',  ph: '0886543266', em: 'mary.m@ltq.local',           cat: 'creative-arts', bio: 'Sculptor and ceramics artist trained at a missionary arts school in Kakata.',                  td: 'Sculpture performance: shapes a clay bust of a Liberian elder live on stage.',                st: 'qualified'      },
      { fn: 'Koffa Kpaan',       sn: 'KK Design',    g: 'Male',   dob: '2002-12-28', co: 'Nimba',        ph: '0776543267', em: 'koffa.k@ltq.local',          cat: 'creative-arts', bio: 'Graphic designer and muralist. Has painted murals on schools across Nimba County.',            td: 'Digital art meets street art: projects a live-designed mural onto a screen.',                 st: 'qualified'      },
      { fn: 'Rose Nyemah',       sn: 'Rosie Art',    g: 'Female', dob: '2003-04-08', co: 'Margibi',      ph: '0886543268', em: 'rose.n@ltq.local',           cat: 'creative-arts', bio: 'Textile artist known for her tie-dye and batik. Sells at Waterside market.',                  td: 'Live batik-making turned into performance art with music and movement.',                      st: 'qualified'      },
      { fn: 'Isaac Gaye',        sn: 'IzzyG',        g: 'Male',   dob: '2004-02-17', co: 'Bong',         ph: '0776543269', em: 'isaac.g@ltq.local',          cat: 'creative-arts', bio: 'Aspiring filmmaker who also does photography for school events.',                               td: 'Projection art performance: 5-minute film he directed, scored live on stage.',                st: 'waiting_list'   },
      { fn: 'Edith Kpoleh',      sn: null,           g: 'Female', dob: '2003-11-05', co: 'Maryland',     ph: '0886543270', em: 'edith.k@ltq.local',          cat: 'creative-arts', bio: 'Jewellery maker who designs pieces from recycled materials.',                                   td: 'Wearable art showcase: original jewellery and accessories, modelled live.',                   st: 'waiting_list'   },
      { fn: 'Tommy Nagbe',       sn: 'Tom Craft',    g: 'Male',   dob: '2005-07-21', co: 'Lofa',         ph: '0776543271', em: 'tommy.n@ltq.local',          cat: 'creative-arts', bio: 'Just finished secondary school. Has been building sculptures from scrap metal since age 12.',   td: 'Scrap-metal sculpture: welding live on stage to create a piece shaped by audience input.',    st: 'registered'     },
      { fn: 'Helen Dukuly',      sn: null,           g: 'Female', dob: '2004-09-30', co: 'Nimba',        ph: '0886543272', em: 'helen.d@ltq.local',          cat: 'creative-arts', bio: 'Hand-weaving practitioner preserving Nimba County kente traditions.',                           td: 'Traditional weaving demonstration performed to live drumming.',                               st: 'pending_payment'},
      { fn: 'John Garwea',       sn: 'J-Craft',      g: 'Male',   dob: '2001-01-11', co: 'Grand Kru',    ph: '0776543273', em: 'john.g@ltq.local',           cat: 'creative-arts', bio: 'Applied, was rejected, studied more, applied again.',                                           td: 'Found-object installation art: builds a piece live using only materials from the venue.',     st: 'rejected'       },

      // ── SPOKEN WORDS (10) ─────────────────────────────────────────────────────
      { fn: 'Janice Toe',        sn: null,           g: 'Female', dob: '2003-01-30', co: 'Grand Bassa',  ph: '0886543213', em: 'janice.t@ltq.local',         cat: 'spoken-words',  bio: 'A spoken word poet who uses verse to tell Liberia\'s story.',                                  td: 'Original spoken word poetry about resilience and Liberian identity.',                         st: 'qualified'      },
      { fn: 'Richard Kpeh',      sn: 'RK Verse',     g: 'Male',   dob: '2000-06-10', co: 'Montserrado',  ph: '0776543274', em: 'richard.k@ltq.local',        cat: 'spoken-words',  bio: 'Poet laureate of the University of Liberia in 2024. Has performed at ECOWAS youth summits.',  td: 'A three-poem suite about displacement, memory and what Liberia means in 2026.',               st: 'qualified'      },
      { fn: 'Ciatta Flomo',      sn: 'C-Speak',      g: 'Female', dob: '2002-08-22', co: 'Bong',         ph: '0886543275', em: 'ciatta.f@ltq.local',         cat: 'spoken-words',  bio: 'Raised by a grandmother who was a griotte — oral historian and storyteller.',                 td: 'Intergenerational spoken word: her grandmother\'s stories in her own voice.',                 st: 'qualified'      },
      { fn: 'Moses Freeman',     sn: 'Free-Mo',      g: 'Male',   dob: '2001-12-05', co: 'Lofa',         ph: '0776543276', em: 'moses.f@ltq.local',           cat: 'spoken-words',  bio: 'Activist poet. Published a chapbook in 2025 that sold out at Monrovia bookfairs.',             td: 'Political and environmental poetry. Wants his words to change something.',                    st: 'qualified'      },
      { fn: 'Alice Nagbe',       sn: 'Ali Speaks',   g: 'Female', dob: '2003-03-17', co: 'Nimba',        ph: '0886543277', em: 'alice.n@ltq.local',          cat: 'spoken-words',  bio: 'Secondary school English teacher who writes poems for her students.',                          td: 'Spoken word about education, girlhood and the pressure to be perfect.',                      st: 'qualified'      },
      { fn: 'Steven Nyahn',      sn: 'S-Verse',      g: 'Male',   dob: '2004-10-28', co: 'Grand Cape',   ph: '0776543278', em: 'steven.n@ltq.local',         cat: 'spoken-words',  bio: 'Orphan raised by an aunt who read poetry to him at night. Now he writes it.',                  td: 'A single poem, 8 minutes, one breath — about loss and what comes after.',                    st: 'waiting_list'   },
      { fn: 'Patience Sayeh',    sn: null,           g: 'Female', dob: '2002-07-14', co: 'Sinoe',        ph: '0886543279', em: 'patience.sa@ltq.local',       cat: 'spoken-words',  bio: 'Healthcare worker who writes poetry about life in rural clinics.',                              td: 'Spoken word monologue from the perspective of a midwife in a county clinic.',                 st: 'waiting_list'   },
      { fn: 'Emmanuel Weah',     sn: 'E-Speak',      g: 'Male',   dob: '2005-04-03', co: 'Margibi',      ph: '0776543280', em: 'emmanuel.w@ltq.local',       cat: 'spoken-words',  bio: 'Teen poet who started writing after losing a friend to street violence.',                       td: 'Raw spoken word about youth violence, hope and choosing a different path.',                   st: 'registered'     },
      { fn: 'Hawa Fahnbulleh',   sn: 'HF Poet',      g: 'Female', dob: '2004-01-21', co: 'Montserrado',  ph: '0886543281', em: 'hawa.f@ltq.local',          cat: 'spoken-words',  bio: 'Diaspora returnee from Ghana. Brings West African literary traditions back home.',            td: 'Bilingual spoken word in English and Twi, exploring what home means across borders.',         st: 'pending_payment'},
      { fn: 'Thomas Goll',       sn: 'T-Goll',       g: 'Male',   dob: '2000-09-09', co: 'Maryland',     ph: '0776543282', em: 'thomas.g@ltq.local',         cat: 'spoken-words',  bio: 'Marine biologist who writes about the environment. Was rejected last season.',                td: 'Ecopoetry: spoken word about the Atlantic Ocean, Liberian fishermen and climate change.',     st: 'rejected'       },
    ];

    const contestantIds = {};
    console.log('\nCreating contestants…');
    for (const c of CONTESTANTS_DEF) {
      const catId = catMap[c.cat];
      if (!catId) { console.log(`  SKIP (no category): ${c.cat}`); continue; }
      const hasPay = ['registered','qualified','waiting_list','rejected'].includes(c.st);
      const { rows } = await client.query(
        `INSERT INTO contestants
           (full_name, stage_name, gender, date_of_birth, county, phone, email,
            category_id, short_bio, talent_description, status,
            payment_method, payment_reference, payment_verified_at, season_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          c.fn, c.sn || null, c.g, c.dob, c.co, c.ph, c.em,
          catId, c.bio, c.td, c.st,
          hasPay ? pick(['Orange Money','MTN MoMo','Cash']) : null,
          hasPay ? 'MOCK-' + rInt(1000000, 9999999) : null,
          hasPay ? new Date().toISOString() : null,
          season2Id
        ]
      );
      contestantIds[c.em] = { id: rows[0].id, ...c };
      console.log(`  ${c.st.padEnd(15)} ${c.fn}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4b. BULK CONTESTANTS — simulate a 2000-person registration pipeline.
    //     Named contestants above are the "stars". These fill the numbers.
    // ─────────────────────────────────────────────────────────────────────────
    const LIBERIAN_FIRST = [
      'Korlu','Nowai','Yatta','Garmai','Musu','Kumba','Kebeh','Tonie','Lucia','Fatuma',
      'Oretha','Yanqui','Wesseh','Pewee','Janjay','Memuna','Nenneh','Satta','Luba','Zuzu',
      'Borbor','Nimba','Tokpa','Kulah','Varfee','Flomo','Yeye','Doris','Lorwuo','Momo',
      'Trokon','Primus','Cletus','Lavala','Deddeh','Nyonblee','Dehpue','Gbarnga','Weade',
      'Hinneh','Joseh','Togar','Quiamah','Forkpah','Nyan','Brumskine','Pewu','Gbanyan',
    ];
    const LIBERIAN_LAST = [
      'Kollie','Flomo','Konneh','Weah','Doe','Toe','Nagbe','Tarr','Sumo','Kpah',
      'Nimely','Karnga','Mulbah','Tamba','Tarwoe','Pewee','Wiah','Goll','Blamo','Nyahn',
      'Sayon','Freeman','Kpeh','Bestman','Momo','Tarplah','Dukuly','Kpaan','Gaye','Garwea',
      'Gbotoe','Wion','Saye','Korvah','Nyah','Fahnbulleh','Sayeh','Togba','Duo','Karnga',
    ];
    const COUNTIES = ['Montserrado','Nimba','Bong','Lofa','Margibi','Grand Bassa','Maryland','Sinoe','Rivercess','Grand Kru','Grand Cape','Grand Gedeh'];
    const SLUG_LIST = ['dancing','singing','rapping','comedy','creative-arts','spoken-words'];

    // Status distribution simulating registration → audition → competition funnel:
    //   pending_payment : 600 (registered but payment not verified)
    //   rejected        : 800 (auditioned, didn't make it)
    //   eliminated      : 400 (qualified but eliminated during rounds)
    //   registered      : 150 (paid, waiting for audition review)
    //   waiting_list    :  50 (borderline — on waiting list from audition)
    const BULK_STATUS_DIST = [
      ...Array(600).fill('pending_payment'),
      ...Array(800).fill('rejected'),
      ...Array(400).fill('eliminated'),
      ...Array(150).fill('registered'),
      ...Array(50).fill('waiting_list'),
    ];

    console.log(`\nBulk-inserting ${BULK_STATUS_DIST.length} additional contestants…`);
    let bulkCount = 0;
    for (let i = 0; i < BULK_STATUS_DIST.length; i++) {
      const status  = BULK_STATUS_DIST[i];
      const slug    = SLUG_LIST[i % SLUG_LIST.length];
      const catId   = catMap[slug];
      const fn      = LIBERIAN_FIRST[i % LIBERIAN_FIRST.length] + ' ' + LIBERIAN_LAST[(i * 3) % LIBERIAN_LAST.length];
      const email   = `bulk${i + 1}@ltq.local`;
      const phone   = `07${String(70000000 + i).slice(1)}`;
      const dob     = `${1998 + (i % 10)}-${String((i % 12) + 1).padStart(2,'0')}-${String((i % 28) + 1).padStart(2,'0')}`;
      const county  = COUNTIES[i % COUNTIES.length];
      const hasPay  = ['registered','rejected','waiting_list','eliminated'].includes(status);
      await client.query(
        `INSERT INTO contestants
           (full_name, gender, date_of_birth, county, phone, email,
            category_id, short_bio, talent_description, status,
            payment_method, payment_reference, payment_verified_at, season_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          fn, i % 2 === 0 ? 'Female' : 'Male', dob, county, phone, email,
          catId,
          `Contestant #${i + 1} — ${county}.`,
          `Performing ${slug.replace('-', ' ')} at Liberia Talent Quest Season Two.`,
          status,
          hasPay ? pick(['Orange Money','MTN MoMo','Cash']) : null,
          hasPay ? 'BULK-' + rInt(1000000, 9999999) : null,
          hasPay ? new Date().toISOString() : null,
          season2Id,
        ]
      );
      bulkCount++;
      if (bulkCount % 250 === 0) console.log(`  … ${bulkCount} bulk contestants inserted`);
    }
    console.log(`  ${bulkCount} bulk contestants done. Total: ${Object.keys(contestantIds).length + bulkCount}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // 4c. CREATE CONTESTANT ACCOUNTS for qualified + winner
    //     Mirrors what qualification.routes.js does via ensureContestantAccount.
    //     This sets contestants.user_id, which is the CM dashboard gate.
    //     Waiting list from initial audition are intentionally excluded — they
    //     never qualified so they have no account and are invisible to the CM.
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nCreating contestant accounts (qualified + winner)…');
    for (const c of Object.values(contestantIds)) {
      if (['qualified', 'winner'].includes(c.st)) {
        await ensureContestantAccount(c.id, c.fn, c.em);
        console.log(`  account ✓  ${c.fn}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. AUDITION CRITERIA (seed defaults if missing)
    // ─────────────────────────────────────────────────────────────────────────
    const { rows: acRows } = await client.query('SELECT id, max_score FROM audition_criteria WHERE active = TRUE');
    let auditCriteria = acRows;
    if (!auditCriteria.length) {
      const defaults = [
        ['Stage Presence',    10],
        ['Technical Skill',   10],
        ['Originality',       10],
        ['Audience Appeal',   10],
      ];
      for (const [name, max_score] of defaults) {
        const { rows } = await client.query(
          'INSERT INTO audition_criteria (name, max_score, active) VALUES ($1,$2,TRUE) RETURNING id, max_score',
          [name, max_score]
        );
        auditCriteria.push(rows[0]);
      }
      console.log('\nAudition criteria seeded (none existed).');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. AUDITION SCORES (for all non-pending contestants)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding audition scores…');
    const scoreable = Object.values(contestantIds).filter((c) =>
      ['registered','qualified','waiting_list','rejected'].includes(c.st)
    );
    const scoreQuality = { qualified: 0.82, registered: 0.72, waiting_list: 0.52, rejected: 0.28 };
    for (const c of scoreable) {
      for (const jid of judgeIds) {
        const scores = {};
        let total = 0;
        const base = scoreQuality[c.st] || 0.5;
        for (const cr of auditCriteria) {
          const val = Math.max(1, Math.min(cr.max_score, Math.round(cr.max_score * (base + (Math.random() - 0.5) * 0.25))));
          scores[cr.id] = val;
          total += val;
        }
        await client.query(
          'INSERT INTO audition_scores (contestant_id, judge_id, scores, total_score) VALUES ($1,$2,$3,$4)',
          [c.id, jid, JSON.stringify(scores), total]
        );
      }
    }
    console.log(`  ${scoreable.length} contestants × ${judgeIds.length} judges`);

    // ─────────────────────────────────────────────────────────────────────────
    // 8. ROUNDS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding rounds…');
    const ROUND_DEFS = [
      { name: 'Week 1 — Audition Stage', order: 1, status: 'closed',   type: 'audition'     },
      { name: 'Week 2 — Quarter Finals', order: 2, status: 'closed',   type: 'competition'  },
      { name: 'Semi-Finals',             order: 3, status: 'scoring',  type: 'competition'  },
      { name: 'Grand Finale',            order: 4, status: 'upcoming', type: 'competition'  },
    ];
    const roundIds = {};
    for (const r of ROUND_DEFS) {
      const { rows } = await client.query(
        'INSERT INTO rounds (name, display_order, status, round_type, season_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [r.name, r.order, r.status, r.type, season2Id]
      );
      roundIds[r.name] = rows[0].id;
      console.log(`  [${r.status}] [${r.type}] ${r.name}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. PERFORMANCE SCORING CRITERIA (seed defaults if missing)
    // ─────────────────────────────────────────────────────────────────────────
    const { rows: pcRows } = await client.query('SELECT id, max_score FROM scoring_criteria WHERE active = TRUE');
    let perfCriteria = pcRows;
    if (!perfCriteria.length) {
      const defaults = [
        ['Performance Quality', 20],
        ['Creativity',          20],
        ['Crowd Energy',        20],
        ['Technical Execution', 20],
        ['Overall Impression',  20],
      ];
      for (const [name, max_score] of defaults) {
        const { rows } = await client.query(
          'INSERT INTO scoring_criteria (name, max_score, active) VALUES ($1,$2,TRUE) RETURNING id, max_score',
          [name, max_score]
        );
        perfCriteria.push(rows[0]);
      }
      console.log('\nPerformance criteria seeded (none existed).');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. PERFORMANCES + PERFORMANCE SCORES (for qualified contestants in closed/scoring rounds)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding performances…');
    const qualified = Object.values(contestantIds).filter((c) => ['qualified','winner'].includes(c.st));
    const activeRounds = [
      { name: 'Week 1 — Audition Stage', type: 'audition'    },
      { name: 'Week 2 — Quarter Finals', type: 'competition' },
      { name: 'Semi-Finals',             type: 'competition' },
    ];
    const songNames = [
      'Amazing Grace (cover)', 'Original Afrobeats Medley', 'My Liberia (original)',
      'Fire on Stage', 'Dance of the Ancestors', 'Stand-Up Special',
      'Words for the Homeland', 'The People\'s Song', 'Rise Up Liberia'
    ];

    for (const round of activeRounds) {
      const roundName = round.name;
      const perfType  = round.type === 'audition' ? 'video' : 'live';
      const rid = roundIds[roundName];
      let idx = 0;
      for (const c of qualified) {
        const { rows: perfRows } = await client.query(
          `INSERT INTO performances (contestant_id, round_id, performance_type, song_name, description)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [c.id, rid, perfType, pick(songNames), `Performance by ${c.fn} in ${roundName}.`]
        );
        const perfId = perfRows[0].id;
        idx++;

        // Judge scores for closed/scoring rounds
        const perf_quality = qualified.indexOf(c) < 4 ? 0.85 : 0.70; // top 4 score higher
        for (const jid of judgeIds) {
          const scores = {};
          let total = 0;
          for (const cr of perfCriteria) {
            const val = Math.max(5, Math.min(cr.max_score, Math.round(cr.max_score * (perf_quality + (Math.random() - 0.5) * 0.2))));
            scores[cr.id] = val;
            total += val;
          }
          await client.query(
            'INSERT INTO performance_scores (performance_id, judge_id, scores, total_score) VALUES ($1,$2,$3,$4)',
            [perfId, jid, JSON.stringify(scores), total]
          );
        }
      }
      console.log(`  ${roundName} [${perfType}]: ${qualified.length} performances + scores`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. VOTING CODES + VOTES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding voting codes and votes…');
    const semiId = roundIds['Semi-Finals'];
    const codes = [];
    const totalCodes = 600; // ~20 per qualified contestant average
    for (let i = 0; i < totalCodes; i++) {
      const code = genCode();
      const { rows } = await client.query(
        'INSERT INTO voting_codes (code, payment_method, generated_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
        [code, pick(['Orange Money','MTN MoMo','Cash']), finId]
      );
      if (rows.length) codes.push(rows[0].id);
    }

    // Distribute votes across qualified contestants; top performers get more votes
    let codeIdx = 0;
    for (let qi = 0; qi < qualified.length && codeIdx < codes.length; qi++) {
      const share = qi < 6 ? 30 : qi < 12 ? 22 : qi < 20 ? 16 : 10;
      for (let v = 0; v < share && codeIdx < codes.length; v++, codeIdx++) {
        await client.query(
          'INSERT INTO votes (contestant_id, voting_code_id, round_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [qualified[qi].id, codes[codeIdx], semiId]
        );
        await client.query(
          'UPDATE voting_codes SET used = TRUE, used_by_id = $1, used_at = NOW(), round_id = $2 WHERE id = $3',
          [qualified[qi].id, semiId, codes[codeIdx]]
        );
      }
    }
    console.log(`  ${totalCodes} voting codes, ${codeIdx} votes cast in Semi-Finals`);

    // ─────────────────────────────────────────────────────────────────────────
    // 11b. ACCOUNTING BACK-FILL
    //      The routes auto-create entries when fees > 0, but the seed bypasses
    //      the routes. Back-fill manually using the same fee values set above.
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding accounting entries…');
    const { rows: s2pricing } = await client.query(
      'SELECT registration_fee_lrd, voting_code_price_lrd, usd_to_lrd_rate FROM seasons WHERE id = $1',
      [season2Id]
    );
    const REG_FEE_LRD  = parseFloat(s2pricing[0]?.registration_fee_lrd  || 0);
    const VOTE_FEE_LRD = parseFloat(s2pricing[0]?.voting_code_price_lrd || 0);
    const USD_RATE     = parseFloat(s2pricing[0]?.usd_to_lrd_rate       || 180);

    // Registration fees — named contestants who have payment_method set
    const paidStatuses = ['registered', 'qualified', 'waiting_list', 'rejected', 'eliminated'];
    const paidNamed = Object.values(contestantIds).filter((c) => paidStatuses.includes(c.st));
    let regCount = 0;
    for (const c of paidNamed) {
      if (REG_FEE_LRD > 0) {
        await client.query(
          `INSERT INTO accounting_entries
             (season_id, type, amount_lrd, amount_usd, reference_id, reference_name, description)
           VALUES ($1, 'registration', $2, $3, $4, $5, $6)`,
          [season2Id, REG_FEE_LRD, parseFloat((REG_FEE_LRD / USD_RATE).toFixed(2)),
           c.id, c.fn, `Registration fee — ${c.fn}`]
        );
        regCount++;
      }
    }

    // Registration fees — bulk contestants with paid statuses (sample every 10th to keep ledger manageable)
    const { rows: bulkPaid } = await client.query(
      `SELECT id, full_name FROM contestants
       WHERE season_id = $1 AND status = ANY($2::text[]) AND email LIKE 'bulk%'
       ORDER BY created_at LIMIT 500`,
      [season2Id, paidStatuses]
    );
    for (const c of bulkPaid) {
      if (REG_FEE_LRD > 0) {
        await client.query(
          `INSERT INTO accounting_entries
             (season_id, type, amount_lrd, amount_usd, reference_id, reference_name, description)
           VALUES ($1, 'registration', $2, $3, $4, $5, $6)`,
          [season2Id, REG_FEE_LRD, parseFloat((REG_FEE_LRD / USD_RATE).toFixed(2)),
           c.id, c.full_name, `Registration fee — ${c.full_name}`]
        );
        regCount++;
      }
    }

    // Voting code revenue — each used code
    let voteAcctCount = 0;
    for (const codeId of codes.slice(0, codeIdx)) {
      if (VOTE_FEE_LRD > 0) {
        await client.query(
          `INSERT INTO accounting_entries
             (season_id, type, amount_lrd, amount_usd, reference_id, reference_name, description)
           VALUES ($1, 'voting_code', $2, $3, $4, $5, $6)`,
          [season2Id, VOTE_FEE_LRD, parseFloat((VOTE_FEE_LRD / USD_RATE).toFixed(2)),
           codeId, 'Voting Code', 'Voting code sale — Semi-Finals']
        );
        voteAcctCount++;
      }
    }
    console.log(`  ${regCount} registration entries (L$${REG_FEE_LRD} each)`);
    console.log(`  ${voteAcctCount} voting code entries (L$${VOTE_FEE_LRD} each)`);

    // ─────────────────────────────────────────────────────────────────────────
    // 12. ANNOUNCEMENTS
    // ─────────────────────────────────────────────────────────────────────────
    const { rows: suRows } = await client.query("SELECT id FROM users WHERE role = 'superuser' LIMIT 1");
    const suId = suRows[0]?.id;
    const ANNOUNCEMENTS = [
      { title: 'Welcome to Liberia Talent Quest Season 2!',
        message: 'Applications are now open. Register before spots fill up. All talent categories are welcome — singing, dancing, comedy, spoken word, fashion, and more.' },
      { title: 'Registration fee reminder',
        message: 'Please ensure your registration fee is paid within 5 days of submitting your application. Unpaid applications will be automatically removed after 7 days.' },
      { title: 'Audition results — check your email',
        message: 'Our panel of judges has completed the audition video review. All applicants have received an email with their qualification status. If you qualified, log in to access your contestant dashboard.' },
      { title: 'Semi-Finals this Saturday!',
        message: 'The Semi-Finals round is now open for voting! Use your voting code at vote.html to support your favourite contestant. Top 5 advance to the Grand Finale.' },
      { title: 'Grand Finale venue confirmed',
        message: 'The Grand Finale will be held at the Capitol Building, Monrovia on August 23rd. Doors open at 5 PM. The show will be broadcast live on national television.' },
    ];
    console.log('\nSeeding announcements…');
    for (const a of ANNOUNCEMENTS) {
      await client.query(
        'INSERT INTO announcements (title, message, posted_by, season_id) VALUES ($1,$2,$3,$4)',
        [a.title, a.message, suId || null, season2Id]
      );
    }
    console.log(`  ${ANNOUNCEMENTS.length} announcements`);

    // ─────────────────────────────────────────────────────────────────────────
    // 13. SCHEDULE
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding schedule…');
    const SCHEDULE = [
      { title: 'Registration Closes',    dt: '2026-07-15T23:59:00Z', loc: 'Online',                             notes: 'Last day to submit applications.' },
      { title: 'Live Show — Week 1',     dt: '2026-08-02T18:00:00Z', loc: 'Unity Conference Center, Monrovia', notes: 'Doors open 5 PM. 200 seats. Week 1 quarter-final.' },
      { title: 'Live Show — Week 2',     dt: '2026-08-09T18:00:00Z', loc: 'Unity Conference Center, Monrovia', notes: 'Quarter-finals continue.' },
      { title: 'Semi-Finals',            dt: '2026-08-16T18:00:00Z', loc: 'Unity Conference Center, Monrovia', notes: 'Top 10 compete. Voting codes required.' },
      { title: 'Grand Finale',           dt: '2026-08-23T18:00:00Z', loc: 'Capitol Building, Monrovia',        notes: 'Top 5 compete. Live on national TV. Free entry.' },
      { title: 'Winners Celebration',    dt: '2026-08-24T12:00:00Z', loc: 'Mamba Point Hotel, Monrovia',       notes: 'Press conference and gala dinner for finalists and sponsors.' },
    ];
    for (const s of SCHEDULE) {
      await client.query(
        'INSERT INTO schedule_entries (title, datetime, location, notes, season_id) VALUES ($1,$2,$3,$4,$5)',
        [s.title, s.dt, s.loc, s.notes, season2Id]
      );
    }
    console.log(`  ${SCHEDULE.length} schedule entries`);

    // ─────────────────────────────────────────────────────────────────────────
    // 14. SPONSORS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding sponsors…');
    const SPONSORS = [
      { name: 'Legacy Hub Incorporated', logo: 'assets/logo-icon.png', site: 'https://legacyhubinc.org', tier: 'Platinum', order: 1 },
      { name: 'Lonestar Cell MTN',        logo: 'assets/Sponsor_1.jpg', site: '',                          tier: 'Gold',     order: 2 },
      { name: 'Orange Liberia',           logo: 'assets/Sponsor_1.jpg', site: '',                          tier: 'Gold',     order: 3 },
      { name: 'LBDI Bank',                logo: 'assets/Sponsor_1.jpg', site: '',                          tier: 'Silver',   order: 4 },
      { name: 'FrontPage Africa',         logo: 'assets/Sponsor_1.jpg', site: '',                          tier: 'Partner',  order: 5 },
      { name: 'Liberia Broadcasting Service', logo: 'assets/Sponsor_1.jpg', site: '',                      tier: 'Partner',  order: 6 },
    ];
    for (const s of SPONSORS) {
      await client.query(
        `INSERT INTO sponsors (name, logo_url, website_url, tier, display_order, active)
         VALUES ($1,$2,$3,$4,$5,TRUE)`,
        [s.name, s.logo, s.site || null, s.tier, s.order]
      );
    }
    console.log(`  ${SPONSORS.length} sponsors`);

    // ─────────────────────────────────────────────────────────────────────────
    // 15. CONTESTANT MEDIA (placeholder records using existing public assets)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nSeeding contestant media…');
    const PHOTO_ASSETS = [
      '/assets/Judge_1.jpg',
      '/assets/Judge_2.jpg',
      '/assets/CEO_1.jpg',
      '/assets/MC_1.jpg',
    ];
    let mediaCount = 0;
    for (let qi = 0; qi < qualified.length; qi++) {
      const c = qualified[qi];
      // Primary profile photo
      await client.query(
        `INSERT INTO contestant_media
           (contestant_id, media_type, category, file_path, original_name, title, is_primary)
         VALUES ($1,'photo','profile',$2,$3,$4,TRUE)`,
        [c.id, PHOTO_ASSETS[qi % PHOTO_ASSETS.length], `${c.fn.replace(/ /g,'_')}_profile.jpg`, `${c.fn} — Profile Photo`]
      );
      mediaCount++;
      // Second headshot photo
      await client.query(
        `INSERT INTO contestant_media
           (contestant_id, media_type, category, file_path, original_name, title, is_primary)
         VALUES ($1,'photo','headshot',$2,$3,$4,FALSE)`,
        [c.id, PHOTO_ASSETS[(qi + 1) % PHOTO_ASSETS.length], `${c.fn.replace(/ /g,'_')}_headshot.jpg`, `${c.fn} — Headshot`]
      );
      mediaCount++;
    }
    console.log(`  ${mediaCount} media records for ${qualified.length} qualified contestants`);

    // ─────────────────────────────────────────────────────────────────────────
    // 16. SETTINGS
    // ─────────────────────────────────────────────────────────────────────────
    await client.query(`
      UPDATE settings SET
        registration_open      = TRUE,
        voting_open            = TRUE,
        qualify_min_score      = 28,
        waitlist_min_score     = 20,
        min_judges_to_qualify  = 2,
        round_advance_count    = 5,
        judge_score_weight     = 0.70,
        vote_weight            = 0.30,
        event_date             = '2026-08-23T18:00:00Z',
        contact_phone          = '+231 77-874-7441',
        contact_email          = 'legacyhubinc@gmail.com',
        whatsapp               = 'https://wa.me/231778747441',
        facebook               = 'https://facebook.com/LiberiaeTalentQuest',
        instagram              = 'https://instagram.com/liberiatalentquest'
      WHERE id = 1
    `);
    console.log('\nSettings updated.');

    // Ensure superuser password matches .env value (in case it was changed)
    const suPass = process.env.SUPERUSER_PASSWORD || 'ChangeMe123!';
    await client.query(
      "UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE role = 'superuser'",
      [hashPassword(suPass)]
    );

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' FULL MOCK DATA READY');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('\n SUPERUSER');
    console.log('   you@example.com  /  ChangeMe123!');
    console.log('\n STAFF  (password: Password123!)');
    for (const s of STAFF_DEFS) {
      const permStr = s.perms && s.perms.length ? `  perms: [${s.perms.join(', ')}]` : '';
      console.log(`   ${s.role.padEnd(24)} ${s.email}${permStr}`);
    }
    console.log('\n CONTESTANTS  (no login accounts — managed by contestant_manager)');
    Object.values(contestantIds)
      .forEach((c) => console.log(`   ${c.st.padEnd(16)} ${c.fn}`));
    console.log('\n http://localhost:3000');
    console.log('══════════════════════════════════════════════════════════════\n');

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('SEED ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
