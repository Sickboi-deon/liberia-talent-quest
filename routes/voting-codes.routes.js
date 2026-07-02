const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

// Default roles + anyone granted manage_voting_codes permission
const MANAGERS = ['superuser', 'finance_manager'];

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'LTQ';
  for (let i = 0; i < 7; i++) code += chars[crypto.randomInt(0, chars.length)];
  return code;
}

// Finance Manager / Superuser: list voting codes
router.get('/', requireAuth(MANAGERS, 'manage_voting_codes'), async (req, res) => {
  const { used, roundId } = req.query;
  const vals = [];
  const conditions = [];

  if (used !== undefined) { vals.push(used === 'true'); conditions.push(`vc.used = $${vals.length}`); }
  if (roundId) { vals.push(roundId); conditions.push(`vc.round_id = $${vals.length}`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await db.query(
    `SELECT vc.*, r.name AS "roundName", u.name AS "generatedByName",
            c.full_name AS "usedByName"
     FROM voting_codes vc
     LEFT JOIN rounds r ON r.id = vc.round_id
     LEFT JOIN users u ON u.id = vc.generated_by
     LEFT JOIN contestants c ON c.id = vc.used_by_id
     ${where}
     ORDER BY vc.created_at DESC`,
    vals
  );
  res.json(rows);
});

// Finance Manager / Superuser: generate new codes
router.post('/generate', requireAuth(MANAGERS, 'manage_voting_codes'), async (req, res) => {
  const { quantity, roundId, paymentMethod } = req.body || {};
  const qty = Math.min(Math.max(Number(quantity) || 1, 1), 500);

  if (roundId) {
    const { rows } = await db.query('SELECT id FROM rounds WHERE id = $1', [roundId]);
    if (!rows.length) return res.status(404).json({ error: 'Round not found.' });
  }

  const codes = [];
  const pmValue = paymentMethod ? String(paymentMethod).trim() : null;
  for (let i = 0; i < qty; i++) {
    let inserted = null;
    // Rely on DB UNIQUE constraint — retry only on collision (23505)
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const { rows } = await db.query(
          `INSERT INTO voting_codes (code, round_id, payment_method, generated_by)
           VALUES ($1, $2, $3, $4) RETURNING id, code`,
          [generateCode(), roundId || null, pmValue, req.user.sub]
        );
        inserted = rows[0];
        break;
      } catch (err) {
        if (err.code !== '23505') throw err;
      }
    }
    if (!inserted) return res.status(500).json({ error: 'Could not generate unique code. Try again.' });
    codes.push(inserted);
  }

  res.status(201).json({ message: `${codes.length} voting code(s) generated.`, codes });
});

// Finance Manager / Superuser: delete an unused code
router.delete('/:id', requireAuth(MANAGERS, 'manage_voting_codes'), async (req, res) => {
  const { rows } = await db.query('SELECT used FROM voting_codes WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Code not found.' });
  if (rows[0].used) return res.status(409).json({ error: 'Cannot delete a code that has already been used.' });
  await db.query('DELETE FROM voting_codes WHERE id = $1', [req.params.id]);
  res.json({ message: 'Code deleted.' });
});

module.exports = router;
