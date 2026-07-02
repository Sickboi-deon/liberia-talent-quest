const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');

const SU = ['superuser'];

function toCSV(rows, cols) {
  const header = cols.join(',');
  const lines  = rows.map((r) =>
    cols.map((c) => {
      const v = r[c] == null ? '' : String(r[c]).replace(/"/g, '""');
      return `"${v}"`;
    }).join(',')
  );
  return [header, ...lines].join('\r\n');
}

function sendCSV(res, csv, filename) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// ── Exports ────────────────────────────────────────────────────────
router.get('/export/contestants', requireAuth(SU), async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.full_name, c.stage_name, c.gender, c.date_of_birth,
            c.county, c.phone, c.email, c.status, cat.name AS category,
            c.short_bio, c.talent_description,
            c.payment_method, c.payment_reference, c.payment_verified_at, c.created_at
     FROM contestants c LEFT JOIN categories cat ON cat.id = c.category_id
     ORDER BY c.created_at`
  );
  sendCSV(res, toCSV(rows, ['id','full_name','stage_name','gender','date_of_birth','county',
    'phone','email','status','category','short_bio','talent_description',
    'payment_method','payment_reference','payment_verified_at','created_at']), 'ltq-contestants.csv');
});

router.get('/export/scores', requireAuth(SU), async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.id, c.full_name AS contestant, cat.name AS category,
            u.name AS judge, u.email AS judge_email,
            a.total_score, a.comments, a.submitted_at
     FROM audition_scores a
     JOIN contestants c ON c.id = a.contestant_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     JOIN users u ON u.id = a.judge_id
     ORDER BY a.submitted_at`
  );
  sendCSV(res, toCSV(rows, ['id','contestant','category','judge','judge_email','total_score','comments','submitted_at']), 'ltq-audition-scores.csv');
});

router.get('/export/votes', requireAuth(SU), async (req, res) => {
  const { rows } = await db.query(
    `SELECT v.id, c.full_name AS contestant, r.name AS round,
            vc.code AS voting_code, vc.payment_method, v.cast_at
     FROM votes v
     JOIN contestants c ON c.id = v.contestant_id
     LEFT JOIN rounds r ON r.id = v.round_id
     LEFT JOIN voting_codes vc ON vc.id = v.voting_code_id
     ORDER BY v.cast_at`
  );
  sendCSV(res, toCSV(rows, ['id','contestant','round','voting_code','payment_method','cast_at']), 'ltq-votes.csv');
});

router.get('/export/notifications', requireAuth(SU), async (req, res) => {
  const { rows } = await db.query(
    `SELECT n.id, n.type, n.recipients_type, c.full_name AS individual_recipient,
            n.subject, n.sent_count, n.email_sent_count, n.wa_sent_count,
            u.name AS sent_by, n.sent_at
     FROM notifications n
     LEFT JOIN contestants c ON c.id = n.recipient_id
     LEFT JOIN users u ON u.id = n.sent_by
     ORDER BY n.sent_at`
  );
  sendCSV(res, toCSV(rows, ['id','type','recipients_type','individual_recipient','subject',
    'sent_count','email_sent_count','wa_sent_count','sent_by','sent_at']), 'ltq-notifications.csv');
});

// ── Audit log — superuser sees all actions including their own ────────
router.get('/audit-log', requireAuth(SU), async (req, res) => {
  const { rows } = await db.query(
    `SELECT
       a.id, a.created_at, a.action, a.entity_type, a.detail,
       a.actor_role, a.actor_name,
       u.email AS actor_email
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC
     LIMIT 500`
  );
  res.json(rows);
});

// ── Purge — permanent, typed confirmation required ─────────────────
router.delete('/purge', requireAuth(SU), async (req, res) => {
  const { type, confirm, olderThanDays } = req.body || {};
  if (confirm !== 'CONFIRM DELETE') {
    return res.status(400).json({ error: 'Type exactly CONFIRM DELETE to proceed.' });
  }
  const days = Math.max(1, parseInt(olderThanDays, 10) || 365);
  let deleted = 0;
  let message = '';

  if (type === 'rejected_contestants') {
    const { rowCount } = await db.query(
      `DELETE FROM contestants WHERE status = 'rejected' AND created_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    deleted = rowCount;
    message = `Deleted ${deleted} rejected contestant${deleted !== 1 ? 's' : ''} (scores + media removed via CASCADE) older than ${days} days.`;
  } else if (type === 'old_notifications') {
    const { rowCount } = await db.query(
      `DELETE FROM notifications WHERE sent_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    deleted = rowCount;
    message = `Deleted ${deleted} notification record${deleted !== 1 ? 's' : ''} older than ${days} days.`;
  } else if (type === 'unused_voting_codes') {
    const { rowCount } = await db.query('DELETE FROM voting_codes WHERE used = FALSE');
    deleted = rowCount;
    message = `Deleted ${deleted} unused voting code${deleted !== 1 ? 's' : ''}.`;
  } else if (type === 'old_audit_logs') {
    const { rowCount } = await db.query(
      `DELETE FROM audit_log WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    deleted = rowCount;
    message = `Deleted ${deleted} audit log entr${deleted !== 1 ? 'ies' : 'y'} older than ${days} days.`;
  } else {
    return res.status(400).json({ error: 'Unknown purge type.' });
  }

  res.json({ message, deleted });
});

module.exports = router;
