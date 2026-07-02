const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { documentUpload, persistDocument } = require('../lib/upload');
const { logAction } = require('../lib/audit');

// Public — frontend uses this for countdown, contact info, open/close flags
// Credential columns (smtp_pass, wa_token, etc.) are never returned here.
router.get('/', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT id, event_date, registration_open, voting_open,
            qualify_min_score, waitlist_min_score,
            min_judges_to_qualify, round_advance_count,
            judge_score_weight, vote_weight,
            contact_phone, contact_email,
            whatsapp, facebook, instagram,
            tiktok, twitter, youtube, linkedin, pinterest, snapchat, reddit, discord,
            payment_instructions, audition_video_required, max_group_members,
            proposal_file_url AS "proposalFileUrl",
            audience_reach AS "audienceReach", media_mentions AS "mediaMentions", updated_at
     FROM settings WHERE id = 1`
  );
  res.json(rows[0] || {});
});

// Superuser only: update settings
router.put('/', requireAuth(['superuser']), async (req, res) => {
  const b = req.body || {};

  // Range validation for numeric fields
  if (b.qualifyMinScore !== undefined && (Number(b.qualifyMinScore) < 0 || Number(b.qualifyMinScore) > 100)) {
    return res.status(400).json({ error: 'qualifyMinScore must be 0–100.' });
  }
  if (b.waitlistMinScore !== undefined && (Number(b.waitlistMinScore) < 0 || Number(b.waitlistMinScore) > 100)) {
    return res.status(400).json({ error: 'waitlistMinScore must be 0–100.' });
  }
  if (b.minJudgesToQualify !== undefined && Number(b.minJudgesToQualify) < 1) {
    return res.status(400).json({ error: 'minJudgesToQualify must be at least 1.' });
  }
  if (b.roundAdvanceCount !== undefined && Number(b.roundAdvanceCount) < 1) {
    return res.status(400).json({ error: 'roundAdvanceCount must be at least 1.' });
  }
  if (b.judgeScoreWeight !== undefined && (Number(b.judgeScoreWeight) < 0 || Number(b.judgeScoreWeight) > 1)) {
    return res.status(400).json({ error: 'judgeScoreWeight must be between 0 and 1.' });
  }
  if (b.voteWeight !== undefined && (Number(b.voteWeight) < 0 || Number(b.voteWeight) > 1)) {
    return res.status(400).json({ error: 'voteWeight must be between 0 and 1.' });
  }
  if (b.judgeScoreWeight !== undefined && b.voteWeight !== undefined) {
    const sum = Number(b.judgeScoreWeight) + Number(b.voteWeight);
    if (Math.abs(sum - 1) > 0.001) {
      return res.status(400).json({ error: `judgeScoreWeight and voteWeight must sum to 1 (got ${sum.toFixed(4)}).` });
    }
  }
  if (b.audienceReach !== undefined && Number(b.audienceReach) < 0) {
    return res.status(400).json({ error: 'audienceReach cannot be negative.' });
  }
  if (b.mediaMentions !== undefined && Number(b.mediaMentions) < 0) {
    return res.status(400).json({ error: 'mediaMentions cannot be negative.' });
  }
  const { rows } = await db.query(
    `UPDATE settings SET
       event_date              = COALESCE($1::timestamptz, event_date),
       registration_open       = COALESCE($2::boolean,    registration_open),
       voting_open             = COALESCE($3::boolean,    voting_open),
       qualify_min_score       = COALESCE($4::int,        qualify_min_score),
       waitlist_min_score      = COALESCE($5::int,        waitlist_min_score),
       contact_phone           = COALESCE($6,             contact_phone),
       contact_email           = COALESCE($7,             contact_email),
       whatsapp                = COALESCE($8,             whatsapp),
       facebook                = COALESCE($9,             facebook),
       instagram               = COALESCE($10,            instagram),
       tiktok                  = COALESCE($11,            tiktok),
       twitter                 = COALESCE($12,            twitter),
       youtube                 = COALESCE($13,            youtube),
       linkedin                = COALESCE($14,            linkedin),
       pinterest               = COALESCE($15,            pinterest),
       snapchat                = COALESCE($16,            snapchat),
       reddit                  = COALESCE($17,            reddit),
       discord                 = COALESCE($18,            discord),
       min_judges_to_qualify   = COALESCE($19::int,       min_judges_to_qualify),
       round_advance_count     = COALESCE($20::int,       round_advance_count),
       judge_score_weight      = COALESCE($21::numeric,   judge_score_weight),
       vote_weight             = COALESCE($22::numeric,   vote_weight),
       payment_instructions    = COALESCE($23,            payment_instructions),
       audition_video_required = COALESCE($24::boolean,   audition_video_required),
       max_group_members       = COALESCE($25::int,        max_group_members),
       audience_reach          = COALESCE($26::int,        audience_reach),
       media_mentions          = COALESCE($27::int,        media_mentions),
       updated_at              = NOW()
     WHERE id = 1 RETURNING *`,
    [
      b.eventDate               !== undefined ? (b.eventDate || null) : null,
      b.registrationOpen        !== undefined ? b.registrationOpen : null,
      b.votingOpen              !== undefined ? b.votingOpen       : null,
      b.qualifyMinScore         !== undefined ? Number(b.qualifyMinScore)      : null,
      b.waitlistMinScore        !== undefined ? Number(b.waitlistMinScore)     : null,
      b.contactPhone            !== undefined ? String(b.contactPhone).trim()  : null,
      b.contactEmail            !== undefined ? String(b.contactEmail).trim()  : null,
      b.whatsapp                !== undefined ? String(b.whatsapp).trim()      : null,
      b.facebook                !== undefined ? String(b.facebook).trim()      : null,
      b.instagram               !== undefined ? String(b.instagram).trim()     : null,
      b.tiktok                  !== undefined ? String(b.tiktok).trim()        : null,
      b.twitter                 !== undefined ? String(b.twitter).trim()       : null,
      b.youtube                 !== undefined ? String(b.youtube).trim()       : null,
      b.linkedin                !== undefined ? String(b.linkedin).trim()      : null,
      b.pinterest               !== undefined ? String(b.pinterest).trim()     : null,
      b.snapchat                !== undefined ? String(b.snapchat).trim()      : null,
      b.reddit                  !== undefined ? String(b.reddit).trim()        : null,
      b.discord                 !== undefined ? String(b.discord).trim()       : null,
      b.minJudgesToQualify      !== undefined ? Number(b.minJudgesToQualify)   : null,
      b.roundAdvanceCount       !== undefined ? Number(b.roundAdvanceCount)    : null,
      b.judgeScoreWeight        !== undefined ? Number(b.judgeScoreWeight)     : null,
      b.voteWeight              !== undefined ? Number(b.voteWeight)           : null,
      b.paymentInstructions     !== undefined ? (b.paymentInstructions ? String(b.paymentInstructions).trim() : null) : null,
      b.auditionVideoRequired   !== undefined ? b.auditionVideoRequired : null,
      b.maxGroupMembers         !== undefined ? Number(b.maxGroupMembers) : null,
      b.audienceReach           !== undefined ? Number(b.audienceReach)   : null,
      b.mediaMentions           !== undefined ? Number(b.mediaMentions)   : null,
    ]
  );
  await logAction({
    actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
    action: 'settings_updated', entityType: 'settings', entityId: null,
    detail: `Updated fields: ${Object.keys(b).join(', ') || 'none'}`,
  });

  res.json({ message: 'Settings updated.', settings: rows[0] });
});

// Upload / replace the sponsorship proposal PDF
router.post('/proposal', requireAuth(['superuser', 'admin']), (req, res, next) => {
  documentUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}, persistDocument, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A PDF file is required.' });
  const fileUrl = req.file.url;
  await db.query(`UPDATE settings SET proposal_file_url = $1, updated_at = NOW() WHERE id = 1`, [fileUrl]);
  res.json({ message: 'Proposal uploaded.', url: fileUrl });
});

// Remove the proposal PDF
router.delete('/proposal', requireAuth(['superuser', 'admin']), async (_req, res) => {
  await db.query(`UPDATE settings SET proposal_file_url = NULL, updated_at = NOW() WHERE id = 1`);
  res.json({ message: 'Proposal removed.' });
});

module.exports = router;
