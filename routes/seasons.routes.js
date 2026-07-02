const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

// ── Public: current season info (used by all public pages) ───────
router.get('/current', async (_req, res) => {
  const { rows } = await db.query(
    'SELECT id, number, name, status, start_date, end_date FROM seasons WHERE is_current = TRUE LIMIT 1'
  );
  res.json(rows[0] || null);
});

// ── Public: all seasons list (used by gallery season switcher) ────
router.get('/public', async (_req, res) => {
  const { rows } = await db.query(
    'SELECT id, number, name, status, is_current FROM seasons ORDER BY number ASC'
  );
  res.json(rows);
});

// ── Staff: list all seasons ───────────────────────────────────────
router.get('/', requireAuth(['superuser', 'admin', 'contestant_manager', 'finance_manager',
  'judge', 'head_judge', 'content_manager', 'media_coordinator', 'communications_manager']),
  async (_req, res) => {
    const { rows } = await db.query(
      'SELECT id, number, name, status, start_date, end_date, is_current, created_at FROM seasons ORDER BY number DESC'
    );
    res.json(rows);
  }
);

// ── Superuser: create a new season ───────────────────────────────
router.post('/', requireAuth(['superuser']), async (req, res) => {
  const { number, name, startDate, endDate } = req.body || {};
  if (!number || !name) return res.status(400).json({ error: 'Season number and name are required.' });
  if (!Number.isInteger(Number(number)) || Number(number) < 1) {
    return res.status(400).json({ error: 'Season number must be a positive integer.' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO seasons (number, name, status, start_date, end_date, is_current)
       VALUES ($1, $2, 'upcoming', $3, $4, FALSE)
       RETURNING *`,
      [Number(number), String(name).trim(),
       startDate || null, endDate || null]
    );
    res.status(201).json({ message: 'Season created.', season: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Season ${number} already exists.` });
    throw err;
  }
});

// ── Superuser / Admin: update season details ─────────────────────
router.patch('/:id', requireAuth(['superuser', 'admin']), async (req, res) => {
  const { name, startDate, endDate, status } = req.body || {};
  const VALID_STATUSES = ['upcoming', 'active', 'archived'];
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
  }
  const { rows } = await db.query(
    `UPDATE seasons SET
       name       = COALESCE($1, name),
       start_date = COALESCE($2::date, start_date),
       end_date   = COALESCE($3::date, end_date),
       status     = COALESCE($4, status)
     WHERE id = $5 RETURNING *`,
    [
      name       ? String(name).trim() : null,
      startDate  || null,
      endDate    || null,
      status     || null,
      req.params.id
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Season not found.' });
  res.json({ message: 'Season updated.', season: rows[0] });
});

// ── Superuser: activate a season (archives the previous current) ──
router.post('/:id/activate', requireAuth(['superuser']), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Deactivate any existing current season
    await client.query(
      "UPDATE seasons SET is_current = FALSE, status = 'archived' WHERE is_current = TRUE AND id != $1",
      [req.params.id]
    );
    // Activate the new one
    const { rows } = await client.query(
      "UPDATE seasons SET is_current = TRUE, status = 'active' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    // Reset voting and registration so the new season starts closed by default
    await client.query(
      "UPDATE settings SET voting_open = FALSE, registration_open = FALSE WHERE id = 1"
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Season not found.' }); }
    await client.query('COMMIT');
    res.json({ message: `Season ${rows[0].number} — "${rows[0].name}" is now the active season.`, season: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
