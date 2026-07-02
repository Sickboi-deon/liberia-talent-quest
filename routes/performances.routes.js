const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { videoUpload, persistVideos, removeFile } = require('../lib/upload');

const JUDGES   = ['superuser', 'judge', 'head_judge'];
const STAFF    = ['superuser', 'contestant_manager', 'judge', 'content_manager', 'admin', 'head_judge', 'media_coordinator', 'communications_manager', 'finance_manager'];

function handleVideoUpload(req, res, next) {
  videoUpload(req, res, err => err ? res.status(400).json({ error: err.message || 'Upload failed.' }) : next());
}

// Contestant Manager / Admin / Superuser: submit a performance on behalf of a contestant
router.post('/', requireAuth(['superuser', 'contestant_manager', 'admin'], 'submit_performances'), handleVideoUpload, persistVideos, async (req, res) => {
  const { contestantId, roundId, songName, description, performanceType } = req.body || {};

  const VALID_TYPES = ['live', 'video'];
  const pType = performanceType || 'live';
  if (!VALID_TYPES.includes(pType)) {
    if (req.file?.url) removeFile(req.file.url);
    return res.status(400).json({ error: 'performanceType must be "live" or "video".' });
  }

  if (!contestantId) { if (req.file?.url) removeFile(req.file.url); return res.status(400).json({ error: 'contestantId is required.' }); }
  if (!roundId)      { if (req.file?.url) removeFile(req.file.url); return res.status(400).json({ error: 'Round is required.' }); }
  // Video submissions require an actual file; live submissions do not
  if (pType === 'video' && !req.file) return res.status(400).json({ error: 'A video file is required for video performances.' });

  const { rows: rRows } = await db.query('SELECT status FROM rounds WHERE id = $1', [roundId]);
  if (!rRows.length) { if (req.file?.url) removeFile(req.file.url); return res.status(404).json({ error: 'Round not found.' }); }
  if (!['open', 'scoring'].includes(rRows[0].status)) {
    if (req.file?.url) removeFile(req.file.url);
    return res.status(403).json({ error: 'This round is not currently accepting submissions.' });
  }

  const { rows: cRows } = await db.query('SELECT id, full_name, status FROM contestants WHERE id = $1', [contestantId]);
  if (!cRows.length) { if (req.file?.url) removeFile(req.file.url); return res.status(404).json({ error: 'Contestant not found.' }); }
  if (cRows[0].status !== 'qualified') {
    if (req.file?.url) removeFile(req.file.url);
    return res.status(403).json({ error: 'Only qualified contestants can have performances submitted.' });
  }

  const { rows: dup } = await db.query(
    'SELECT id FROM performances WHERE contestant_id = $1 AND round_id = $2',
    [contestantId, roundId]
  );
  if (dup.length) { if (req.file?.url) removeFile(req.file.url); return res.status(409).json({ error: `${cRows[0].full_name} already has a performance submitted for this round.` }); }

  const videoUrl = req.file ? req.file.url : null;
  const { rows } = await db.query(
    `INSERT INTO performances (contestant_id, round_id, performance_type, performance_video_url, song_name, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [contestantId, roundId, pType, videoUrl, songName ? String(songName).trim() : null, description ? String(description).trim() : null]
  );
  res.status(201).json({ message: `Performance submitted for ${cRows[0].full_name}.`, performance: rows[0] });
});

// Staff / Judge: list performances for a round
router.get('/round/:roundId', requireAuth(STAFF), async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, c.full_name AS "contestantName", cat.name AS "categoryLabel",
            ROUND(AVG(ps.total_score)::numeric, 1) AS "avgScore",
            COUNT(ps.id)::int AS "judgeCount"
     FROM performances p
     JOIN contestants c ON c.id = p.contestant_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN performance_scores ps ON ps.performance_id = p.id
     WHERE p.round_id = $1
     GROUP BY p.id, c.full_name, cat.name
     ORDER BY c.full_name`,
    [req.params.roundId]
  );
  res.json(rows);
});

// Judge: score a performance (immutable once submitted)
router.post('/:id/score', requireAuth(JUDGES), async (req, res) => {
  const { scores, comments } = req.body || {};
  if (!scores || typeof scores !== 'object') return res.status(400).json({ error: 'scores object is required.' });

  const { rows: pRows } = await db.query(
    `SELECT p.*, c.full_name, r.status AS round_status
     FROM performances p
     JOIN contestants c ON c.id = p.contestant_id
     JOIN rounds r ON r.id = p.round_id
     WHERE p.id = $1`,
    [req.params.id]
  );
  if (!pRows.length) return res.status(404).json({ error: 'Performance not found.' });
  if (!['open', 'scoring'].includes(pRows[0].round_status)) {
    return res.status(403).json({ error: 'This round is not accepting scores right now.' });
  }

  // Validate against active scoring criteria
  const { rows: criteria } = await db.query(
    'SELECT id, name, max_score FROM scoring_criteria WHERE active = TRUE'
  );
  if (!criteria.length) return res.status(400).json({ error: 'No active performance scoring criteria configured.' });

  let total = 0;
  for (const c of criteria) {
    const val = Number(scores[c.id]);
    if (!Number.isFinite(val) || val < 0 || val > c.max_score) {
      return res.status(400).json({ error: `"${c.name}" score must be between 0 and ${c.max_score}.` });
    }
    total += val;
  }

  const { rows: dup } = await db.query(
    'SELECT id FROM performance_scores WHERE performance_id = $1 AND judge_id = $2',
    [req.params.id, req.user.sub]
  );
  if (dup.length) return res.status(409).json({ error: 'You have already scored this performance.' });

  const { rows } = await db.query(
    `INSERT INTO performance_scores (performance_id, judge_id, scores, total_score, comments)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.id, req.user.sub, JSON.stringify(scores), total, comments ? String(comments).trim() : null]
  );

  // Push leaderboard update to all connected clients
  require('../lib/events').emit('leaderboard', 'update', { trigger: 'score' });

  res.status(201).json({ message: `Score submitted for ${pRows[0].full_name}.`, score: rows[0] });
});

// Staff: all performances for a specific contestant — used by contestant profile view
router.get('/contestant/:contestantId', requireAuth(STAFF), async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, r.name AS "roundName", r.status AS "roundStatus", r.round_type AS "roundType",
            ROUND(AVG(ps.total_score)::numeric, 1) AS "avgScore",
            COUNT(ps.id)::int AS "judgeCount"
     FROM performances p
     JOIN rounds r ON r.id = p.round_id
     LEFT JOIN performance_scores ps ON ps.performance_id = p.id
     WHERE p.contestant_id = $1
     GROUP BY p.id, r.name, r.status, r.round_type, r.created_at
     ORDER BY r.created_at ASC`,
    [req.params.contestantId]
  );
  res.json(rows);
});

// Judge: my scores for a given round
router.get('/round/:roundId/my-scores', requireAuth(JUDGES), async (req, res) => {
  const { rows } = await db.query(
    `SELECT ps.*, p.contestant_id, c.full_name AS "contestantName"
     FROM performance_scores ps
     JOIN performances p ON p.id = ps.performance_id
     JOIN contestants c ON c.id = p.contestant_id
     WHERE p.round_id = $1 AND ps.judge_id = $2`,
    [req.params.roundId, req.user.sub]
  );
  res.json(rows);
});

module.exports = router;
