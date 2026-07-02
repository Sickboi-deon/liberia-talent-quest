const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { hashPassword, generateTempPassword } = require('../lib/auth');
const { isValidEmail }  = require('../lib/validate');
const { requireAuth }   = require('../middleware/requireAuth');
const { sendMail, staffWelcomeEmail, staffPasswordResetEmail } = require('../lib/email');

const STAFF_ROLES = [
  'superuser', 'admin', 'contestant_manager', 'finance_manager',
  'judge', 'head_judge', 'content_manager', 'media_coordinator', 'communications_manager'
];

const ALL_PERMISSIONS = [
  'configure_notifications',  // Email/WhatsApp channel credential setup
  'send_notifications',       // Send notifications to contestant groups
  'manage_announcements',     // Post/delete public announcements
  'manage_schedule',          // Add/remove event schedule entries
  'manage_contestants',       // Edit contestant details, override status
  'verify_payments',          // Verify contestant registration payments
  'manage_voting_codes',      // Generate and manage voting codes
  'manage_content',           // Manage sponsors and public content
  'manage_media',             // Upload/manage contestant media files
  'submit_performances',      // Submit performance videos for contestants
  'view_all_scores',          // View all judge scores and CSV reports
  'manage_users',             // Create/list/delete staff accounts (never superuser accounts)
  'manage_categories',        // Create/edit/delete talent categories
  'manage_rounds',            // Create/edit/delete competition rounds
  'run_qualification',        // Trigger the qualification run (preview remains open to Head Judge)
];

function publicUser(u) {
  return {
    id:                 u.id,
    name:               u.name,
    email:              u.email,
    role:               u.role,
    permissions:        u.permissions || [],
    mustChangePassword: u.must_change_password,
    createdAt:          u.created_at,
  };
}

// List users — superuser, admin (by role), or anyone with manage_users permission
router.get('/', requireAuth(['superuser', 'admin'], 'manage_users'), async (req, res) => {
  const { role } = req.query;
  let q    = "SELECT id, name, email, role, permissions, must_change_password, created_at FROM users WHERE role != 'contestant'";
  const qv = [];
  if (role) { qv.push(role); q += ` AND role = $1`; }
  q += ' ORDER BY created_at DESC';

  const { rows } = await db.query(q, qv);
  res.json(rows.map(publicUser));
});

// Create staff account — superuser, or anyone granted manage_users.
// manage_users holders may create any staff role EXCEPT another superuser —
// that stays an exclusively superuser action to prevent a granted permission
// from being used to mint a second all-access account.
router.post('/', requireAuth(['superuser'], 'manage_users'), async (req, res) => {
  const { name, email, role } = req.body || {};

  if (!name || !email || !role) return res.status(400).json({ error: 'Name, email, and role are required.' });
  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${STAFF_ROLES.join(', ')}.` });
  }
  if (role === 'superuser' && req.user.role !== 'superuser') {
    return res.status(403).json({ error: 'Only the Superuser can create another Superuser account.' });
  }
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

  const normalizedEmail = String(email).trim().toLowerCase();
  const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.length) return res.status(409).json({ error: 'An account with this email already exists.' });

  const tempPassword = generateTempPassword();
  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id, name, email, role, permissions, must_change_password, created_at`,
    [String(name).trim(), normalizedEmail, hashPassword(tempPassword), role]
  );
  const newUser = rows[0];

  let emailSent = false;
  try {
    await sendMail(staffWelcomeEmail({ name: newUser.name, email: newUser.email, tempPassword, role }));
    emailSent = true;
  } catch { /* email failure is non-fatal — tempPassword is always returned in the response */ }

  await db.query(
    `INSERT INTO permission_audit_log (changed_by, target_user, action, detail) VALUES ($1, $2, 'create', $3)`,
    [req.user.sub, newUser.id, `Created ${role} account for ${newUser.email}`]
  );

  res.status(201).json({
    message: emailSent
      ? `Account created. Credentials emailed to ${newUser.email}.`
      : `Account created. Email not configured — share the temporary password with the user directly.`,
    user: publicUser(newUser),
    tempPassword,
    emailSent,
  });
});

// Delete user — superuser, or anyone granted manage_users.
// manage_users holders may not delete a superuser account.
router.delete('/:id', requireAuth(['superuser'], 'manage_users'), async (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  const { rows: delRows } = await db.query("SELECT id, name, email, role FROM users WHERE id = $1 AND role != 'contestant'", [req.params.id]);
  if (!delRows.length) return res.status(404).json({ error: 'User not found.' });
  if (delRows[0].role === 'superuser' && req.user.role !== 'superuser') {
    return res.status(403).json({ error: 'Only the Superuser can delete a Superuser account.' });
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  } catch (err) {
    // 23503 = foreign_key_violation — e.g. a judge who has already submitted scores.
    if (err.code === '23503') {
      return res.status(409).json({ error: 'This account has associated records (scores, uploads, or audit history) and cannot be deleted. Revoke their permissions instead.' });
    }
    throw err;
  }
  await db.query(
    `INSERT INTO permission_audit_log (changed_by, target_user, action, detail) VALUES ($1, $2, 'delete', $3)`,
    [req.user.sub, req.params.id, `Deleted ${delRows[0].role} account: ${delRows[0].email}`]
  ).catch(() => {});
  res.json({ message: 'Account deleted.' });
});

// POST /api/users/:id/reset-password — superuser / manage_users permission
// Generates a new temp password, forces change on next login, emails it (if email configured).
// Always returns the temp password in the response so the admin can relay it manually.
router.post('/:id/reset-password', requireAuth(['superuser'], 'manage_users'), async (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'Use the forgot-password flow to reset your own password.' });
  }

  const { rows } = await db.query(
    "SELECT id, name, email, role FROM users WHERE id = $1 AND role != 'contestant'",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  const user = rows[0];
  if (user.role === 'superuser' && req.user.role !== 'superuser') {
    return res.status(403).json({ error: 'Only the Superuser can reset a Superuser account\'s password.' });
  }

  const tempPassword = generateTempPassword();
  await db.query(
    'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2',
    [hashPassword(tempPassword), user.id]
  );

  let emailSent = false;
  try {
    const result = await sendMail(staffPasswordResetEmail({
      name: user.name, email: user.email, tempPassword
    }));
    emailSent = !!result.sent;
  } catch { /* email failure is non-fatal — temp password is always returned */ }

  res.json({
    message: emailSent
      ? `Password reset. New credentials emailed to ${user.email}.`
      : `Password reset. Email not configured — give the temp password to the user directly.`,
    tempPassword,
    emailSent,
    userName: user.name,
    userEmail: user.email,
  });
});

// GET /api/users/:id/permissions — superuser only
router.get('/:id/permissions', requireAuth(['superuser']), async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, role, permissions FROM users WHERE id = $1 AND role != 'contestant'",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  res.json({ permissions: rows[0].permissions || [] });
});

// PUT /api/users/:id/permissions — superuser only
router.put('/:id/permissions', requireAuth(['superuser']), async (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'You cannot edit your own permissions.' });
  }

  const { permissions } = req.body || {};
  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions must be an array.' });
  }

  const invalid = permissions.filter(p => !ALL_PERMISSIONS.includes(p));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown permissions: ${invalid.join(', ')}.` });
  }

  const { rows } = await db.query(
    "SELECT id, role, permissions FROM users WHERE id = $1 AND role != 'contestant'",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  if (rows[0].role === 'superuser') {
    return res.status(400).json({ error: 'Superuser already has full access — permissions cannot be set.' });
  }

  const oldPerms = rows[0].permissions || [];

  await db.query(
    'UPDATE users SET permissions = $1 WHERE id = $2',
    [JSON.stringify(permissions), req.params.id]
  );

  const added   = permissions.filter((p) => !oldPerms.includes(p));
  const removed = oldPerms.filter((p) => !permissions.includes(p));
  const detail  = [
    added.length   ? `Granted: ${added.join(', ')}`   : null,
    removed.length ? `Revoked: ${removed.join(', ')}` : null,
  ].filter(Boolean).join('. ') || 'No change';
  await db.query(
    `INSERT INTO permission_audit_log (changed_by, target_user, action, detail) VALUES ($1, $2, 'permissions', $3)`,
    [req.user.sub, req.params.id, detail]
  );

  res.json({
    message: 'Permissions saved. The user must log in again for changes to take effect.',
    permissions,
  });
});

module.exports = router;
