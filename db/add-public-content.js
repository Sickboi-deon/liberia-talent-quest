// Seeds default About-page content (team_profiles, event_photos).
// The team_profiles / event_photos tables themselves are created by
// db/schema.sql — run `node db/init.js` first on a fresh DB.
// Safe to re-run: skips seeding if rows already exist.
require('dotenv').config();
const db = require('../lib/db');

async function run() {
  // ── seed team_profiles (skip if already have rows) ────────────────
  const { rows: existing } = await db.query('SELECT id FROM team_profiles LIMIT 1');
  if (!existing.length) {
    await db.query(`
      INSERT INTO team_profiles (role_tag, name, title, bio, quote, photo_url, display_order) VALUES
      ('chairman',   'Burton Dorley',
        'Executive Chairman, Legacy Hub Incorporated',
        'Environmental Project Manager, UNESCO National MAB Youth Focal Point, and Technical Environmental Focal Person for the Paynesville City Corporation. An M.Sc. Environmental Engineering graduate and HULT Prize winner, he has over a decade of experience leading multi-million dollar climate resilience, waste management, and environmental compliance initiatives across Liberia.',
        'This isn''t just a show. It''s the launchpad we wished existed when we were starting out.',
        '/assets/Executive%20Chairman_1.jpg', 1),

      ('ceo',        'Museline Fatu Darwolor',
        'Founder & CEO, Liberia Talent Quest & Legacy Hub',
        'Also serving as Finance Manager at Sister Aid Liberia, Museline is a dedicated youth advocate and financial professional focused on creating mentorship, leadership, and economic opportunities for Liberia''s next generation of innovators.',
        'Our job is to disappear behind the talent and let the performers shine.',
        '/assets/CEO_1.jpg', 2),

      ('mc',         'Diamond George Kamu',
        'Master of Ceremony',
        'The voice and energy behind every live taping — known for keeping a packed house on its feet and turning nerve-wracking auditions into unforgettable moments for contestants and the crowd alike.',
        NULL,
        '/assets/MC_1.jpg', 3),

      ('judge',      'Erica L. Dunbar',
        'Vocal & Songwriting',
        'Versatile vocalist, musical director, and program coordinator. An experienced live performer and vocal trainer, she blends her passion for music with digital creation and artist mentorship to inspire and shape the creative arts space.',
        NULL,
        '/assets/Judge_1.jpg', 10),

      ('judge',      'Eden Justice Tailey',
        'Youth Advocacy & Talent Development',
        'A youth advocate, University of Liberia biomedical science alumnus, and Chairman of the Federation of District 6 Youth. As CEO of the Face of District 6 Pageant, he is dedicated to mentoring community youth and providing platforms for talent development.',
        NULL,
        '/assets/Judge_2.jpg', 11),

      ('judge',      'Fatu Bemah',
        'Comedy & Spoken Word',
        'Stand-up veteran weighing timing, originality, and crowd impact for comedy and spoken-word acts.',
        NULL,
        NULL, 12),

      ('judge',      'Emmanuel Wreh',
        'Creative Arts',
        'Visual artist and stylist evaluating creative-arts performances on concept, craft, and presentation.',
        NULL,
        NULL, 13),

      ('judge',      'Ruth Nyumah',
        'Broadcast & Media',
        'Television producer judging overall showmanship and broadcast-readiness across every category.',
        NULL,
        NULL, 14)
    `);
    console.log('team_profiles seeded.');
  } else {
    console.log('team_profiles already has data — skipping seed.');
  }

  // ── seed event_photos (skip if already have rows) ─────────────────
  const { rows: existingPhotos } = await db.query('SELECT id FROM event_photos LIMIT 1');
  if (!existingPhotos.length) {
    await db.query(`
      INSERT INTO event_photos (file_path, caption, wide, display_order) VALUES
      ('/assets/Reg_background.png', 'Season Two opening night on the main stage.', TRUE,  1),
      ('/assets/hero-singer.png',    'A contestant performing during live auditions.', FALSE, 2)
    `);
    console.log('event_photos seeded.');
  } else {
    console.log('event_photos already has data — skipping seed.');
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
