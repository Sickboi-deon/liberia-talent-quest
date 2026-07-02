const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { eventMediaUpload, UPLOAD_ROOT, VIDEO_MIME } = require('../lib/upload');
const { getCurrentSeasonId, getPreviousSeason } = require('../lib/seasons');

const MANAGERS = ['superuser', 'admin', 'content_manager', 'media_coordinator'];

function handleUpload(req, res, next) {
  eventMediaUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}

// ── Public: active event photos, scoped by season ────────────────────
router.get('/', async (req, res) => {
  try {
    const { season } = req.query;

    // ?season=all — full archive (no filter)
    if (season === 'all') {
      const { rows } = await db.query(
        `SELECT id, file_path AS "filePath", media_type AS "mediaType", caption, wide,
                display_order AS "displayOrder", season_id AS "seasonId"
         FROM event_photos WHERE active = TRUE ORDER BY display_order, created_at`
      );
      return res.json(rows);
    }

    // ?season=<uuid> — specific season
    if (season) {
      const { rows } = await db.query(
        `SELECT id, file_path AS "filePath", media_type AS "mediaType", caption, wide,
                display_order AS "displayOrder", season_id AS "seasonId"
         FROM event_photos WHERE active = TRUE AND season_id = $1
         ORDER BY display_order, created_at`,
        [season]
      );
      return res.json(rows);
    }

    // Default — current season, fall back to previous if empty
    const seasonId = await getCurrentSeasonId();
    let { rows } = await db.query(
      `SELECT id, file_path AS "filePath", media_type AS "mediaType", caption, wide,
              display_order AS "displayOrder", season_id AS "seasonId"
       FROM event_photos WHERE active = TRUE AND season_id = $1
       ORDER BY display_order, created_at`,
      [seasonId]
    );

    if (!rows.length && seasonId) {
      const prev = await getPreviousSeason();
      if (prev) {
        const fallback = await db.query(
          `SELECT id, file_path AS "filePath", media_type AS "mediaType", caption, wide,
                  display_order AS "displayOrder", season_id AS "seasonId"
           FROM event_photos WHERE active = TRUE AND season_id = $1
           ORDER BY display_order, created_at`,
          [prev.id]
        );
        if (fallback.rows.length) {
          rows = fallback.rows;
          res.set('X-Season-Fallback', 'true');
        }
      }
    }

    res.json(rows);
  } catch (err) {
    console.error('[GET /event-photos]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Staff: upload a new event photo ──────────────────────────────────
router.post('/', requireAuth(MANAGERS, 'manage_media'), handleUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const { caption, wide, displayOrder } = req.body || {};
    const isVideo   = VIDEO_MIME.includes(req.file.mimetype);
    const subdir    = isVideo ? 'videos' : 'photos';
    const mediaType = isVideo ? 'video' : 'photo';
    const filePath  = `/uploads/${subdir}/${req.file.filename}`;
    const seasonId  = await getCurrentSeasonId();
    const { rows } = await db.query(
      `INSERT INTO event_photos (file_path, media_type, caption, wide, display_order, uploaded_by, season_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [filePath,
       mediaType,
       caption      ? String(caption).trim() : null,
       wide === 'true' || wide === true,
       Number(displayOrder) || 0,
       req.user.sub,
       seasonId || null]
    );
    res.status(201).json({ message: `Event ${mediaType} uploaded.`, photo: rows[0] });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('[POST /event-photos]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Staff: update caption / wide / display_order / active ────────────
router.patch('/:id', requireAuth(MANAGERS, 'manage_media'), async (req, res) => {
  try {
    const { caption, wide, displayOrder, active, mediaType } = req.body || {};

    // Swap display_order if another photo already occupies the target position
    if (displayOrder !== undefined) {
      const newOrder = Number(displayOrder);
      const [currentRes, conflictRes] = await Promise.all([
        db.query('SELECT display_order FROM event_photos WHERE id = $1', [req.params.id]),
        db.query('SELECT id FROM event_photos WHERE display_order = $1 AND id != $2 LIMIT 1', [newOrder, req.params.id])
      ]);
      if (currentRes.rows.length && conflictRes.rows.length) {
        await db.query('UPDATE event_photos SET display_order = $1 WHERE id = $2',
          [currentRes.rows[0].display_order, conflictRes.rows[0].id]);
      }
    }

    const { rows } = await db.query(
      `UPDATE event_photos SET
         caption       = COALESCE($1, caption),
         wide          = COALESCE($2, wide),
         display_order = COALESCE($3, display_order),
         active        = COALESCE($4, active),
         media_type    = COALESCE($5, media_type)
       WHERE id = $6 RETURNING *`,
      [
        caption      !== undefined ? (caption ? String(caption).trim() : null) : null,
        wide         !== undefined ? (wide === 'true' || wide === true)        : null,
        displayOrder !== undefined ? Number(displayOrder)                      : null,
        active       !== undefined ? Boolean(active)                           : null,
        mediaType    !== undefined ? String(mediaType)                         : null,
        req.params.id
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Photo not found.' });
    res.json({ message: 'Photo updated.', photo: rows[0] });
  } catch (err) {
    console.error('[PATCH /event-photos/:id]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Staff: delete an event photo ─────────────────────────────────────
router.delete('/:id', requireAuth(MANAGERS, 'manage_media'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT file_path FROM event_photos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Photo not found.' });

    // Only delete uploaded files, not seeded static assets under /assets/
    const fp = rows[0].file_path;
    if (fp.startsWith('/uploads/photos/') || fp.startsWith('/uploads/videos/')) {
      const absPath = path.resolve(UPLOAD_ROOT, fp.replace(/^\/uploads\//, ''));
      if (absPath.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
        fs.unlink(absPath, () => {});
      }
    }

    await db.query('DELETE FROM event_photos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Event photo deleted.' });
  } catch (err) {
    console.error('[DELETE /event-photos/:id]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
