const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth }                      = require('../middleware/requireAuth');
const { logAction }                        = require('../lib/audit');
const { sendMail, contestantNotifyEmail }  = require('../lib/email');
const { sendWhatsApp }                     = require('../lib/whatsapp');
const { getEmailConfig, getWaConfig }      = require('../lib/integrations');

// Default roles + anyone granted send_notifications permission
const CM = ['superuser', 'contestant_manager', 'admin', 'communications_manager'];

const VALID_TYPES = [
  'audition_schedule', 'qualification_notice', 'rehearsal_notice',
  'elimination_notice', 'finalist_announcement', 'general_update'
];

const VALID_RECIPIENTS = ['all', 'qualified', 'waiting_list', 'registered', 'eliminated', 'winner', 'runner_up', 'second_runner_up', 'finalist', 'individual'];

// Pause between sends to avoid hitting Gmail / Meta rate limits
const SEND_DELAY_MS = 180;
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// GET /api/notifications/channels — live channel status (checks DB credentials first)
router.get('/channels', async (_req, res) => {
  const [email, wa] = await Promise.all([getEmailConfig(), getWaConfig()]);
  res.json({ email: email.configured, whatsapp: wa.configured });
});

// GET /api/notifications — history of sent notifications
router.get('/', requireAuth(CM, 'send_notifications'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT n.*, u.name AS sent_by_name,
            c.full_name AS recipient_name
     FROM notifications n
     LEFT JOIN users u ON u.id = n.sent_by
     LEFT JOIN contestants c ON c.id = n.recipient_id
     ORDER BY n.sent_at DESC
     LIMIT 100`
  );
  res.json(rows);
});

// POST /api/notifications/send — send a notification via email + WhatsApp
router.post('/send', requireAuth(CM, 'send_notifications'), async (req, res) => {
  const { type, recipients, contestantId, subject, message } = req.body || {};

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}.` });
  }
  if (!VALID_RECIPIENTS.includes(recipients)) {
    return res.status(400).json({ error: `recipients must be one of: ${VALID_RECIPIENTS.join(', ')}.` });
  }
  if (!subject || !subject.trim()) return res.status(400).json({ error: 'subject is required.' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required.' });
  if (recipients === 'individual' && !contestantId) {
    return res.status(400).json({ error: 'contestantId is required when recipients is "individual".' });
  }

  // Fetch target contestants — include phone for WhatsApp
  let targetContestants = [];

  if (recipients === 'individual') {
    const { rows } = await db.query(
      'SELECT id, full_name, email, phone FROM contestants WHERE id = $1',
      [contestantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contestant not found.' });
    targetContestants = rows;
  } else {
    const statusMap = {
      qualified:         'qualified',
      waiting_list:      'waiting_list',
      registered:        'registered',
      eliminated:        'eliminated',
      winner:            'winner',
      runner_up:         'runner_up',
      second_runner_up:  'second_runner_up',
      finalist:          'finalist'
    };
    const statusFilter = statusMap[recipients];
    const isCM = req.user.role === 'contestant_manager';
    // All bulk queries are scoped to the current season to avoid cross-season messaging
    const currentSeasonId = await (require('../lib/seasons').getCurrentSeasonId)();
    const { rows } = statusFilter
      ? await db.query(
          `SELECT id, full_name, email, phone FROM contestants WHERE status = $1 AND email IS NOT NULL${currentSeasonId ? ' AND season_id = $2' : ''}`,
          currentSeasonId ? [statusFilter, currentSeasonId] : [statusFilter]
        )
      : isCM
        // CM "all" = their scoped contestants only (post-qualification)
        ? await db.query(
            `SELECT id, full_name, email, phone FROM contestants WHERE email IS NOT NULL AND status IN ('qualified','waiting_list','eliminated','winner','runner_up','second_runner_up','finalist')${currentSeasonId ? ' AND season_id = $1' : ''}`,
            currentSeasonId ? [currentSeasonId] : []
          )
        : await db.query(
            `SELECT id, full_name, email, phone FROM contestants WHERE email IS NOT NULL AND status NOT IN ('pending_payment')${currentSeasonId ? ' AND season_id = $1' : ''}`,
            currentSeasonId ? [currentSeasonId] : []
          );
    targetContestants = rows;
  }

  if (!targetContestants.length) {
    return res.status(404).json({ error: 'No matching contestants found for the selected recipients.' });
  }

  const [emailCfg, waCfg] = await Promise.all([getEmailConfig(), getWaConfig()]);

  // Refuse early if no channel is ready — prevents phantom "delivered" counts
  if (!emailCfg.configured && !waCfg.configured) {
    return res.status(400).json({
      error: 'No notification channels are configured. Go to Notification Channels in the sidebar to set up Email or WhatsApp first.'
    });
  }

  let emailSent   = 0;
  let emailFailed = 0;
  let waSent      = 0;
  let waFailed    = 0;
  const errors    = [];

  for (const c of targetContestants) {
    const personalizedMessage = message.trim().replace(/\[Contestant Name\]/gi, c.full_name);

    // ── Email ────────────────────────────────────────────────────────
    if (emailCfg.configured) {
      try {
        const result = await sendMail(contestantNotifyEmail({
          name:    c.full_name,
          email:   c.email,
          subject: subject.trim(),
          message: personalizedMessage
        }));
        if (result.sent) emailSent++;
      } catch (err) {
        emailFailed++;
        errors.push(`Email → ${c.full_name} <${c.email}>: ${err.message}`);
      }
    }

    // ── WhatsApp ─────────────────────────────────────────────────────
    if (waCfg.configured && c.phone) {
      try {
        const result = await sendWhatsApp({
          to:   c.phone,
          name: c.full_name,
          body: personalizedMessage
        });
        if (result.sent) waSent++;
      } catch (err) {
        waFailed++;
        errors.push(`WhatsApp → ${c.full_name} (${c.phone}): ${err.message}`);
      }
    }

    // Throttle between contestants to stay within rate limits
    await delay(SEND_DELAY_MS);
  }

  // Log to DB
  await db.query(
    `INSERT INTO notifications
       (type, recipients_type, recipient_id, subject, message,
        sent_count, email_sent_count, wa_sent_count, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      type,
      recipients,
      recipients === 'individual' ? contestantId : null,
      subject.trim(),
      message.trim(),
      emailSent + waSent,
      emailSent,
      waSent,
      req.user.sub
    ]
  );

  const channels = [];
  if (emailSent > 0) channels.push(`${emailSent} email${emailSent !== 1 ? 's' : ''}`);
  if (waSent    > 0) channels.push(`${waSent} WhatsApp${waSent !== 1 ? 's' : ''}`);

  const summary = channels.length
    ? `Sent: ${channels.join(', ')}.`
    : 'No messages delivered.';

  const failSummary = [];
  if (emailFailed > 0) failSummary.push(`${emailFailed} email failed`);
  if (waFailed    > 0) failSummary.push(`${waFailed} WhatsApp failed`);

  logAction({ actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
    action: 'notification_sent', detail: `To: ${recipients} | Subject: "${subject.trim()}" | ${summary}` });

  res.json({
    message: summary + (failSummary.length ? ` (${failSummary.join(', ')})` : ''),
    emailSent,
    emailFailed,
    waSent,
    waFailed,
    waEnabled: waCfg.configured,
    errors:    errors.length ? errors : undefined
  });
});

module.exports = router;
