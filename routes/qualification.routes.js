const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth } = require('../middleware/requireAuth');
const { sendMail, qualifiedEmail, waitingListEmail, rejectionEmail } = require('../lib/email');
const { ensureContestantAccount } = require('../lib/contestant-accounts');
const { logAction } = require('../lib/audit');

// Superuser: run qualification
// Auto-qualify ON (audition_video_required = false): qualifies all registered contestants with verified payment, first-come first-served.
// Auto-qualify OFF (audition_video_required = true): qualifies top scorers using judge score thresholds.
router.post('/run', requireAuth(['superuser'], 'run_qualification'), async (req, res) => {
  try {
    const { rows: settings } = await db.query(
      'SELECT qualify_min_score, waitlist_min_score, min_judges_to_qualify, audition_video_required FROM settings WHERE id = 1'
    );
    const s = settings[0];
    const autoQualify = s.audition_video_required === false;

    let qualified = 0, waiting = 0, rejected = 0;
    const results = [];

    if (autoQualify) {
      // AUTO-QUALIFY ON: all verified payments qualify, ordered by payment date (first come first served)
      const { rows: contestants } = await db.query(
        `SELECT id, full_name, email, entry_type, season_id FROM contestants
         WHERE status = 'registered'
           AND payment_verified_at IS NOT NULL
           AND season_id = (SELECT id FROM seasons WHERE is_current = TRUE LIMIT 1)
         ORDER BY payment_verified_at ASC`
      );

      if (!contestants.length) {
        return res.json({ message: 'No registered contestants with verified payment found.', qualified: 0, waiting: 0, rejected: 0 });
      }

      const seasonId = contestants[0].season_id;
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const { rows: maxRows } = await client.query(
          'SELECT COALESCE(MAX(contestant_number), 0) AS cur FROM contestants WHERE season_id = $1',
          [seasonId]
        );
        let nextNum = maxRows[0].cur + 1;
        for (const c of contestants) {
          await client.query(
            'UPDATE contestants SET status = $1, contestant_number = $2 WHERE id = $3 AND contestant_number IS NULL',
            ['qualified', nextNum, c.id]
          );
          results.push({ id: c.id, name: c.full_name, email: c.email, entry_type: c.entry_type, status: 'qualified' });
          qualified++;
          nextNum++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

    } else {
      // AUTO-QUALIFY OFF: score-based using judge thresholds
      const { qualify_min_score: qMin, waitlist_min_score: wMin, min_judges_to_qualify: minJ } = s;

      const { rows: contestants } = await db.query(
        `SELECT c.id, c.full_name, c.email, c.entry_type, c.season_id,
                ROUND(AVG(a.total_score)::numeric, 1) AS avg_score,
                COUNT(a.id)::int AS score_count
         FROM contestants c
         JOIN audition_scores a ON a.contestant_id = c.id
         WHERE c.status = 'registered'
           AND c.season_id = (SELECT id FROM seasons WHERE is_current = TRUE LIMIT 1)
         GROUP BY c.id
         HAVING COUNT(a.id) >= $1`,
        [minJ || 1]
      );

      if (!contestants.length) {
        return res.json({ message: 'No registered contestants have reached the minimum judge count yet.', qualified: 0, waiting: 0, rejected: 0 });
      }

      const seasonId = contestants[0].season_id;
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const { rows: maxRows } = await client.query(
          'SELECT COALESCE(MAX(contestant_number), 0) AS cur FROM contestants WHERE season_id = $1',
          [seasonId]
        );
        let nextNum = maxRows[0].cur + 1;
        for (const c of contestants) {
          let newStatus;
          if (c.avg_score >= qMin)       { newStatus = 'qualified';    qualified++; }
          else if (c.avg_score >= wMin)  { newStatus = 'waiting_list'; waiting++;  }
          else                           { newStatus = 'rejected';     rejected++;  }
          if (newStatus === 'qualified') {
            await client.query(
              'UPDATE contestants SET status = $1, contestant_number = $2 WHERE id = $3 AND contestant_number IS NULL',
              [newStatus, nextNum, c.id]
            );
            nextNum++;
          } else {
            await client.query('UPDATE contestants SET status = $1 WHERE id = $2', [newStatus, c.id]);
          }
          results.push({ id: c.id, name: c.full_name, email: c.email, entry_type: c.entry_type, avgScore: c.avg_score, status: newStatus });
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    // Send emails after DB commit (non-fatal)
    for (const r of results) {
      try {
        if (r.status === 'qualified') {
          await ensureContestantAccount(r.id, r.name, r.email);
          await sendMail(qualifiedEmail({ name: r.name, email: r.email }));
        } else if (r.status === 'waiting_list') {
          await sendMail(waitingListEmail({ name: r.name, email: r.email }));
        } else {
          await sendMail(rejectionEmail({ name: r.name, email: r.email }));
        }
      } catch (mailErr) {
        console.error('[qualification/run] email failed for', r.name, ':', mailErr.message);
      }
    }

    logAction({ actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
      action: 'qualification_run',
      detail: `Qualification run (${autoQualify ? 'auto-qualify ON' : 'score-based'}): ${qualified} qualified, ${waiting} waiting list, ${rejected} rejected` });

    res.json({
      message: `Qualification complete. ${qualified} qualified, ${waiting} waiting list, ${rejected} rejected.`,
      mode: autoQualify ? 'payment_order' : 'score_based',
      qualified, waiting, rejected, results
    });
  } catch (err) {
    console.error('[POST /qualification/run]', err);
    res.status(500).json({ error: 'Server error during qualification run.' });
  }
});

// Superuser / Admin / Head Judge: preview who would qualify at current thresholds (no changes made)
router.get('/preview', requireAuth(['superuser', 'admin', 'head_judge']), async (req, res) => {
  try {
    const { rows: settings } = await db.query(
      'SELECT qualify_min_score, waitlist_min_score, min_judges_to_qualify FROM settings WHERE id = 1'
    );
    const { qualify_min_score: qMin, waitlist_min_score: wMin, min_judges_to_qualify: minJ } = settings[0];

    const { rows } = await db.query(
      `SELECT c.id, c.full_name, cat.name AS category,
              ROUND(AVG(a.total_score)::numeric, 1) AS avg_score,
              COUNT(a.id)::int AS score_count,
              CASE
                WHEN AVG(a.total_score) >= $1 THEN 'qualified'
                WHEN AVG(a.total_score) >= $2 THEN 'waiting_list'
                ELSE 'rejected'
              END AS projected_status
       FROM contestants c
       JOIN audition_scores a ON a.contestant_id = c.id
       LEFT JOIN categories cat ON cat.id = c.category_id
       WHERE c.status = 'registered'
         AND c.season_id = (SELECT id FROM seasons WHERE is_current = TRUE LIMIT 1)
       GROUP BY c.id, cat.name
       ORDER BY avg_score DESC`,
      [qMin, wMin]
    );
    res.json({ thresholds: { qualify: qMin, waitlist: wMin, minJudges: minJ || 1 }, contestants: rows });
  } catch (err) {
    console.error('[GET /qualification/preview]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
