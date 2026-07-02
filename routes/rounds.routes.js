const express = require('express');
const router  = express.Router();

const db              = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { logAction }   = require('../lib/audit');
const { getCurrentSeasonId } = require('../lib/seasons');
const {
  sendMail, waitingListEmail, rejectionEmail,
  winnerEmail, runnerUpEmail, secondRunnerUpEmail, finalistEmail, eliminatedEmail,
} = require('../lib/email');

// Compute round standings.
// This is ONE overall competition — every contestant, regardless of talent category,
// competes on a single combined ranking (judge score + votes). `category`/`categoryLabel`
// are carried on each row purely as a display label; they never affect rank.
// Audition rounds: judge weight = 1.0, vote weight = 0.0.
// Competition rounds: use the configured weights from settings.
async function computeStandings(roundId) {
  const { rows: rTypeRows } = await db.query('SELECT round_type FROM rounds WHERE id = $1', [roundId]);
  const roundType = rTypeRows[0]?.round_type || 'competition';

  const { rows: cfg } = await db.query('SELECT judge_score_weight, vote_weight FROM settings WHERE id = 1');
  const jWeight = roundType === 'audition' ? 1.0 : Number(cfg[0]?.judge_score_weight ?? 0.70);
  const vWeight = roundType === 'audition' ? 0.0 : Number(cfg[0]?.vote_weight        ?? 0.30);

  const { rows: maxRows } = await db.query(
    'SELECT COALESCE(SUM(max_score), 0)::float AS max_possible FROM scoring_criteria WHERE active = TRUE'
  );
  const maxPossible = Number(maxRows[0].max_possible) || 1;

  const { rows } = await db.query(
    `SELECT
       c.id            AS contestant_id,
       c.full_name     AS name,
       c.stage_name,
       c.email,
       c.status,
       c.category_id,
       cat.name        AS category,
       p.id            AS performance_id,
       ROUND(COALESCE(AVG(ps.total_score), 0)::numeric, 1) AS avg_judge_score,
       COUNT(DISTINCT ps.id)::int                          AS judge_count,
       COUNT(DISTINCT v.id)::int                           AS votes,
       CASE WHEN c.contestant_number IS NOT NULL
         THEN 'LTQ-S' || s.number || '-' || LPAD(c.contestant_number::text, 3, '0')
         ELSE NULL
       END AS "competitionId"
     FROM performances p
     JOIN contestants c  ON c.id  = p.contestant_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN seasons s ON s.id = c.season_id
     LEFT JOIN performance_scores ps ON ps.performance_id = p.id
     LEFT JOIN votes v ON v.contestant_id = c.id AND v.round_id = $1
     WHERE p.round_id = $1
     GROUP BY c.id, c.category_id, cat.name, p.id, s.number
     ORDER BY name`,
    [roundId]
  );

  if (!rows.length) return { standings: [], jWeight, vWeight };

  // ── Overall standings — votes normalised across ALL contestants in this round,
  // regardless of category. This is the one ranking used everywhere: display, advance
  // decisions, and finale placements. ──
  const maxVotesGlobal = Math.max(...rows.map((r) => Number(r.votes)), 1);
  const standings = rows.map((r) => {
    const normJ    = Number(r.avg_judge_score) / maxPossible;
    const normV    = Number(r.votes) / maxVotesGlobal;
    const combined = (jWeight * normJ) + (vWeight * normV);
    return { ...r, normJudge: normJ, normVote: normV, combinedScore: parseFloat(combined.toFixed(4)) };
  });
  standings.sort((a, b) => b.combinedScore - a.combinedScore);
  standings.forEach((s, i) => { s.rank = i + 1; });

  return { standings, jWeight, vWeight };
}

// ── Public: list rounds (scoped to current season) ───────────────────
router.get('/', async (req, res) => {
  const { season } = req.query;
  const vals = [];
  let where = '';
  if (season !== 'all') {
    const seasonId = await getCurrentSeasonId();
    if (seasonId) { vals.push(seasonId); where = `WHERE season_id = $1`; }
  }
  const { rows } = await db.query(
    `SELECT id, name, status, round_type, display_order, season_id, capacity, created_at
     FROM rounds ${where} ORDER BY display_order, created_at`,
    vals
  );
  res.json(rows);
});

// ── Superuser / Admin: create a round ───────────────────────────────
router.post('/', requireAuth(['superuser', 'admin'], 'manage_rounds'), async (req, res) => {
  const { name, display_order, round_type, capacity } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Round name is required.' });
  const VALID_TYPES = ['audition', 'competition'];
  const type = round_type || 'competition';
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'round_type must be "audition" or "competition".' });
  }
  const seasonId = await getCurrentSeasonId();
  const cap = capacity ? Number(capacity) : null;
  if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
    return res.status(400).json({ error: 'Capacity must be a positive integer.' });
  }
  const { rows } = await db.query(
    `INSERT INTO rounds (name, display_order, round_type, season_id, capacity) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [String(name).trim(), Number(display_order) || 0, type, seasonId || null, cap]
  );
  res.status(201).json({ message: 'Round created.', round: rows[0] });
});

// ── Superuser / Admin: update round ─────────────────────────────────
router.patch('/:id', requireAuth(['superuser', 'admin'], 'manage_rounds'), async (req, res) => {
  const { name, status, display_order, round_type, capacity } = req.body || {};
  const VALID_STATUSES = ['upcoming', 'open', 'scoring', 'closed'];
  const VALID_TYPES    = ['audition', 'competition'];
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}.` });
  }
  if (round_type && !VALID_TYPES.includes(round_type)) {
    return res.status(400).json({ error: 'round_type must be "audition" or "competition".' });
  }
  const cap = capacity !== undefined ? (capacity === null ? null : Number(capacity)) : undefined;
  if (cap !== undefined && cap !== null && (!Number.isInteger(cap) || cap < 1)) {
    return res.status(400).json({ error: 'Capacity must be a positive integer.' });
  }
  const { rows } = await db.query(
    `UPDATE rounds SET
       name          = COALESCE($1, name),
       status        = COALESCE($2, status),
       display_order = COALESCE($3, display_order),
       round_type    = COALESCE($4, round_type),
       capacity      = CASE WHEN $5::boolean THEN $6::integer ELSE capacity END
     WHERE id = $7 RETURNING *`,
    [
      name          ? String(name).trim() : null,
      status        || null,
      display_order !== undefined ? Number(display_order) : null,
      round_type    || null,
      cap !== undefined,
      cap !== undefined ? cap : null,
      req.params.id
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Round not found.' });
  res.json({ message: 'Round updated.', round: rows[0] });
});

// ── Superuser / anyone granted manage_rounds: delete round ───────────
router.delete('/:id', requireAuth(['superuser'], 'manage_rounds'), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM rounds WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Round not found.' });
  res.json({ message: 'Round deleted.' });
});

// ── Staff: preview round standings ───────────────────────────────────
// Single overall ranking — one competition, not one per category.
router.get('/:id/standings', requireAuth([
  'superuser', 'contestant_manager', 'judge', 'admin', 'head_judge',
  'finance_manager', 'content_manager', 'media_coordinator', 'communications_manager'
]), async (req, res) => {
  try {
    const { rows: rRows } = await db.query(
      'SELECT id, name, status, round_type, capacity FROM rounds WHERE id = $1',
      [req.params.id]
    );
    if (!rRows.length) return res.status(404).json({ error: 'Round not found.' });
    const { standings, jWeight, vWeight } = await computeStandings(req.params.id);
    res.json({ round: rRows[0], weights: { judge: jWeight, vote: vWeight }, standings });
  } catch (err) {
    console.error('[GET /rounds/:id/standings]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Superuser: close round and advance contestants ───────────────────
//
// One overall competition — every contestant competes against everyone else,
// regardless of talent category. Category is a label, not a bracket.
//
// NORMAL MODE (next round exists):
//   Top [nextRound.capacity] overall → qualified (advance)
//   Next 3 overall                   → waiting_list (single overall queue, position 1/2/3)
//   Rest overall                     → eliminated / rejected
//   capacity = null on next round    → everyone advances, no waitlist, no cut
//
// FINALE MODE (no next round):
//   Top 4 overall → Champion / Runner Up / Second Runner Up / Finalist
//   Rest overall  → eliminated
//
router.post('/:id/advance', requireAuth(['superuser']), async (req, res) => {
  try {
    const { rows: rRows } = await db.query('SELECT * FROM rounds WHERE id = $1', [req.params.id]);
    if (!rRows.length) return res.status(404).json({ error: 'Round not found.' });
    const round = rRows[0];

    // Detect finale: no subsequent non-closed round for this season
    const nextQuery = round.season_id
      ? `SELECT id, name, capacity FROM rounds WHERE season_id = $1 AND display_order > $2 AND status != 'closed' ORDER BY display_order ASC LIMIT 1`
      : `SELECT id, name, capacity FROM rounds WHERE display_order > $1 AND status != 'closed' ORDER BY display_order ASC LIMIT 1`;
    const nextArgs = round.season_id ? [round.season_id, round.display_order] : [round.display_order];
    const { rows: nextRows } = await db.query(nextQuery, nextArgs);
    const isFinale  = nextRows.length === 0;
    const nextRound = nextRows[0] || null;

    const isAudition = round.round_type === 'audition';
    const cutStatus  = isAudition ? 'rejected' : 'eliminated';

    const { standings } = await computeStandings(req.params.id);
    if (!standings.length) {
      return res.status(400).json({ error: 'No performances submitted for this round yet.' });
    }

    const performingIds = standings.map((s) => s.contestant_id);

    // Auto-eliminate no-shows: any qualified contestant who never submitted a performance
    // for this round is treated as a forfeit and eliminated before advancing.
    let noShowCount = 0;
    if (round.season_id) {
      const { rows: noShows } = await db.query(
        `SELECT c.id, c.full_name AS name, cat.name AS category
         FROM contestants c
         LEFT JOIN categories cat ON cat.id = c.category_id
         WHERE c.status = 'qualified' AND c.season_id = $1 AND c.id != ALL($2::uuid[])`,
        [round.season_id, performingIds]
      );
      if (noShows.length > 0) {
        const noShowIds = noShows.map((n) => n.id);
        await db.query(
          `UPDATE contestants SET status = 'eliminated', waitlist_position = NULL, waitlist_round_id = NULL WHERE id = ANY($1::uuid[])`,
          [noShowIds]
        );
        noShowCount = noShows.length;
        // Send forfeiture emails (non-fatal)
        for (const n of noShows) {
          try { await sendMail(eliminatedEmail({ name: n.name, email: n.email })); } catch (_) {}
        }
      }
    }

    // ── FINALE MODE (one overall competition) ─────────────────────────
    if (isFinale) {
      const PLACEMENTS = [
        { rank: 1, status: 'winner',           label: 'Champion'         },
        { rank: 2, status: 'runner_up',        label: 'Runner Up'        },
        { rank: 3, status: 'second_runner_up', label: 'Second Runner Up' },
        { rank: 4, status: 'finalist',         label: 'Finalist'         },
      ];

      const placed     = [];
      const eliminated = [];

      for (const s of standings) {
        const p = PLACEMENTS.find((x) => x.rank === s.rank);
        if (p) placed.push({ ...s, placement: p });
        else   eliminated.push(s.contestant_id);
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        for (const p of placed) {
          await client.query(
            'UPDATE contestants SET status = $1 WHERE id = $2',
            [p.placement.status, p.contestant_id]
          );
        }
        if (eliminated.length) {
          await client.query(
            `UPDATE contestants SET status = 'eliminated' WHERE id = ANY($1::uuid[])`,
            [eliminated]
          );
        }
        await client.query(`UPDATE rounds SET status = 'closed' WHERE id = $1`, [req.params.id]);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Send placement emails (non-fatal)
      const emailMap = {
        winner: winnerEmail, runner_up: runnerUpEmail,
        second_runner_up: secondRunnerUpEmail, finalist: finalistEmail,
      };
      for (const p of placed) {
        try {
          const fn = emailMap[p.placement.status];
          if (fn) await sendMail(fn({ name: p.name, email: p.email }));
        } catch (e) { console.error('[finale email]', e.message); }
      }

      // Flat overall placements for the response (one Champion, not one per category)
      const placements = placed.map((s) => ({
        rank: s.rank, label: s.placement.label, name: s.name,
        category: s.category, score: s.combinedScore,
      }));

      logAction({
        actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
        action: 'finale_complete', entityType: 'round', entityId: req.params.id,
        detail: `Finale complete. ${placed.length} overall placements assigned.`,
      });

      return res.json({
        message:   `Finale complete! Overall placements assigned.${noShowCount ? ` ${noShowCount} no-show(s) auto-eliminated.` : ''}`,
        finale:    true,
        placements,
        eliminated: eliminated.length,
        noShows:   noShowCount,
      });
    }

    // ── NORMAL ADVANCE MODE (one overall competition) ─────────────────
    // capacity = how many the NEXT round accepts overall (null = everyone advances)
    const capacity = nextRound ? nextRound.capacity : null;

    let advancers, waitlisted, cut;
    if (capacity === null || capacity === undefined) {
      advancers  = standings;
      waitlisted = [];
      cut        = [];
    } else {
      advancers  = standings.slice(0, capacity);
      waitlisted = standings.slice(capacity, capacity + 3);
      cut        = standings.slice(capacity + 3);
    }

    const allAdvancerIds = advancers.map((s) => s.contestant_id);
    const allCutIds      = cut.map((s) => s.contestant_id);
    // Waitlist positions are a single overall queue (1/2/3) so auto-fill promotes
    // whoever is actually next in line, regardless of category.
    const waitlistRows   = waitlisted.map((s, i) => ({ ...s, waitlistPosition: i + 1 }));

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (allAdvancerIds.length) {
        await client.query(
          `UPDATE contestants SET status = 'qualified', waitlist_position = NULL, waitlist_round_id = NULL WHERE id = ANY($1::uuid[])`,
          [allAdvancerIds]
        );
      }

      // Waitlist positions are 1/2/3 WITHIN each category so auto-fill can match by category
      for (const wc of waitlistRows) {
        await client.query(
          `UPDATE contestants SET status = 'waiting_list', waitlist_position = $1, waitlist_round_id = $2 WHERE id = $3`,
          [wc.waitlistPosition, nextRound ? nextRound.id : null, wc.contestant_id]
        );
      }

      if (allCutIds.length) {
        await client.query(
          `UPDATE contestants SET status = $1, waitlist_position = NULL, waitlist_round_id = NULL WHERE id = ANY($2::uuid[])`,
          [cutStatus, allCutIds]
        );
      }

      await client.query(`UPDATE rounds SET status = 'closed' WHERE id = $1`, [req.params.id]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Send emails (non-fatal)
    for (const wc of waitlistRows) {
      try { await sendMail(waitingListEmail({ name: wc.name, email: wc.email })); } catch (_) {}
    }
    const cutDetails = standings.filter((s) => allCutIds.includes(s.contestant_id));
    for (const s of cutDetails) {
      try {
        await sendMail(
          cutStatus === 'rejected'
            ? rejectionEmail({ name: s.name, email: s.email })
            : eliminatedEmail({ name: s.name, email: s.email })
        );
      } catch (_) {}
    }

    const totalAdvanced   = allAdvancerIds.length;
    const totalWaitlisted = waitlistRows.length;
    const totalCut        = allCutIds.length;

    logAction({
      actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
      action: 'round_advanced', entityType: 'round', entityId: req.params.id,
      detail: `${round.name}: ${totalAdvanced} advanced, ${totalWaitlisted} waitlisted, ${totalCut} ${cutStatus} overall`,
    });

    // Flat overall outcome list for the response (one competition, not one per category)
    const standingsList = standings.map((s) => {
      const outcome = capacity === null   ? 'advanced'
                    : s.rank <= capacity     ? 'advanced'
                    : s.rank <= capacity + 3 ? 'waiting_list'
                    : cutStatus;
      return {
        rank:          s.rank,
        category:      s.category,
        name:          s.name,
        combinedScore: s.combinedScore,
        avgJudgeScore: s.avg_judge_score,
        votes:         s.votes,
        outcome,
      };
    });

    res.json({
      message:     `Round closed. ${totalAdvanced} advanced, ${totalWaitlisted} on waiting list, ${totalCut} ${cutStatus}${noShowCount ? `, ${noShowCount} no-show(s) auto-eliminated` : ''}.`,
      advanced:    totalAdvanced,
      waitlisted:  totalWaitlisted,
      [cutStatus]: totalCut,
      noShows:     noShowCount,
      capacity,
      standings:   standingsList,
    });
  } catch (err) {
    console.error('[POST /rounds/:id/advance]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
