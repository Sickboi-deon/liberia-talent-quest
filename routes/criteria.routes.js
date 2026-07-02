const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

// Public — judge dashboards use these
router.get('/audition', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, max_score, display_order FROM audition_criteria WHERE active = TRUE ORDER BY display_order, name'
  );
  res.json(rows);
});

router.get('/performance', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, max_score, display_order FROM scoring_criteria WHERE active = TRUE ORDER BY display_order, name'
  );
  res.json(rows);
});

// Superuser: add audition criterion
router.post('/audition', requireAuth(['superuser']), async (req, res) => {
  const { name, max_score, display_order } = req.body || {};
  if (!name || !max_score) return res.status(400).json({ error: 'Name and max_score are required.' });
  if (Number(max_score) < 1 || Number(max_score) > 100) return res.status(400).json({ error: 'max_score must be between 1 and 100.' });
  const { rows } = await db.query(
    'INSERT INTO audition_criteria (name, max_score, display_order) VALUES ($1, $2, $3) RETURNING *',
    [String(name).trim(), Number(max_score), Number(display_order) || 0]
  );
  res.status(201).json({ message: 'Audition criterion added.', criterion: rows[0] });
});

// Superuser: add performance criterion
router.post('/performance', requireAuth(['superuser']), async (req, res) => {
  const { name, max_score, display_order } = req.body || {};
  if (!name || !max_score) return res.status(400).json({ error: 'Name and max_score are required.' });
  if (Number(max_score) < 1 || Number(max_score) > 100) return res.status(400).json({ error: 'max_score must be between 1 and 100.' });
  const { rows } = await db.query(
    'INSERT INTO scoring_criteria (name, max_score, display_order) VALUES ($1, $2, $3) RETURNING *',
    [String(name).trim(), Number(max_score), Number(display_order) || 0]
  );
  res.status(201).json({ message: 'Performance criterion added.', criterion: rows[0] });
});

// Superuser: toggle criterion active/inactive
router.patch('/audition/:id', requireAuth(['superuser']), async (req, res) => {
  const { name, max_score, active, display_order } = req.body || {};
  const { rows } = await db.query(
    `UPDATE audition_criteria
     SET name = COALESCE($1, name), max_score = COALESCE($2, max_score),
         active = COALESCE($3, active), display_order = COALESCE($4, display_order)
     WHERE id = $5 RETURNING *`,
    [name || null, max_score !== undefined ? Number(max_score) : null, active !== undefined ? active : null, display_order !== undefined ? Number(display_order) : null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Criterion not found.' });
  res.json({ message: 'Updated.', criterion: rows[0] });
});

router.patch('/performance/:id', requireAuth(['superuser']), async (req, res) => {
  const { name, max_score, active, display_order } = req.body || {};
  const { rows } = await db.query(
    `UPDATE scoring_criteria
     SET name = COALESCE($1, name), max_score = COALESCE($2, max_score),
         active = COALESCE($3, active), display_order = COALESCE($4, display_order)
     WHERE id = $5 RETURNING *`,
    [name || null, max_score !== undefined ? Number(max_score) : null, active !== undefined ? active : null, display_order !== undefined ? Number(display_order) : null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Criterion not found.' });
  res.json({ message: 'Updated.', criterion: rows[0] });
});

// Superuser: delete criterion
router.delete('/audition/:id', requireAuth(['superuser']), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM audition_criteria WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Criterion not found.' });
  res.json({ message: 'Deleted.' });
});

router.delete('/performance/:id', requireAuth(['superuser']), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM scoring_criteria WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Criterion not found.' });
  res.json({ message: 'Deleted.' });
});

module.exports = router;
