const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

const EDITORS = ['superuser', 'content_manager', 'admin'];

// ── TESTIMONIALS ─────────────────────────────────────────────────────────────

router.get('/testimonials', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT id, quote, author_name AS "authorName", author_role AS "authorRole",
            initials, display_order AS "displayOrder"
     FROM sponsor_testimonials WHERE active = TRUE ORDER BY display_order, created_at`
  );
  res.json(rows);
});

router.post('/testimonials', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { quote, authorName, authorRole, initials, displayOrder } = req.body || {};
  if (!quote || !authorName || !authorRole) {
    return res.status(400).json({ error: 'Quote, author name, and role are required.' });
  }
  const init = initials
    ? String(initials).trim().slice(0, 4).toUpperCase()
    : String(authorName).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const { rows } = await db.query(
    `INSERT INTO sponsor_testimonials (quote, author_name, author_role, initials, display_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [String(quote).trim(), String(authorName).trim(), String(authorRole).trim(), init, Number(displayOrder) || 0]
  );
  res.status(201).json({ message: 'Testimonial added.', testimonial: rows[0] });
});

router.patch('/testimonials/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { quote, authorName, authorRole, initials, displayOrder } = req.body || {};
  const setClauses = [];
  const params = [];
  const add = (col, val) => { setClauses.push(`${col} = $${params.length + 1}`); params.push(val); };

  if (quote !== undefined)        add('quote',         String(quote).trim());
  if (authorName !== undefined)   add('author_name',   String(authorName).trim());
  if (authorRole !== undefined)   add('author_role',   String(authorRole).trim());
  if (initials !== undefined)     add('initials',      String(initials).trim().slice(0, 4).toUpperCase());
  if (displayOrder !== undefined) add('display_order', Number(displayOrder));

  if (!setClauses.length) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE sponsor_testimonials SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Testimonial not found.' });
  res.json({ message: 'Testimonial updated.', testimonial: rows[0] });
});

router.delete('/testimonials/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM sponsor_testimonials WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Testimonial not found.' });
  res.json({ message: 'Testimonial removed.' });
});

// ── BENEFITS ─────────────────────────────────────────────────────────────────

router.get('/benefits', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT id, icon_name AS "iconName", title, description, display_order AS "displayOrder"
     FROM sponsor_benefits WHERE active = TRUE ORDER BY display_order, id`
  );
  res.json(rows);
});

router.post('/benefits', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { iconName, title, description, displayOrder } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'Title and description are required.' });
  const { rows } = await db.query(
    `INSERT INTO sponsor_benefits (icon_name, title, description, display_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [iconName || 'star', String(title).trim(), String(description).trim(), Number(displayOrder) || 0]
  );
  res.status(201).json({ message: 'Benefit added.', benefit: rows[0] });
});

router.patch('/benefits/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { iconName, title, description, displayOrder } = req.body || {};
  const setClauses = [];
  const params = [];
  const add = (col, val) => { setClauses.push(`${col} = $${params.length + 1}`); params.push(val); };

  if (iconName !== undefined)     add('icon_name',     String(iconName));
  if (title !== undefined)        add('title',         String(title).trim());
  if (description !== undefined)  add('description',   String(description).trim());
  if (displayOrder !== undefined) add('display_order', Number(displayOrder));

  if (!setClauses.length) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE sponsor_benefits SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Benefit not found.' });
  res.json({ message: 'Benefit updated.', benefit: rows[0] });
});

router.delete('/benefits/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM sponsor_benefits WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Benefit not found.' });
  res.json({ message: 'Benefit removed.' });
});

// ── TIERS ────────────────────────────────────────────────────────────────────

router.get('/tiers', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, subtitle, features, featured,
            style_variant AS "styleVariant", display_order AS "displayOrder"
     FROM sponsor_tiers WHERE active = TRUE ORDER BY display_order, id`
  );
  res.json(rows);
});

router.post('/tiers', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { name, subtitle, features, featured, styleVariant, displayOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Tier name is required.' });
  const featureArr = Array.isArray(features)
    ? features.map(String)
    : (features ? String(features).split('\n').map(f => f.trim()).filter(Boolean) : []);
  const { rows } = await db.query(
    `INSERT INTO sponsor_tiers (name, subtitle, features, featured, style_variant, display_order)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [String(name).trim(), String(subtitle || '').trim(), featureArr, Boolean(featured), styleVariant || 'silver', Number(displayOrder) || 0]
  );
  res.status(201).json({ message: 'Tier added.', tier: rows[0] });
});

router.patch('/tiers/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { name, subtitle, features, featured, styleVariant, displayOrder } = req.body || {};
  const setClauses = [];
  const params = [];
  const add = (col, val) => { setClauses.push(`${col} = $${params.length + 1}`); params.push(val); };

  if (name !== undefined)          add('name',          String(name).trim());
  if (subtitle !== undefined)      add('subtitle',      String(subtitle).trim());
  if (features !== undefined) {
    const arr = Array.isArray(features) ? features.map(String) : String(features).split('\n').map(f => f.trim()).filter(Boolean);
    add('features', arr);
  }
  if (featured !== undefined)      add('featured',      Boolean(featured));
  if (styleVariant !== undefined)  add('style_variant', String(styleVariant));
  if (displayOrder !== undefined)  add('display_order', Number(displayOrder));

  if (!setClauses.length) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE sponsor_tiers SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Tier not found.' });
  res.json({ message: 'Tier updated.', tier: rows[0] });
});

router.delete('/tiers/:id', requireAuth(EDITORS, 'manage_content'), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM sponsor_tiers WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Tier not found.' });
  res.json({ message: 'Tier removed.' });
});

module.exports = router;
