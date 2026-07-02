const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { photoUpload } = require('../lib/upload');

const EDITORS = ['superuser', 'admin', 'content_manager'];

function handlePhotoUpload(req, res, next) {
  photoUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}

// ── Public: all active profiles (leadership + MC + judges) ───────────
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, role_tag AS "roleTag", name, title, bio, quote, photo_url AS "photoUrl", display_order AS "displayOrder"
       FROM team_profiles
       WHERE active = TRUE
       ORDER BY display_order, name`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /team-profiles]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Staff: create a profile (accepts multipart/form-data for optional photo upload) ──
router.post('/', requireAuth(EDITORS, 'manage_content'), handlePhotoUpload, async (req, res) => {
  try {
    const { roleTag, name, title, bio, quote, displayOrder } = req.body || {};
    if (!roleTag || !name || !title) {
      return res.status(400).json({ error: 'roleTag, name, and title are required.' });
    }
    const VALID_TAGS = ['chairman', 'ceo', 'mc', 'judge', 'head_judge'];
    if (!VALID_TAGS.includes(roleTag)) {
      return res.status(400).json({ error: `roleTag must be one of: ${VALID_TAGS.join(', ')}.` });
    }

    const photoUrl = req.file ? `/uploads/photos/${req.file.filename}` : null;

    const { rows } = await db.query(
      `INSERT INTO team_profiles (role_tag, name, title, bio, quote, photo_url, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [roleTag, String(name).trim(), String(title).trim(),
       bio   ? String(bio).trim()   : null,
       quote ? String(quote).trim() : null,
       photoUrl,
       Number(displayOrder) || 0]
    );
    res.status(201).json({ message: 'Profile created.', profile: rows[0] });
  } catch (err) {
    console.error('[POST /team-profiles]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Staff: update a profile (accepts multipart/form-data for optional new photo) ──
router.put('/:id', requireAuth(EDITORS, 'manage_content'), handlePhotoUpload, async (req, res) => {
  try {
    const { roleTag, name, title, bio, quote, displayOrder, active } = req.body || {};
    const newPhotoUrl = req.file ? `/uploads/photos/${req.file.filename}` : null;

    // Swap display_order if another profile already occupies the target position
    if (displayOrder !== undefined) {
      const newOrder = Number(displayOrder);
      const [currentRes, conflictRes] = await Promise.all([
        db.query('SELECT display_order FROM team_profiles WHERE id = $1', [req.params.id]),
        db.query('SELECT id FROM team_profiles WHERE display_order = $1 AND id != $2 LIMIT 1', [newOrder, req.params.id])
      ]);
      if (currentRes.rows.length && conflictRes.rows.length) {
        await db.query('UPDATE team_profiles SET display_order = $1 WHERE id = $2',
          [currentRes.rows[0].display_order, conflictRes.rows[0].id]);
      }
    }

    const { rows } = await db.query(
      `UPDATE team_profiles SET
         role_tag      = COALESCE($1, role_tag),
         name          = COALESCE($2, name),
         title         = COALESCE($3, title),
         bio           = COALESCE($4, bio),
         quote         = COALESCE($5, quote),
         photo_url     = CASE WHEN $6::text IS NOT NULL THEN $6::text ELSE photo_url END,
         display_order = COALESCE($7, display_order),
         active        = COALESCE($8, active)
       WHERE id = $9 RETURNING *`,
      [
        roleTag      ? String(roleTag).trim()    : null,
        name         ? String(name).trim()       : null,
        title        ? String(title).trim()      : null,
        bio          !== undefined ? (bio  ? String(bio).trim()   : null) : null,
        quote        !== undefined ? (quote? String(quote).trim() : null) : null,
        newPhotoUrl,
        displayOrder !== undefined ? Number(displayOrder) : null,
        active       !== undefined ? Boolean(active)      : null,
        req.params.id
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ message: 'Profile updated.', profile: rows[0] });
  } catch (err) {
    console.error('[PUT /team-profiles/:id]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Staff: delete a profile ───────────────────────────────────────────
router.delete('/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM team_profiles WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ message: 'Profile deleted.' });
  } catch (err) {
    console.error('[DELETE /team-profiles/:id]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
