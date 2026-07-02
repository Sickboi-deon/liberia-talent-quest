const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { getCurrentSeasonId, getPreviousSeason } = require('../lib/seasons');

// Default roles + anyone granted manage_announcements permission
const EDITORS = ['superuser', 'content_manager', 'admin', 'communications_manager'];

router.get('/', async (req, res) => {
  const { season } = req.query;

  async function runQuery(seasonId) {
    const vals = seasonId ? [seasonId] : [];
    const where = seasonId ? 'WHERE (a.season_id IS NULL OR a.season_id = $1)' : '';
    return db.query(
      `SELECT a.id, a.title, a.message, u.name AS "postedBy", a.created_at AS "createdAt", a.season_id AS "seasonId"
       FROM announcements a LEFT JOIN users u ON u.id = a.posted_by
       ${where}
       ORDER BY a.created_at DESC`,
      vals
    );
  }

  // ?season=all — staff viewing all historical data, no fallback
  if (season === 'all') {
    const { rows } = await runQuery(null);
    return res.json(rows);
  }

  const seasonId = await getCurrentSeasonId();
  let { rows } = await runQuery(seasonId);

  // Fallback: current season exists but has no announcements yet
  if (!rows.length && seasonId) {
    const prev = await getPreviousSeason();
    if (prev) {
      const fallback = await runQuery(prev.id);
      if (fallback.rows.length) {
        rows = fallback.rows;
        res.set('X-Season-Fallback', 'true');
        res.set('X-Season-Fallback-Number', String(prev.number));
        res.set('X-Season-Fallback-Name', prev.name);
      }
    }
  }

  res.json(rows);
});

router.post('/', requireAuth(EDITORS, 'manage_announcements'), async (req, res) => {
  const { title, message, seasonSpecific } = req.body || {};
  if (!title || !message) return res.status(400).json({ error: 'Title and message are required.' });
  let postSeasonId;
  if (seasonSpecific === true || seasonSpecific === 'true') {
    postSeasonId = null; // global
  } else {
    postSeasonId = await getCurrentSeasonId() || null;
  }
  const { rows } = await db.query(
    `INSERT INTO announcements (title, message, posted_by, season_id) VALUES ($1, $2, $3, $4)
     RETURNING id, title, message, created_at`,
    [String(title).trim(), String(message).trim(), req.user.sub, postSeasonId]
  );
  res.status(201).json({ message: 'Announcement posted.', announcement: rows[0] });
});

router.patch('/:id', requireAuth(EDITORS, 'manage_announcements'), async (req, res) => {
  const { title, message, seasonSpecific } = req.body || {};
  if (!title && !message && seasonSpecific === undefined) return res.status(400).json({ error: 'Nothing to update.' });
  const isSuperAdmin = ['superuser', 'admin'].includes(req.user.role);
  if (!isSuperAdmin) {
    const seasonId = await getCurrentSeasonId();
    if (seasonId) {
      const { rows } = await db.query('SELECT season_id FROM announcements WHERE id = $1', [req.params.id]);
      if (rows.length && rows[0].season_id && rows[0].season_id !== seasonId) {
        return res.status(403).json({ error: 'You can only edit announcements from the current season.' });
      }
    }
  }
  const setClauses = [
    'title   = COALESCE($1, title)',
    'message = COALESCE($2, message)',
  ];
  const params = [
    title   ? String(title).trim()   : null,
    message ? String(message).trim() : null,
  ];
  if (seasonSpecific !== undefined) {
    const newSeasonId = (seasonSpecific === true || seasonSpecific === 'true')
      ? null : await getCurrentSeasonId();
    setClauses.push(`season_id = $${params.length + 1}`);
    params.push(newSeasonId);
  }
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE announcements SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Announcement not found.' });
  res.json({ message: 'Announcement updated.', announcement: rows[0] });
});

router.delete('/:id', requireAuth(EDITORS, 'manage_announcements'), async (req, res) => {
  // Superuser and admin can delete from any season.
  // Content/comms managers can only delete from the current season to protect historical records.
  const isSuperAdmin = ['superuser', 'admin'].includes(req.user.role);
  if (!isSuperAdmin) {
    const seasonId = await getCurrentSeasonId();
    if (seasonId) {
      const { rows } = await db.query('SELECT season_id FROM announcements WHERE id = $1', [req.params.id]);
      if (rows.length && rows[0].season_id && rows[0].season_id !== seasonId) {
        return res.status(403).json({ error: 'You can only remove announcements from the current season. Ask an admin to remove historical records.' });
      }
    }
  }
  const { rowCount } = await db.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Announcement not found.' });
  res.json({ message: 'Announcement removed.' });
});

module.exports = router;
