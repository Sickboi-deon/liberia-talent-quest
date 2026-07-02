const express = require('express');
const router  = express.Router();
const db      = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

const FINANCE = ['superuser', 'finance_manager'];
const ADMIN   = ['superuser'];

const fmt = (n) => parseFloat(n || 0);

// GET /api/accounting?season_id=xxx  OR  ?season=all
router.get('/', requireAuth(FINANCE), async (req, res) => {
  const { season_id, season } = req.query;

  const vals = [];
  let seasonFilter = '';
  if (season !== 'all' && season_id) {
    vals.push(season_id);
    seasonFilter = `WHERE a.season_id = $${vals.length}`;
  }

  const { rows: entries } = await db.query(
    `SELECT
       a.id, a.season_id, a.type, a.amount_usd, a.amount_lrd,
       a.reference_id, a.reference_name, a.description, a.created_at,
       u.name  AS created_by_name,
       s.number AS season_number,
       s.name   AS season_name
     FROM accounting_entries a
     LEFT JOIN users   u ON u.id = a.created_by
     LEFT JOIN seasons s ON s.id = a.season_id
     ${seasonFilter}
     ORDER BY a.created_at DESC`,
    vals
  );

  const reg   = entries.filter((e) => e.type === 'registration');
  const vote  = entries.filter((e) => e.type === 'voting_code');
  const sumLrd = (arr) => arr.reduce((s, e) => s + fmt(e.amount_lrd), 0);
  const sumUsd = (arr) => arr.reduce((s, e) => s + fmt(e.amount_usd), 0);

  res.json({
    summary: {
      total:        { lrd: sumLrd(entries), usd: sumUsd(entries) },
      registration: { lrd: sumLrd(reg),     usd: sumUsd(reg)     },
      voting:       { lrd: sumLrd(vote),    usd: sumUsd(vote)    },
      count: entries.length,
    },
    entries,
  });
});

// GET /api/accounting/seasons  — all seasons with their pricing
router.get('/seasons', requireAuth(FINANCE), async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, number, name, is_current, status,
            registration_fee_lrd, voting_code_price_lrd, usd_to_lrd_rate
     FROM seasons ORDER BY number DESC`
  );
  res.json(rows);
});

// PATCH /api/accounting/seasons/:id/pricing  — superuser only
router.patch('/seasons/:id/pricing', requireAuth(ADMIN), async (req, res) => {
  const { registrationFeeLrd, votingCodePriceLrd, usdToLrdRate } = req.body || {};

  const { rows } = await db.query(
    `UPDATE seasons SET
       registration_fee_lrd  = COALESCE($1::numeric, registration_fee_lrd),
       voting_code_price_lrd = COALESCE($2::numeric, voting_code_price_lrd),
       usd_to_lrd_rate       = COALESCE($3::numeric, usd_to_lrd_rate)
     WHERE id = $4 RETURNING *`,
    [
      registrationFeeLrd  != null ? Number(registrationFeeLrd)  : null,
      votingCodePriceLrd  != null ? Number(votingCodePriceLrd)  : null,
      usdToLrdRate        != null ? Number(usdToLrdRate)         : null,
      req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Season not found.' });
  res.json({ message: 'Season pricing updated.', season: rows[0] });
});

module.exports = router;
