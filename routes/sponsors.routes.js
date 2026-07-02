const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { getCurrentSeasonId, getPreviousSeason } = require('../lib/seasons');
const { photoUpload, persistPhotos } = require('../lib/upload');

// Default roles + anyone granted manage_content permission
const EDITORS = ['superuser', 'content_manager', 'admin'];

function handlePhotoUpload(req, res, next) {
  photoUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}

const SPONSOR_SELECT = `SELECT id, name, logo_url AS "logoUrl", website_url AS "websiteUrl", tier,
       display_order AS "displayOrder", season_id AS "seasonId"
       FROM sponsors WHERE active = TRUE`;

// GET / — public: global sponsors + current-season sponsors; falls back to previous season if none found
// ?season=all — staff: returns all active sponsors across every season
router.get('/', async (req, res) => {
  if (req.query.season === 'all') {
    const { rows } = await db.query(`${SPONSOR_SELECT} ORDER BY display_order, name`);
    return res.json(rows);
  }

  const seasonId = await getCurrentSeasonId();
  let rows;
  if (seasonId) {
    ({ rows } = await db.query(
      `${SPONSOR_SELECT} AND (season_id IS NULL OR season_id = $1) ORDER BY display_order, name`,
      [seasonId]
    ));
    // Fallback: no current-season or global sponsors yet — show previous season's sponsors
    if (!rows.length) {
      const prev = await getPreviousSeason();
      if (prev) {
        const fallback = await db.query(
          `${SPONSOR_SELECT} AND (season_id IS NULL OR season_id = $1) ORDER BY display_order, name`,
          [prev.id]
        );
        rows = fallback.rows;
      }
    }
  } else {
    ({ rows } = await db.query(`${SPONSOR_SELECT} ORDER BY display_order, name`));
  }
  res.json(rows);
});

// POST / — add a new sponsor with optional logo file upload
router.post('/', requireAuth(EDITORS, 'manage_content'), handlePhotoUpload, persistPhotos, async (req, res) => {
  const { name, websiteUrl, tier, display_order, seasonSpecific } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Sponsor name is required.' });

  let sponsorSeasonId = null;
  if (seasonSpecific !== undefined) {
    sponsorSeasonId = (seasonSpecific === 'true' || seasonSpecific === true)
      ? null : (await getCurrentSeasonId());
  }

  const logoUrl = req.file ? req.file.url : null;

  const { rows } = await db.query(
    `INSERT INTO sponsors (name, logo_url, website_url, tier, display_order, season_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      String(name).trim(),
      logoUrl,
      websiteUrl ? String(websiteUrl).trim() : null,
      tier       ? String(tier).trim()       : 'Partner',
      Number(display_order) || 0,
      sponsorSeasonId
    ]
  );
  res.status(201).json({ message: 'Sponsor added.', sponsor: rows[0] });
});

// PATCH /:id — update sponsor; new logo replaces existing if a file is uploaded
router.patch('/:id', requireAuth(EDITORS, 'manage_content'), handlePhotoUpload, persistPhotos, async (req, res) => {
  const { name, websiteUrl, tier, display_order, seasonSpecific } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Sponsor name is required.' });

  const newLogoUrl = req.file ? req.file.url : null;

  // Swap display_order if another sponsor already occupies the target position
  if (display_order !== undefined) {
    const newOrder = Number(display_order) || 0;
    const [currentRes, conflictRes] = await Promise.all([
      db.query('SELECT display_order FROM sponsors WHERE id = $1', [req.params.id]),
      db.query('SELECT id FROM sponsors WHERE display_order = $1 AND id != $2 LIMIT 1', [newOrder, req.params.id])
    ]);
    if (currentRes.rows.length && conflictRes.rows.length) {
      await db.query('UPDATE sponsors SET display_order = $1 WHERE id = $2',
        [currentRes.rows[0].display_order, conflictRes.rows[0].id]);
    }
  }

  const setClauses = [
    'name          = $1',
    'logo_url      = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE logo_url END',
    'website_url   = $3',
    'tier          = $4',
    'display_order = $5',
  ];
  const params = [
    String(name).trim(),
    newLogoUrl,
    websiteUrl ? String(websiteUrl).trim() : null,
    tier ? String(tier).trim() : 'Partner',
    Number(display_order) || 0,
  ];

  if (seasonSpecific !== undefined) {
    const newSeasonId = (seasonSpecific === 'true' || seasonSpecific === true)
      ? null : await getCurrentSeasonId();
    setClauses.push(`season_id = $${params.length + 1}`);
    params.push(newSeasonId);
  }

  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE sponsors SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Sponsor not found.' });
  res.json({ message: 'Sponsor updated.', sponsor: rows[0] });
});

router.delete('/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM sponsors WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Sponsor not found.' });
  res.json({ message: 'Sponsor removed.' });
});

module.exports = router;
