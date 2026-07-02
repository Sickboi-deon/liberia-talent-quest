const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { getCurrentSeasonId, getPreviousSeason } = require('../lib/seasons');

// Default roles + anyone granted manage_schedule permission
const EDITORS = ['superuser', 'content_manager', 'admin', 'communications_manager'];

router.get('/', async (req, res) => {
  const { season } = req.query;

  async function runQuery(seasonId) {
    const vals = seasonId ? [seasonId] : [];
    const where = seasonId ? 'WHERE (season_id IS NULL OR season_id = $1)' : '';
    return db.query(
      `SELECT id, title, datetime, location, notes, season_id AS "seasonId", created_at
       FROM schedule_entries ${where} ORDER BY datetime ASC`,
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

  // Fallback: current season exists but has no schedule entries yet
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

router.post('/', requireAuth(EDITORS, 'manage_schedule'), async (req, res) => {
  const { title, datetime, location, notes, seasonSpecific } = req.body || {};
  if (!title || !datetime) return res.status(400).json({ error: 'Title and date/time are required.' });
  if (isNaN(new Date(datetime).getTime())) return res.status(400).json({ error: 'Enter a valid date and time.' });
  let postSeasonId;
  if (seasonSpecific === true || seasonSpecific === 'true') {
    postSeasonId = null; // global
  } else {
    postSeasonId = await getCurrentSeasonId() || null;
  }
  const { rows } = await db.query(
    `INSERT INTO schedule_entries (title, datetime, location, notes, season_id)
     VALUES ($1, $2::timestamptz, $3, $4, $5) RETURNING *`,
    [String(title).trim(), datetime, location ? String(location).trim() : null,
     notes ? String(notes).trim() : null, postSeasonId]
  );
  res.status(201).json({ message: 'Schedule entry added.', entry: rows[0] });
});

router.patch('/:id', requireAuth(EDITORS, 'manage_schedule'), async (req, res) => {
  const { title, datetime, location, notes, seasonSpecific } = req.body || {};
  if (datetime && isNaN(new Date(datetime).getTime())) {
    return res.status(400).json({ error: 'Enter a valid date and time.' });
  }
  const isSuperAdmin = ['superuser', 'admin'].includes(req.user.role);
  if (!isSuperAdmin) {
    const seasonId = await getCurrentSeasonId();
    if (seasonId) {
      const { rows } = await db.query('SELECT season_id FROM schedule_entries WHERE id = $1', [req.params.id]);
      if (rows.length && rows[0].season_id && rows[0].season_id !== seasonId) {
        return res.status(403).json({ error: 'You can only edit schedule entries from the current season.' });
      }
    }
  }
  const setClauses = [
    'title    = COALESCE($1, title)',
    'datetime = COALESCE($2::timestamptz, datetime)',
    'location = COALESCE($3, location)',
    'notes    = COALESCE($4, notes)',
  ];
  const params = [
    title    ? String(title).trim()    : null,
    datetime || null,
    location !== undefined ? (location ? String(location).trim() : null) : null,
    notes    !== undefined ? (notes    ? String(notes).trim()    : null) : null,
  ];
  if (seasonSpecific !== undefined) {
    const newSeasonId = (seasonSpecific === true || seasonSpecific === 'true')
      ? null : await getCurrentSeasonId();
    setClauses.push(`season_id = $${params.length + 1}`);
    params.push(newSeasonId);
  }
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE schedule_entries SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Schedule entry not found.' });
  res.json({ message: 'Schedule entry updated.', entry: rows[0] });
});

router.delete('/:id', requireAuth(EDITORS, 'manage_schedule'), async (req, res) => {
  // Superuser and admin can delete from any season.
  // Content/comms managers can only delete from the current season to protect historical records.
  const isSuperAdmin = ['superuser', 'admin'].includes(req.user.role);
  if (!isSuperAdmin) {
    const seasonId = await getCurrentSeasonId();
    if (seasonId) {
      const { rows } = await db.query('SELECT season_id FROM schedule_entries WHERE id = $1', [req.params.id]);
      if (rows.length && rows[0].season_id && rows[0].season_id !== seasonId) {
        return res.status(403).json({ error: 'You can only remove schedule entries from the current season. Ask an admin to remove historical records.' });
      }
    }
  }
  const { rowCount } = await db.query('DELETE FROM schedule_entries WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Schedule entry not found.' });
  res.json({ message: 'Schedule entry removed.' });
});

module.exports = router;
