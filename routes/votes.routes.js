const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');

const db = require('../lib/db');
const { getCurrentSeasonId, getPreviousSeason } = require('../lib/seasons');

const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many vote attempts. Please wait a minute.' },
});

// Public: cast a vote using a voting code
router.post('/', voteLimiter, async (req, res) => {
  const { contestantId, code } = req.body || {};
  if (!contestantId || !code) return res.status(400).json({ error: 'Contestant and voting code are required.' });

  // Check voting is open
  const { rows: sRows } = await db.query('SELECT voting_open FROM settings WHERE id = 1');
  if (!sRows[0]?.voting_open) return res.status(403).json({ error: 'Voting is currently closed.' });

  // Validate contestant — must be in an active competition status AND belong to the current season
  const currentSeasonId = await getCurrentSeasonId();
  const cQuery = currentSeasonId
    ? "SELECT id, full_name FROM contestants WHERE id = $1 AND status IN ('qualified','winner','runner_up','second_runner_up','finalist') AND season_id = $2"
    : "SELECT id, full_name FROM contestants WHERE id = $1 AND status IN ('qualified','winner','runner_up','second_runner_up','finalist')";
  const cArgs = currentSeasonId ? [contestantId, currentSeasonId] : [contestantId];
  const { rows: cRows } = await db.query(cQuery, cArgs);
  if (!cRows.length) return res.status(404).json({ error: 'Contestant not found or not eligible.' });

  // Validate code
  const cleanCode = String(code).trim().toUpperCase();
  const { rows: vcRows } = await db.query('SELECT * FROM voting_codes WHERE code = $1', [cleanCode]);
  if (!vcRows.length) return res.status(400).json({ error: 'Invalid voting code.' });
  if (vcRows[0].used) return res.status(409).json({ error: 'This voting code has already been used.' });

  const vc = vcRows[0];

  // If the code is tied to a round, that round must still be open for voting
  if (vc.round_id) {
    const { rows: rRows } = await db.query('SELECT status, name FROM rounds WHERE id = $1', [vc.round_id]);
    if (!rRows.length || rRows[0].status !== 'open') {
      return res.status(403).json({ error: 'Voting for this round is no longer open.' });
    }
  }

  // Mark code used and record vote — wrapped in a transaction to prevent TOCTOU race
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'UPDATE voting_codes SET used = TRUE, used_by_id = $1, used_at = NOW() WHERE id = $2 AND used = FALSE',
      [contestantId, vc.id]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({ error: 'This voting code has already been used.' });
    }
    await client.query(
      'INSERT INTO votes (contestant_id, voting_code_id, round_id) VALUES ($1, $2, $3)',
      [contestantId, vc.id, vc.round_id || null]
    );
    await client.query('COMMIT');
    client.release();
  } catch (txErr) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('[vote tx]', txErr.message);
    return res.status(500).json({ error: 'Server error recording vote.' });
  }

  // Push leaderboard update to all connected clients
  require('../lib/events').emit('leaderboard', 'update', { trigger: 'vote' });

  // Record accounting entry for voting code revenue
  try {
    // Season comes from the round (if code is tied to one) or falls back to current season
    let acctSeasonId = currentSeasonId;
    let priceLrd = 0;
    let rate = 180;
    if (vc.round_id) {
      const { rows: rPricing } = await db.query(
        `SELECT s.id, s.voting_code_price_lrd, s.usd_to_lrd_rate
         FROM rounds r JOIN seasons s ON s.id = r.season_id WHERE r.id = $1`,
        [vc.round_id]
      );
      if (rPricing.length) {
        acctSeasonId = rPricing[0].id;
        priceLrd = parseFloat(rPricing[0].voting_code_price_lrd || 0);
        rate     = parseFloat(rPricing[0].usd_to_lrd_rate || 180);
      }
    }
    if (!priceLrd && acctSeasonId) {
      const { rows: sPricing } = await db.query(
        'SELECT voting_code_price_lrd, usd_to_lrd_rate FROM seasons WHERE id = $1',
        [acctSeasonId]
      );
      priceLrd = parseFloat(sPricing[0]?.voting_code_price_lrd || 0);
      rate     = parseFloat(sPricing[0]?.usd_to_lrd_rate || 180);
    }
    if (priceLrd > 0 && acctSeasonId) {
      await db.query(
        `INSERT INTO accounting_entries
           (season_id, type, amount_lrd, amount_usd, reference_id, reference_name, description)
         VALUES ($1, 'voting_code', $2, $3, $4, $5, $6)`,
        [acctSeasonId, priceLrd, parseFloat((priceLrd / rate).toFixed(2)),
         vc.id, cleanCode,
         `Voting code used — ${cleanCode} → ${cRows[0].full_name}`]
      );
    }
  } catch (acctErr) {
    console.error('[vote accounting]', acctErr.message);
  }

  const { rows: countRows } = await db.query(
    'SELECT COUNT(*)::int AS votes FROM votes WHERE contestant_id = $1',
    [contestantId]
  );

  res.status(201).json({
    message: `Vote cast for ${cRows[0].full_name}!`,
    votes: countRows[0].votes
  });
});

// Public: leaderboard — one overall competition. `category` is a display filter
// only: rank is always computed across every contestant first, so a contestant's
// rank number never changes when the list is filtered down to their category.
router.get('/leaderboard', async (req, res) => {
  const { category, roundId } = req.query;

  async function runQuery(seasonId) {
    const vals = [];
    const conditions = ["c.status IN ('qualified','winner','runner_up','second_runner_up','finalist')"];
    if (seasonId) { vals.push(seasonId); conditions.push(`c.season_id = $${vals.length}`); }

    // roundId scoped within the query builder to preserve $N numbering
    let voteJoin = 'LEFT JOIN votes v ON v.contestant_id = c.id';
    if (roundId) { vals.push(roundId); voteJoin += ` AND v.round_id = $${vals.length}`; }

    return db.query(
      `SELECT c.id, c.full_name AS name, c.stage_name, c.county,
              c.entry_type AS "entryType",
              (SELECT COUNT(*)::int FROM contestant_members mem WHERE mem.contestant_id = c.id) AS "memberCount",
              COALESCE(NULLIF(c.profile_photo_url, ''), cm.file_path) AS "photoUrl",
              cat.name AS "categoryLabel", cat.slug AS category,
              COUNT(DISTINCT v.id)::int AS votes,
              CASE WHEN c.contestant_number IS NOT NULL
                THEN 'LTQ-S' || s.number || '-' || LPAD(c.contestant_number::text, 3, '0')
                ELSE NULL
              END AS "competitionId"
       FROM contestants c
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN seasons s ON s.id = c.season_id
       LEFT JOIN contestant_media cm ON cm.contestant_id = c.id AND cm.is_primary = TRUE AND cm.media_type = 'photo'
       ${voteJoin}
       WHERE ${conditions.join(' AND ')}
       GROUP BY c.id, cat.name, cat.slug, cm.file_path, s.number
       ORDER BY votes DESC`,
      vals
    );
  }

  const seasonId = await getCurrentSeasonId();
  let { rows } = await runQuery(seasonId);

  // Fallback: current season exists but has no leaderboard data yet
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

  // Assign true overall rank across every contestant first, THEN filter to the
  // requested category for display — a filtered view never re-numbers from #1.
  rows.forEach((r, i) => { r.rank = i + 1; });
  if (category) rows = rows.filter((r) => r.category === category);

  res.json(rows);
});

module.exports = router;
