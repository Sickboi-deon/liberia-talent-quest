const crypto = require('crypto');
const db      = require('./db');
const { hashPassword } = require('./auth');

// Called the moment a contestant is qualified.
// Creates a locked users row (role='contestant') and wires the bidirectional
// links: contestants.user_id ↔ users.contestant_id.
// Safe to call multiple times — skips silently if the link already exists.
async function ensureContestantAccount(contestantId, name, email) {
  // Skip if already linked
  const { rows: cRows } = await db.query(
    'SELECT user_id FROM contestants WHERE id = $1',
    [contestantId]
  );
  if (!cRows.length || cRows[0].user_id) return;

  // Reuse an existing contestant-role account for this email (re-qualification edge case)
  const { rows: existing } = await db.query(
    "SELECT id FROM users WHERE email = $1 AND role = 'contestant'",
    [email]
  );

  let userId;
  if (existing.length) {
    userId = existing[0].id;
    await db.query(
      'UPDATE users SET contestant_id = $1 WHERE id = $2',
      [contestantId, userId]
    );
  } else {
    // Create a locked account — random password nobody can ever log in with
    const lockedHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const { rows } = await db.query(
      `INSERT INTO users
         (name, email, password_hash, role, contestant_id, must_change_password)
       VALUES ($1, $2, $3, 'contestant', $4, FALSE)
       RETURNING id`,
      [name, email, lockedHash, contestantId]
    );
    userId = rows[0].id;
  }

  await db.query(
    'UPDATE contestants SET user_id = $1 WHERE id = $2',
    [userId, contestantId]
  );
}

module.exports = { ensureContestantAccount };
