// Seeds default sponsor-page marketing content (testimonials, benefits, tiers).
// The sponsor_testimonials / sponsor_benefits / sponsor_tiers tables themselves
// are created by db/schema.sql — run `node db/init.js` first on a fresh DB.
// Safe to re-run: skips seeding if rows already exist.
require('dotenv').config();
const db = require('../lib/db');

async function run() {
  // Seed testimonials (skip if data exists)
  const { rows: et } = await db.query('SELECT id FROM sponsor_testimonials LIMIT 1');
  if (!et.length) {
    await db.query(`
      INSERT INTO sponsor_testimonials (quote, author_name, author_role, initials, display_order) VALUES
      ('Partnering with Liberia Talent Quest gave our brand unmatched visibility with a young, engaged audience across all 15 counties.',
       'Amara K.', 'Marketing Director, Gold Sponsor', 'AK', 1),
      ('The production quality and reach exceeded what we expected from a national platform — our logo placement drove real conversations online.',
       'Joseph T.', 'Brand Manager, Platinum Sponsor', 'JT', 2),
      ('A genuinely well-run season with transparent reporting. We could see exactly where our sponsorship money created impact.',
       'Fatu M.', 'Community Partner', 'FM', 3),
      ('Our media partnership with LTQ gave us exclusive access and content that our audience loved all season long.',
       'Daniel B.', 'Editor, Media Partner', 'DB', 4)
    `);
    console.log('sponsor_testimonials seeded.');
  } else { console.log('sponsor_testimonials already has data — skipping seed.'); }

  // Seed benefits (skip if data exists)
  const { rows: eb } = await db.query('SELECT id FROM sponsor_benefits LIMIT 1');
  if (!eb.length) {
    await db.query(`
      INSERT INTO sponsor_benefits (icon_name, title, description, display_order) VALUES
      ('screen', 'Nationwide Visibility',  'Brand exposure across TV, radio, social media, and live events reaching every county.', 1),
      ('target', 'Targeted Audience',      'Connect with a youthful, highly engaged audience that actively votes and shares content.', 2),
      ('users',  'Community Goodwill',     'Be associated with a platform that develops and uplifts young Liberian talent.', 3),
      ('chart',  'Measurable ROI',         'Detailed post-season reports on reach, engagement, and brand recall for every package.', 4),
      ('mic',    'On-Stage Presence',      'Branded segments, naming rights, and live mentions in front of a packed finale crowd.', 5),
      ('globe',  'Digital Amplification',  'Featured placement across our website, gallery, and social channels all season long.', 6)
    `);
    console.log('sponsor_benefits seeded.');
  } else { console.log('sponsor_benefits already has data — skipping seed.'); }

  // Seed tiers (skip if data exists)
  const { rows: eti } = await db.query('SELECT id FROM sponsor_tiers LIMIT 1');
  if (!eti.length) {
    await db.query(`
      INSERT INTO sponsor_tiers (name, subtitle, features, featured, style_variant, display_order) VALUES
      ('Silver', 'Community Partner',
       ARRAY['Logo on website partners page','Social media shoutout (2x per season)','Mention during live show credits','2 complimentary finale tickets'],
       FALSE, 'silver', 1),
      ('Gold', 'Official Partner',
       ARRAY['Everything in Silver, plus:','Logo placement on stage backdrop & banners','Dedicated feature in gallery & press releases','On-air brand mention by hosts','6 complimentary finale tickets + VIP seating'],
       TRUE, 'gold', 2),
      ('Platinum', 'Title Sponsor',
       ARRAY['Everything in Gold, plus:','"Presented by" branding across all materials','Logo on contestant stage-photo backdrop','Category naming rights','Dedicated TV/radio interview slot','12 complimentary finale tickets + meet & greet'],
       FALSE, 'platinum', 3)
    `);
    console.log('sponsor_tiers seeded.');
  } else { console.log('sponsor_tiers already has data — skipping seed.'); }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
