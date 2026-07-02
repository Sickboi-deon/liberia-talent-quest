const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { ensureContestantAccount } = require('../lib/contestant-accounts');
const {
  isValidLiberianPhone, normalizePhone, isValidEmail,
  isValidCounty, isValidGender, isValidDateOfBirth
} = require('../lib/validate');
const { sendMail, registrationReceivedEmail, paymentVerifiedEmail, qualifiedEmail, waitlistPromotedEmail } = require('../lib/email');

const { registrationUpload, persistRegistration, removeFile } = require('../lib/upload');
const { logAction } = require('../lib/audit');
const { getCurrentSeasonId, getPreviousSeason } = require('../lib/seasons');

function handleUpload(req, res, next) {
  registrationUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}

function cleanupFiles(req) {
  const files = req.files || {};
  Object.values(files).flat().forEach((f) => { if (f.url) removeFile(f.url); });
}

// Public, unauthenticated endpoint with large file uploads — cap submissions
// per IP to blunt spam registrations and storage-exhaustion attempts.
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please wait a while and try again.' },
});

const STAFF_VIEW = ['superuser', 'contestant_manager', 'finance_manager', 'judge', 'content_manager', 'admin', 'head_judge', 'media_coordinator', 'communications_manager'];
// Default roles + anyone granted manage_contestants permission
const MANAGERS   = ['superuser', 'contestant_manager', 'admin'];
// Default roles + anyone granted verify_payments permission
const FINANCE    = ['superuser', 'finance_manager'];

// ── Public: submit registration ───────────────────────────────────
router.post('/', registrationLimiter, handleUpload, persistRegistration, async (req, res) => {
  try {
    // Check registration is open + fetch settings flags
    const { rows: sRows } = await db.query('SELECT registration_open, audition_video_required, max_group_members FROM settings WHERE id = 1');
    if (!sRows[0]?.registration_open) {
      cleanupFiles(req);
      return res.status(403).json({ error: 'Registration is currently closed.' });
    }
    const videoRequired   = sRows[0].audition_video_required !== false;
    const maxGroupMembers = sRows[0].max_group_members ?? 6;

    const {
      fullName, stageName, gender, dateOfBirth, county, phone, email,
      categoryId, shortBio, talentDescription
    } = req.body || {};

    const entryType = (['solo','group'].includes(req.body?.entryType)) ? req.body.entryType : 'solo';
    const isGroup   = entryType === 'group';

    // Parse group members
    let members = [];
    if (isGroup) {
      try {
        members = JSON.parse(req.body?.members || '[]');
        if (!Array.isArray(members)) throw new Error();
      } catch {
        cleanupFiles(req);
        return res.status(400).json({ error: 'Invalid group members data.' });
      }
      if (members.length < 2) {
        cleanupFiles(req);
        return res.status(400).json({ error: 'A group must have at least 2 members.' });
      }
      if (members.length > maxGroupMembers) {
        cleanupFiles(req);
        return res.status(400).json({ error: `A group can have at most ${maxGroupMembers} members.` });
      }
      if (members.some((m) => !m.name || !String(m.name).trim())) {
        cleanupFiles(req);
        return res.status(400).json({ error: 'Every group member must have a name.' });
      }
    }

    // Base required fields (all entry types)
    const baseRequired = [fullName, county, phone, email, categoryId, shortBio, talentDescription];
    // Solo-only required fields
    const soloRequired = isGroup ? [] : [gender, dateOfBirth];
    if ([...baseRequired, ...soloRequired].some((v) => !v)) {
      cleanupFiles(req);
      return res.status(400).json({ error: 'All required fields must be filled in.' });
    }
    if (!isValidEmail(email)) { cleanupFiles(req); return res.status(400).json({ error: 'Enter a valid email address.' }); }
    if (!isValidLiberianPhone(phone)) { cleanupFiles(req); return res.status(400).json({ error: 'Enter a valid Liberian phone number (e.g. 0775551234).' }); }
    if (!isGroup) {
      if (!isValidGender(gender)) { cleanupFiles(req); return res.status(400).json({ error: 'Invalid gender value.' }); }
      if (!isValidDateOfBirth(dateOfBirth)) { cleanupFiles(req); return res.status(400).json({ error: 'Enter a valid date of birth.' }); }
    }
    if (!isValidCounty(county)) { cleanupFiles(req); return res.status(400).json({ error: 'Select a valid Liberian county.' }); }

    // Category must exist
    const { rows: catRows } = await db.query('SELECT id FROM categories WHERE id = $1 AND active = TRUE', [categoryId]);
    if (!catRows.length) { cleanupFiles(req); return res.status(400).json({ error: 'Invalid category selected.' }); }

    // Check for duplicate email within the current season
    const currentSeasonId = await getCurrentSeasonId();
    const dupQ = currentSeasonId
      ? 'SELECT id FROM contestants WHERE email = $1 AND season_id = $2'
      : 'SELECT id FROM contestants WHERE email = $1';
    const dupArgs = currentSeasonId
      ? [String(email).trim().toLowerCase(), currentSeasonId]
      : [String(email).trim().toLowerCase()];
    const { rows: dupRows } = await db.query(dupQ, dupArgs);
    if (dupRows.length) { cleanupFiles(req); return res.status(409).json({ error: 'An application with this email already exists.' }); }

    const photoFile = req.files?.photo?.[0];
    const videoFile = req.files?.video?.[0];
    const photoUrl  = photoFile ? photoFile.url : '';
    const videoUrl  = videoFile ? videoFile.url : '';

    if (!photoUrl) { cleanupFiles(req); return res.status(400).json({ error: 'A profile photo is required.' }); }
    if (videoRequired && !videoUrl) { cleanupFiles(req); return res.status(400).json({ error: 'An audition video file is required.' }); }

    // Public contestant ID (LTQ-S{season}-{number}) is assigned immediately at registration,
    // in registration order, and never changes again. Assigning it inside a transaction that
    // holds a per-season advisory lock avoids two concurrent public submissions computing the
    // same MAX(contestant_number)+1 and colliding on the contestants_season_number_unique
    // constraint under load.
    const client = await db.getClient();
    let newRow;
    try {
      await client.query('BEGIN');

      let contestantNumber = null;
      if (currentSeasonId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [currentSeasonId]);
        const { rows: numRows } = await client.query(
          'SELECT COALESCE(MAX(contestant_number), 0) + 1 AS n FROM contestants WHERE season_id = $1',
          [currentSeasonId]
        );
        contestantNumber = numRows[0].n;
      }

      const { rows } = await client.query(
        `INSERT INTO contestants
           (full_name, stage_name, gender, date_of_birth, county, phone, email,
            category_id, short_bio, talent_description, profile_photo_url, talent_video_url,
            status, season_id, entry_type, contestant_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_payment',$13,$14,$15)
         RETURNING id, full_name, status, created_at`,
        [
          String(fullName).trim(),
          stageName ? String(stageName).trim() : null,
          gender ? String(gender).trim() : null,
          dateOfBirth || null,
          String(county).trim(),
          normalizePhone(phone),
          String(email).trim().toLowerCase(),
          categoryId,
          String(shortBio).trim(),
          String(talentDescription).trim(),
          photoUrl,
          videoUrl || null,
          currentSeasonId || null,
          entryType,
          contestantNumber
        ]
      );

      // Insert group members — bulk INSERT to avoid N+1 round-trips
      if (isGroup && members.length) {
        const vals = [];
        const placeholders = members.map((m, i) => {
          const base = i * 5;
          vals.push(rows[0].id, String(m.name).trim(), m.dob || null, m.phone ? String(m.phone).trim() : null, i);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
        });
        await client.query(
          `INSERT INTO contestant_members (contestant_id, member_name, member_dob, member_phone, display_order) VALUES ${placeholders.join(',')}`,
          vals
        );
      }

      await client.query('COMMIT');
      newRow = rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await sendMail(registrationReceivedEmail({ name: String(fullName).trim(), email: String(email).trim().toLowerCase() }));

    res.status(201).json({
      message: 'Application received! Please pay the registration fee and contact us to confirm. We will be in touch.',
      id: newRow.id
    });
  } catch (err) {
    cleanupFiles(req);
    console.error('[contestants POST]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Public: qualified contestants (for vote page, leaderboard, gallery) ──
router.get('/', async (req, res) => {
  const { category } = req.query;

  async function runQuery(seasonId) {
    const vals = [];
    const conditions = [`c.status IN ('qualified','winner','runner_up','second_runner_up','finalist')`];
    if (seasonId) { vals.push(seasonId); conditions.push(`c.season_id = $${vals.length}`); }
    if (category)  { vals.push(category); conditions.push(`cat.slug = $${vals.length}`); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    return db.query(
      `SELECT
         c.id, c.full_name AS name, c.stage_name, c.county,
         c.entry_type AS "entryType",
         (SELECT COUNT(*)::int FROM contestant_members mem WHERE mem.contestant_id = c.id) AS "memberCount",
         COALESCE(NULLIF(c.profile_photo_url, ''), cm.file_path) AS "photoUrl",
         c.short_bio, c.talent_description AS talent,
         cat.name AS "categoryLabel", cat.slug AS category,
         COUNT(DISTINCT v.id)::int AS votes,
         ROUND(AVG(a.total_score)::numeric, 1) AS "judgeScore",
         COUNT(DISTINCT a.id)::int AS "judgeCount",
         CASE WHEN c.contestant_number IS NOT NULL
           THEN 'LTQ-S' || s.number || '-' || LPAD(c.contestant_number::text, 3, '0')
           ELSE NULL
         END AS "competitionId"
       FROM contestants c
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN seasons s ON s.id = c.season_id
       LEFT JOIN contestant_media cm ON cm.contestant_id = c.id AND cm.is_primary = TRUE AND cm.media_type = 'photo'
       LEFT JOIN votes v ON v.contestant_id = c.id
       LEFT JOIN audition_scores a ON a.contestant_id = c.id
       ${where}
       GROUP BY c.id, cat.name, cat.slug, cm.file_path, s.number
       ORDER BY votes DESC`,
      vals
    );
  }

  const seasonId = await getCurrentSeasonId();
  let { rows } = await runQuery(seasonId);

  // Fallback: current season exists but has no qualified contestants yet — show previous season
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

  rows.forEach((r, i) => { r.rank = i + 1; });
  res.json(rows);
});

// ── Public: season placement results — one overall competition ───
// Returns { placements: [] } — the 4 overall Grand Finale placements
// (Champion, Runner Up, 2nd Runner Up, Finalist), spanning every category.
// `category`/`categoryLabel` on each entry are display labels only.
router.get('/placements', async (req, res) => {
  try {
    const STATUS_RANK  = { winner: 1, runner_up: 2, second_runner_up: 3, finalist: 4 };
    const STATUS_LABEL = { winner: 'Champion', runner_up: 'Runner Up', second_runner_up: 'Second Runner Up', finalist: 'Finalist' };

    const seasonId = await getCurrentSeasonId();
    if (!seasonId) return res.json({ placements: [] });

    const { rows } = await db.query(
      `SELECT c.id, c.full_name AS name, c.stage_name, c.county, c.status,
              COALESCE(NULLIF(c.profile_photo_url, ''), cm.file_path) AS "photoUrl",
              cat.id AS "categoryId", cat.name AS "categoryLabel", cat.slug AS category,
              COUNT(DISTINCT v.id)::int AS votes,
              CASE WHEN c.contestant_number IS NOT NULL
                THEN 'LTQ-S' || s.number || '-' || LPAD(c.contestant_number::text, 3, '0')
                ELSE NULL
              END AS "competitionId"
       FROM contestants c
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN seasons s ON s.id = c.season_id
       LEFT JOIN contestant_media cm ON cm.contestant_id = c.id AND cm.is_primary = TRUE AND cm.media_type = 'photo'
       LEFT JOIN votes v ON v.contestant_id = c.id
       WHERE c.status IN ('winner','runner_up','second_runner_up','finalist') AND c.season_id = $1
       GROUP BY c.id, cat.id, cat.name, cat.slug, cm.file_path, s.number`,
      [seasonId]
    );

    const placements = rows
      .map((row) => ({
        ...row,
        rank:  STATUS_RANK[row.status]  || 5,
        label: STATUS_LABEL[row.status] || row.status,
      }))
      .sort((a, b) => a.rank - b.rank);

    res.json({ placements });
  } catch (err) {
    console.error('[GET /contestants/placements]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Staff: applications list with role-scoped access ─────────────
router.get('/queue', requireAuth(STAFF_VIEW), async (req, res) => {
  const { status, season, verified } = req.query;

  // Contestant Managers only see contestants who have been qualified or beyond.
  const isCM = req.user.role === 'contestant_manager';
  const CM_STATUSES = ['qualified', 'waiting_list', 'eliminated', 'winner', 'runner_up', 'second_runner_up', 'finalist'];

  const vals = [];
  const conditions = [];

  // Season filter — defaults to current season; pass ?season=all to view all seasons
  if (season !== 'all') {
    const currentSeasonId = await getCurrentSeasonId();
    if (currentSeasonId) { vals.push(currentSeasonId); conditions.push(`c.season_id = $${vals.length}`); }
  }

  if (isCM) {
    // CM sees contestants in post-registration statuses (qualified and beyond)
    if (status && CM_STATUSES.includes(status)) {
      vals.push(status);
      conditions.push(`c.status = $${vals.length}`);
    } else {
      vals.push(CM_STATUSES);
      conditions.push(`c.status = ANY($${vals.length}::text[])`);
    }
  } else if (verified === 'true') {
    // Finance Manager payment history: all contestants whose payment has been verified
    conditions.push(`c.payment_verified_at IS NOT NULL`);
  } else if (status) {
    vals.push(status);
    conditions.push(`c.status = $${vals.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT
       c.id, c.full_name, c.stage_name, c.gender, c.county, c.phone, c.email,
       c.category_id, c.short_bio, c.talent_description,
       c.profile_photo_url, c.talent_video_url, c.status,
       c.entry_type,
       (SELECT COUNT(*) FROM contestant_members cm WHERE cm.contestant_id = c.id)::int AS "memberCount",
       c.payment_method, c.payment_reference, c.payment_notes,
       c.payment_verified_by, c.payment_verified_at,
       c.judge_notes, c.user_id, c.created_at,
       cat.name AS "categoryLabel", cat.slug AS "categorySlug",
       pv.name  AS "paymentVerifiedByName",
       CASE WHEN c.contestant_number IS NOT NULL
         THEN 'LTQ-S' || s.number || '-' || LPAD(c.contestant_number::text, 3, '0')
         ELSE NULL
       END AS "competitionId"
     FROM contestants c
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN seasons s ON s.id = c.season_id
     LEFT JOIN users pv ON pv.id = c.payment_verified_by
     ${where}
     ORDER BY c.created_at DESC`,
    vals
  );

  // Strip payment-sensitive fields for CM — that's Finance Manager territory
  if (isCM) {
    const PAYMENT_FIELDS = ['payment_method', 'payment_reference', 'payment_notes',
                            'payment_verified_by', 'payment_verified_at', 'paymentVerifiedByName'];
    rows.forEach((r) => PAYMENT_FIELDS.forEach((f) => delete r[f]));
  }

  res.json(rows);
});

// ── Public: single qualified contestant profile ───────────────────
router.get('/profile/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.full_name AS name, c.stage_name, c.county,
            c.entry_type AS "entryType",
            COALESCE(NULLIF(c.profile_photo_url, ''), cm.file_path) AS "photoUrl",
            c.short_bio, c.talent_description AS talent,
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
     LEFT JOIN votes v ON v.contestant_id = c.id
     WHERE c.id = $1 AND c.status IN ('qualified','winner','runner_up','second_runner_up','finalist')
     GROUP BY c.id, cat.name, cat.slug, cm.file_path, s.number`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Contestant not found.' });

  const [{ rows: media }, { rows: memberRows }] = await Promise.all([
    db.query(
      `SELECT id, media_type, category, file_path, title, is_primary, created_at
       FROM contestant_media WHERE contestant_id = $1
       ORDER BY is_primary DESC, media_type, created_at DESC`,
      [req.params.id]
    ),
    db.query(
      `SELECT member_name AS name, member_dob AS dob, member_phone AS phone, display_order
       FROM contestant_members WHERE contestant_id = $1 ORDER BY display_order`,
      [req.params.id]
    ),
  ]);
  res.json({ ...rows[0], media, members: memberRows });
});

// ── Staff: single contestant ──────────────────────────────────────
router.get('/:id', requireAuth(STAFF_VIEW), async (req, res) => {
  const CM_STATUSES = ['qualified', 'waiting_list', 'eliminated', 'winner', 'runner_up', 'second_runner_up', 'finalist'];
  const isCM     = req.user.role === 'contestant_manager';
  const cmWhere  = isCM ? ` AND c.status = ANY($2::text[])` : '';
  const params   = isCM ? [req.params.id, CM_STATUSES] : [req.params.id];
  const { rows } = await db.query(
    `SELECT c.*,
            cat.name AS "categoryLabel", cat.slug AS "categorySlug",
            CASE WHEN c.contestant_number IS NOT NULL
              THEN 'LTQ-S' || s.number || '-' || LPAD(c.contestant_number::text, 3, '0')
              ELSE NULL
            END AS "competitionId"
     FROM contestants c
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN seasons s ON s.id = c.season_id
     WHERE c.id = $1${cmWhere}`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Contestant not found.' });

  const { rows: scores } = await db.query(
    `SELECT a.*, u.name AS "judgeName"
     FROM audition_scores a
     JOIN users u ON u.id = a.judge_id
     WHERE a.contestant_id = $1`,
    [req.params.id]
  );

  const { rows: memberRows } = await db.query(
    `SELECT id, member_name AS name, member_dob AS dob, member_phone AS phone, display_order
     FROM contestant_members WHERE contestant_id = $1 ORDER BY display_order`,
    [req.params.id]
  );

  const contestant = { ...rows[0], auditionScores: scores, members: memberRows };

  // CM must not see payment details — Finance Manager territory
  if (req.user.role === 'contestant_manager') {
    const PAYMENT_FIELDS = ['payment_method', 'payment_reference', 'payment_notes',
                            'payment_verified_by', 'payment_verified_at'];
    PAYMENT_FIELDS.forEach((f) => delete contestant[f]);
  }

  res.json(contestant);
});

// ── Contestant Manager / Superuser: update contestant details ─────
router.patch('/:id', requireAuth(MANAGERS, 'manage_contestants'), async (req, res) => {
  const { fullName, stageName, shortBio, talentDescription, judgeNotes, county, categoryId } = req.body || {};

  if (county) {
    if (!isValidCounty(county)) return res.status(400).json({ error: 'Invalid county.' });
  }
  if (categoryId) {
    const { rows: catCheck } = await db.query('SELECT id FROM categories WHERE id = $1 AND active = TRUE', [categoryId]);
    if (!catCheck.length) return res.status(400).json({ error: 'Invalid category.' });
  }

  const { rows } = await db.query(
    `UPDATE contestants SET
       full_name          = COALESCE($1, full_name),
       stage_name         = COALESCE($2, stage_name),
       short_bio          = COALESCE($3, short_bio),
       talent_description = COALESCE($4, talent_description),
       judge_notes        = COALESCE($5, judge_notes),
       county             = COALESCE($6, county),
       category_id        = COALESCE($7, category_id)
     WHERE id = $8 RETURNING id, full_name, status`,
    [
      fullName          ? String(fullName).trim()                                     : null,
      stageName         !== undefined ? (stageName ? String(stageName).trim() : null) : null,
      shortBio          ? String(shortBio).trim()                                     : null,
      talentDescription ? String(talentDescription).trim()                            : null,
      judgeNotes        !== undefined ? String(judgeNotes).trim()                     : null,
      county            ? String(county).trim()                                       : null,
      categoryId        || null,
      req.params.id
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Contestant not found.' });
  logAction({ actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
    action: 'contestant_edited', entityType: 'contestant', entityId: req.params.id,
    detail: `Edited contestant: ${rows[0].full_name}` });
  res.json({ message: 'Contestant updated.', contestant: rows[0] });
});

// ── Superuser: manual status override (any contestant, any status) ──
router.patch('/:id/status', requireAuth(['superuser', 'admin']), async (req, res) => {
  try {
    const VALID = ['pending_payment', 'registered', 'qualified', 'waiting_list', 'rejected', 'eliminated', 'winner', 'runner_up', 'second_runner_up', 'finalist'];
    const { status, reason } = req.body || {};
    if (!VALID.includes(status)) return res.status(400).json({ error: `Status must be one of: ${VALID.join(', ')}.` });

    const { rows: existing } = await db.query(
      'SELECT id, full_name, email, status, season_id, category_id, payment_verified_at, user_id, entry_type FROM contestants WHERE id = $1',
      [req.params.id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Contestant not found.' });
    const c = existing[0];

    const effectiveStatus = status;

    // Active statuses that confirm a contestant has paid / been accepted
    const ACTIVE_STATUSES = ['registered', 'qualified', 'waiting_list', 'winner', 'eliminated', 'runner_up', 'second_runner_up', 'finalist'];
    // Reverting statuses — undo the payment stamp so the contestant drops back into the pending queue
    const REVERT_STATUSES = ['pending_payment', 'rejected'];

    const needsPaymentStamp = ACTIVE_STATUSES.includes(effectiveStatus) && !c.payment_verified_at;
    const clearPaymentStamp  = REVERT_STATUSES.includes(effectiveStatus)  &&  c.payment_verified_at;

    // Persist status + payment stamp changes in one query
    if (needsPaymentStamp) {
      await db.query(
        'UPDATE contestants SET status=$1, payment_verified_by=$3, payment_verified_at=NOW() WHERE id=$2',
        [effectiveStatus, req.params.id, req.user.sub]
      );
    } else if (clearPaymentStamp) {
      // Also unlink the locked contestant account so they drop off the CM dashboard.
      // The users row is kept intact so it can be reused if re-qualified later.
      if (c.user_id) {
        await db.query('UPDATE users SET contestant_id=NULL WHERE id=$1', [c.user_id]);
      }
      await db.query(
        'UPDATE contestants SET status=$1, payment_verified_by=NULL, payment_verified_at=NULL, user_id=NULL WHERE id=$2',
        [effectiveStatus, req.params.id]
      );
    } else {
      await db.query('UPDATE contestants SET status=$1 WHERE id=$2', [effectiveStatus, req.params.id]);
    }

    // ── Status-specific side-effects (mirrors the normal flow) ──────────
    const { sendMail, qualifiedEmail, waitingListEmail, rejectionEmail, paymentVerifiedEmail } = require('../lib/email');

    if (effectiveStatus === 'qualified') {
      if (c.season_id) {
        try {
          await db.query(
            `WITH next_num AS (
               SELECT COALESCE(MAX(contestant_number), 0) + 1 AS n
               FROM contestants WHERE season_id = $1
             )
             UPDATE contestants SET contestant_number = next_num.n
             FROM next_num
             WHERE id = $2 AND contestant_number IS NULL`,
            [c.season_id, req.params.id]
          );
        } catch (e) { console.error('[override:contestant_number]', e.message); }
      }
      try {
        await ensureContestantAccount(req.params.id, c.full_name, c.email);
        await sendMail(qualifiedEmail({ name: c.full_name, email: c.email }));
      } catch (e) { console.error('[override:qualified]', e.message); }
    }
    if (effectiveStatus === 'registered') {
      try { await sendMail(paymentVerifiedEmail({ name: c.full_name, email: c.email })); }
      catch (e) { console.error('[override:registered]', e.message); }
    }
    if (effectiveStatus === 'waiting_list') {
      try { await sendMail(waitingListEmail({ name: c.full_name, email: c.email })); }
      catch (e) { console.error('[override:waiting_list]', e.message); }
    }
    if (effectiveStatus === 'rejected') {
      try { await sendMail(rejectionEmail({ name: c.full_name, email: c.email })); }
      catch (e) { console.error('[override:rejected]', e.message); }
    }

    // ── Accounting: stamp registration revenue when contestant first becomes active ──
    if (needsPaymentStamp && c.season_id) {
      try {
        const { rows: pricing } = await db.query(
          'SELECT registration_fee_lrd, usd_to_lrd_rate FROM seasons WHERE id=$1',
          [c.season_id]
        );
        const feeLrd = parseFloat(pricing[0]?.registration_fee_lrd || 0);
        const rate   = parseFloat(pricing[0]?.usd_to_lrd_rate || 180);
        if (feeLrd > 0) {
          await db.query(
            `INSERT INTO accounting_entries
               (season_id, type, amount_lrd, amount_usd, reference_id, reference_name, description, created_by)
             SELECT $1,'registration',$2,$3,$4,$5,$6,$7
             WHERE NOT EXISTS (
               SELECT 1 FROM accounting_entries WHERE reference_id=$4 AND type='registration'
             )`,
            [c.season_id, feeLrd, parseFloat((feeLrd / rate).toFixed(2)),
             req.params.id, c.full_name,
             `Registration fee — ${c.full_name} (override)`, req.user.sub]
          );
        }
      } catch (e) { console.error('[override:accounting]', e.message); }
    }

    // Auto-fill waiting list when a qualified contestant is removed from competition.
    // Promotes whoever is next on the single OVERALL waitlist queue — one competition,
    // not one waitlist per category.
    if (['eliminated', 'rejected'].includes(effectiveStatus) && c.season_id) {
      try {
        const { rows: activeRounds } = await db.query(
          `SELECT id FROM rounds WHERE season_id = $1 AND status IN ('open','scoring') ORDER BY display_order DESC LIMIT 1`,
          [c.season_id]
        );
        if (activeRounds.length) {
          const { rows: wl } = await db.query(
            `SELECT id, full_name, email, entry_type FROM contestants
             WHERE status = 'waiting_list' AND waitlist_round_id = $1 AND season_id = $2
             ORDER BY waitlist_position ASC LIMIT 1`,
            [activeRounds[0].id, c.season_id]
          );
          if (wl.length) {
            await db.query(
              `WITH next_num AS (
                 SELECT COALESCE(MAX(contestant_number), 0) + 1 AS n
                 FROM contestants WHERE season_id = $2
               )
               UPDATE contestants
               SET status = 'qualified',
                   waitlist_position = NULL,
                   waitlist_round_id = NULL,
                   contestant_number = CASE WHEN contestant_number IS NULL THEN next_num.n ELSE contestant_number END
               FROM next_num
               WHERE id = $1`,
              [wl[0].id, c.season_id]
            );
            try { await ensureContestantAccount(wl[0].id, wl[0].full_name, wl[0].email); } catch (_) {}
            await sendMail(waitlistPromotedEmail({ name: wl[0].full_name, email: wl[0].email }));
          }
        }
      } catch (fillErr) {
        console.error('[auto-fill waitlist]', fillErr.message);
      }
    }

    logAction({ actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
      action: 'status_override', entityType: 'contestant', entityId: req.params.id,
      detail: `${c.full_name} status: ${c.status} → ${effectiveStatus}${reason ? ' — ' + reason : ''}` });

    res.json({
      message: `${c.full_name} status changed from "${c.status}" to "${effectiveStatus}"${reason ? ' — ' + reason : ''}.`,
      contestant: { id: c.id, name: c.full_name, oldStatus: c.status, newStatus: effectiveStatus }
    });
  } catch (err) {
    console.error('[PATCH /contestants/:id/status]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Finance Manager / Superuser: verify registration payment ──────
router.post('/:id/verify-payment', requireAuth(FINANCE, 'verify_payments'), async (req, res) => {
  const { paymentMethod, paymentReference, paymentNotes } = req.body || {};

  const { rows: existing } = await db.query('SELECT status, full_name, email, season_id FROM contestants WHERE id = $1', [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: 'Contestant not found.' });
  if (existing[0].status !== 'pending_payment') {
    return res.status(409).json({ error: `Contestant is already ${existing[0].status}.` });
  }

  await db.query(
    `UPDATE contestants SET
       status               = 'registered',
       payment_method       = $1,
       payment_reference    = $2,
       payment_notes        = $3,
       payment_verified_by  = $4,
       payment_verified_at  = NOW()
     WHERE id = $5`,
    [
      paymentMethod   ? String(paymentMethod).trim()   : null,
      paymentReference ? String(paymentReference).trim() : null,
      paymentNotes    ? String(paymentNotes).trim()    : null,
      req.user.sub,
      req.params.id
    ]
  );

  logAction({ actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
    action: 'payment_verified', entityType: 'contestant', entityId: req.params.id,
    detail: `Payment verified for ${existing[0].full_name} (${existing[0].email}) via ${paymentMethod || 'unspecified'}` });

  // Record accounting entry for registration fee
  if (existing[0].season_id) {
    try {
      const { rows: pricing } = await db.query(
        'SELECT registration_fee_lrd, usd_to_lrd_rate FROM seasons WHERE id = $1',
        [existing[0].season_id]
      );
      const feeLrd = parseFloat(pricing[0]?.registration_fee_lrd || 0);
      const rate   = parseFloat(pricing[0]?.usd_to_lrd_rate || 180);
      if (feeLrd > 0) {
        await db.query(
          `INSERT INTO accounting_entries
             (season_id, type, amount_lrd, amount_usd, reference_id, reference_name, description, created_by)
           VALUES ($1, 'registration', $2, $3, $4, $5, $6, $7)`,
          [existing[0].season_id, feeLrd, parseFloat((feeLrd / rate).toFixed(2)),
           req.params.id, existing[0].full_name,
           `Registration fee — ${existing[0].full_name}`, req.user.sub]
        );
      }
    } catch (acctErr) {
      console.error('[verify-payment accounting]', acctErr.message);
    }
  }

  await sendMail(paymentVerifiedEmail({ name: existing[0].full_name, email: existing[0].email }));
  res.json({ message: `Payment verified. ${existing[0].full_name} is now registered and will qualify when the qualification run is triggered.` });
});

module.exports = router;
