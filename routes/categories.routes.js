const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

// Public — registration form uses this
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, slug, display_order FROM categories WHERE active = TRUE ORDER BY display_order, name'
  );
  res.json(rows);
});

// Superuser / anyone granted manage_categories: list all categories, including inactive ones
router.get('/all', requireAuth(['superuser'], 'manage_categories'), async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, slug, display_order, active FROM categories ORDER BY display_order, name'
  );
  res.json(rows);
});

// Superuser / anyone granted manage_categories: create category
router.post('/', requireAuth(['superuser'], 'manage_categories'), async (req, res) => {
  const { name, slug, display_order } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required.' });

  const cleanSlug = String(slug).trim().toLowerCase().replace(/\s+/g, '-');
  const { rows: existing } = await db.query('SELECT id FROM categories WHERE slug = $1', [cleanSlug]);
  if (existing.length) return res.status(409).json({ error: 'A category with that slug already exists.' });

  const { rows } = await db.query(
    'INSERT INTO categories (name, slug, display_order) VALUES ($1, $2, $3) RETURNING *',
    [String(name).trim(), cleanSlug, Number(display_order) || 0]
  );
  res.status(201).json({ message: 'Category created.', category: rows[0] });
});

// Superuser / anyone granted manage_categories: update category
router.patch('/:id', requireAuth(['superuser'], 'manage_categories'), async (req, res) => {
  const { name, active, display_order } = req.body || {};
  const { rows } = await db.query(
    `UPDATE categories
     SET name = COALESCE($1, name),
         active = COALESCE($2, active),
         display_order = COALESCE($3, display_order)
     WHERE id = $4 RETURNING *`,
    [name ? String(name).trim() : null, active !== undefined ? active : null, display_order !== undefined ? Number(display_order) : null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Category not found.' });
  res.json({ message: 'Category updated.', category: rows[0] });
});

// Superuser / anyone granted manage_categories: delete category
router.delete('/:id', requireAuth(['superuser'], 'manage_categories'), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Category not found.' });
  res.json({ message: 'Category deleted.' });
});

module.exports = router;
