const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { photoUpload, videoUpload, persistPhotos, persistVideos, removeFile } = require('../lib/upload');
const { getCurrentSeasonId } = require('../lib/seasons');

// GET /api/media/gallery — public; all contestant_media for qualified/winner contestants in current season
router.get('/gallery', async (req, res) => {
  try {
    const seasonId = await getCurrentSeasonId();
    const vals = [];
    const conditions = [`c.status IN ('qualified','winner','runner_up','second_runner_up','finalist')`];
    if (seasonId) { vals.push(seasonId); conditions.push(`c.season_id = $${vals.length}`); }
    const { rows } = await db.query(
      `SELECT
         m.id, m.contestant_id AS "contestantId",
         c.full_name AS "contestantName", c.stage_name AS "stageName",
         m.media_type AS "mediaType", m.category, m.file_path AS "filePath",
         m.title, m.is_primary AS "isPrimary", m.created_at AS "createdAt"
       FROM contestant_media m
       JOIN contestants c ON c.id = m.contestant_id
       JOIN categories cat ON cat.id = c.category_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at DESC`,
      vals
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /media/gallery]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Default roles + anyone granted manage_media permission
const MANAGERS = ['superuser', 'contestant_manager', 'admin', 'media_coordinator'];
const STAFF    = ['superuser', 'contestant_manager', 'finance_manager', 'judge', 'content_manager', 'admin', 'head_judge', 'media_coordinator', 'communications_manager'];

function handleUpload(uploader) {
  return (req, res, next) => uploader(req, res, err => err ? res.status(400).json({ error: err.message }) : next());
}

async function findContestant(id) {
  const { rows } = await db.query('SELECT id, full_name FROM contestants WHERE id = $1', [id]);
  return rows[0] || null;
}

// GET /api/media/contestant/:id — list all media for a contestant
router.get('/contestant/:id', requireAuth(STAFF), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, u.name AS uploaded_by_name
       FROM contestant_media m
       LEFT JOIN users u ON u.id = m.uploaded_by
       WHERE m.contestant_id = $1
       ORDER BY m.is_primary DESC, m.media_type, m.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /media/contestant/:id]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/media/contestant/:id/photo — upload a photo
router.post('/contestant/:id/photo', requireAuth(MANAGERS, 'manage_media'), handleUpload(photoUpload), persistPhotos, async (req, res) => {
  try {
    const contestant = await findContestant(req.params.id);
    if (!contestant) { if (req.file?.url) removeFile(req.file.url); return res.status(404).json({ error: 'Contestant not found.' }); }
    if (!req.file)   return res.status(400).json({ error: 'No photo file received.' });

    const { category = 'headshot', title = '', isPrimary } = req.body;
    const filePath  = req.file.url;
    const makePrimary = isPrimary === 'true' || isPrimary === true;

    if (makePrimary) {
      await db.query(`UPDATE contestant_media SET is_primary = FALSE WHERE contestant_id = $1 AND media_type = 'photo'`, [req.params.id]);
      await db.query('UPDATE contestants SET profile_photo_url = $1 WHERE id = $2', [filePath, req.params.id]);
    }

    const { rows } = await db.query(
      `INSERT INTO contestant_media
         (contestant_id, media_type, category, file_path, original_name, file_size, mime_type, title, is_primary, uploaded_by)
       VALUES ($1,'photo',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, category, filePath, req.file.originalname, req.file.size, req.file.mimetype, title || null, makePrimary, req.user.sub]
    );
    res.status(201).json({ message: 'Photo uploaded.', media: rows[0] });
  } catch (err) {
    if (req.file?.url) removeFile(req.file.url);
    console.error('[POST /media/contestant/:id/photo]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/media/contestant/:id/video — upload a video
router.post('/contestant/:id/video', requireAuth(MANAGERS, 'manage_media'), handleUpload(videoUpload), persistVideos, async (req, res) => {
  try {
    const contestant = await findContestant(req.params.id);
    if (!contestant) { if (req.file?.url) removeFile(req.file.url); return res.status(404).json({ error: 'Contestant not found.' }); }
    if (!req.file)   return res.status(400).json({ error: 'No video file received.' });

    const { category = 'other', title = '', isPrimary } = req.body;
    const filePath  = req.file.url;
    const makePrimary = isPrimary === 'true' || isPrimary === true;

    if (makePrimary && category === 'audition') {
      await db.query('UPDATE contestants SET talent_video_url = $1 WHERE id = $2', [filePath, req.params.id]);
    }

    const { rows } = await db.query(
      `INSERT INTO contestant_media
         (contestant_id, media_type, category, file_path, original_name, file_size, mime_type, title, is_primary, uploaded_by)
       VALUES ($1,'video',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, category, filePath, req.file.originalname, req.file.size, req.file.mimetype, title || null, makePrimary, req.user.sub]
    );
    res.status(201).json({ message: 'Video uploaded.', media: rows[0] });
  } catch (err) {
    if (req.file?.url) removeFile(req.file.url);
    console.error('[POST /media/contestant/:id/video]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/media/:id — update title / is_primary
router.patch('/:id', requireAuth(MANAGERS, 'manage_media'), async (req, res) => {
  try {
    const { title, isPrimary } = req.body;
    const { rows } = await db.query('SELECT * FROM contestant_media WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Media not found.' });
    const m = rows[0];

    if (isPrimary === true || isPrimary === 'true') {
      await db.query(`UPDATE contestant_media SET is_primary = FALSE WHERE contestant_id = $1 AND media_type = $2`, [m.contestant_id, m.media_type]);
      if (m.media_type === 'photo') await db.query('UPDATE contestants SET profile_photo_url = $1 WHERE id = $2', [m.file_path, m.contestant_id]);
      if (m.media_type === 'video' && m.category === 'audition') await db.query('UPDATE contestants SET talent_video_url = $1 WHERE id = $2', [m.file_path, m.contestant_id]);
    }

    const { rows: updated } = await db.query(
      `UPDATE contestant_media SET title = COALESCE($1, title), is_primary = COALESCE($2, is_primary) WHERE id = $3 RETURNING *`,
      [title ?? null, isPrimary != null ? (isPrimary === 'true' || isPrimary === true) : null, req.params.id]
    );
    res.json(updated[0]);
  } catch (err) {
    console.error('[PATCH /media/:id]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/media/:id
router.delete('/:id', requireAuth(MANAGERS, 'manage_media'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM contestant_media WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Media not found.' });
    removeFile(rows[0].file_path);
    await db.query('DELETE FROM contestant_media WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    console.error('[DELETE /media/:id]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
