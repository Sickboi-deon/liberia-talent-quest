const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { sendMail, qualifiedEmail, waitingListEmail, rejectionEmail } = require('../lib/email');
const { ensureContestantAccount } = require('../lib/contestant-accounts');

const JUDGES   = ['superuser', 'judge', 'head_judge'];
// Default roles + anyone granted view_all_scores permission
const REPORTER = ['superuser', 'finance_manager', 'contestant_manager', 'admin', 'head_judge'];

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Judge: submit audition score (one per judge per contestant, immutable)
router.post('/', requireAuth(JUDGES), async (req, res) => {
  const { contestantId, scores, comments } = req.body || {};
  if (!contestantId || !scores || typeof scores !== 'object') {
    return res.status(400).json({ error: 'contestantId and scores object are required.' });
  }

  // Contestant must be 'registered' (payment verified)
  const { rows: cRows } = await db.query(
    `SELECT c.full_name, c.email, c.status, c.entry_type, cat.name AS category
     FROM contestants c LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE c.id = $1`,
    [contestantId]
  );
  if (!cRows.length) return res.status(404).json({ error: 'Contestant not found.' });
  if (cRows[0].status !== 'registered') {
    return res.status(409).json({ error: `Cannot score a contestant with status "${cRows[0].status}". Contestant must be registered (payment verified).` });
  }

  // Validate scores against active audition criteria
  const { rows: criteria } = await db.query(
    'SELECT id, name, max_score FROM audition_criteria WHERE active = TRUE'
  );
  if (!criteria.length) return res.status(400).json({ error: 'No active audition criteria configured.' });

  let total = 0;
  for (const c of criteria) {
    const val = Number(scores[c.id]);
    if (!Number.isFinite(val) || val < 0 || val > c.max_score) {
      return res.status(400).json({ error: `"${c.name}" score must be between 0 and ${c.max_score}.` });
    }
    total += val;
  }

  // Check already scored
  const { rows: dup } = await db.query(
    'SELECT id FROM audition_scores WHERE contestant_id = $1 AND judge_id = $2',
    [contestantId, req.user.sub]
  );
  if (dup.length) return res.status(409).json({ error: 'You have already scored this contestant. Scores cannot be changed after submission.' });

  const { rows } = await db.query(
    `INSERT INTO audition_scores (contestant_id, judge_id, scores, total_score, comments)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [contestantId, req.user.sub, JSON.stringify(scores), total, comments ? String(comments).trim() : null]
  );

  // ── Auto-qualification check ─────────────────────────────────────────
  let autoQualified = null;
  try {
    const { rows: cfg } = await db.query(
      'SELECT qualify_min_score, waitlist_min_score, min_judges_to_qualify FROM settings WHERE id = 1'
    );
    const { qualify_min_score: qMin, waitlist_min_score: wMin, min_judges_to_qualify: minJ } = cfg[0];

    const { rows: scoreRows } = await db.query(
      `SELECT COUNT(*)::int AS score_count, ROUND(AVG(total_score)::numeric, 1) AS avg_score
       FROM audition_scores WHERE contestant_id = $1`,
      [contestantId]
    );
    const { score_count, avg_score } = scoreRows[0];

    if (score_count >= (minJ || 1)) {
      let newStatus;
      if (avg_score >= qMin)       newStatus = 'qualified';
      else if (avg_score >= wMin)  newStatus = 'waiting_list';
      else                         newStatus = 'rejected';

      // Guard: only update if still 'registered' — prevents duplicate emails
      // when two judges submit at the same moment (race condition)
      const { rowCount } = await db.query(
        "UPDATE contestants SET status = $1 WHERE id = $2 AND status = 'registered'",
        [newStatus, contestantId]
      );

      if (rowCount > 0) {
        if (newStatus === 'qualified') {
          await ensureContestantAccount(contestantId, cRows[0].full_name, cRows[0].email);
          await sendMail(qualifiedEmail({ name: cRows[0].full_name, email: cRows[0].email }));
        } else if (newStatus === 'waiting_list') {
          await sendMail(waitingListEmail({ name: cRows[0].full_name, email: cRows[0].email }));
        } else {
          await sendMail(rejectionEmail({ name: cRows[0].full_name, email: cRows[0].email }));
        }
        autoQualified = { name: cRows[0].full_name, avgScore: avg_score, judgeCount: score_count, status: newStatus };
      }
    }
  } catch (qErr) {
    console.error('[auto-qualify]', qErr);
  }

  res.status(201).json({
    message: `Score submitted for ${cRows[0].full_name}.${autoQualified ? ` Auto-qualification ran: ${autoQualified.name} → ${autoQualified.status} (avg ${autoQualified.avgScore}).` : ''}`,
    score: rows[0],
    autoQualified
  });
});

// Judge: my own submitted scores
router.get('/mine', requireAuth(JUDGES), async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, c.full_name AS "contestantName", cat.name AS "categoryLabel"
     FROM audition_scores a
     JOIN contestants c ON c.id = a.contestant_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE a.judge_id = $1
     ORDER BY a.submitted_at DESC`,
    [req.user.sub]
  );
  res.json(rows);
});

// Admin/Superuser: all scores, optionally by contestant
router.get('/', requireAuth(['superuser', 'contestant_manager', 'admin', 'head_judge'], 'view_all_scores'), async (req, res) => {
  const { contestantId } = req.query;
  const vals = [];
  let where = '';
  if (contestantId) { vals.push(contestantId); where = 'WHERE a.contestant_id = $1'; }

  const { rows } = await db.query(
    `SELECT a.*, c.full_name AS "contestantName", cat.name AS "categoryLabel", u.name AS "judgeName"
     FROM audition_scores a
     JOIN contestants c ON c.id = a.contestant_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     JOIN users u ON u.id = a.judge_id
     ${where}
     ORDER BY c.full_name, a.submitted_at`,
    vals
  );
  res.json(rows);
});

// Admin/Superuser: CSV report
router.get('/report', requireAuth(REPORTER, 'view_all_scores'), async (req, res) => {
  const { rows: criteria } = await db.query(
    'SELECT id, name FROM audition_criteria WHERE active = TRUE ORDER BY display_order'
  );
  const { rows: scores } = await db.query(
    `SELECT a.*, c.full_name AS "contestantName", cat.name AS "categoryLabel", u.name AS "judgeName"
     FROM audition_scores a
     JOIN contestants c ON c.id = a.contestant_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     JOIN users u ON u.id = a.judge_id
     ORDER BY c.full_name, a.submitted_at`
  );

  const criteriaHeaders = criteria.map((c) => c.name);
  const header = ['Contestant', 'Category', 'Judge', ...criteriaHeaders, 'Total', 'Comments', 'Submitted At'];
  const dataRows = scores.map((s) => {
    const criteriaScores = criteria.map((c) => s.scores?.[c.id] ?? '');
    return [s.contestantName, s.categoryLabel, s.judgeName, ...criteriaScores, s.total_score, s.comments, s.submitted_at];
  });

  const csv = [header, ...dataRows].map((r) => r.map(csvEscape).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ltq-audition-scores.csv"');
  res.send(csv);
});

module.exports = router;
