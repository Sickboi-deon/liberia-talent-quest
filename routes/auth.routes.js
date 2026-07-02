const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');

const db = require('../lib/db');
const { hashPassword, verifyPassword, signToken, generateResetToken, parseResetToken } = require('../lib/auth');
const { requireAuth } = require('../middleware/requireAuth');
const { sendMail, passwordResetEmail } = require('../lib/email');
const { isValidEmail } = require('../lib/validate');
const { logAction } = require('../lib/audit');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [String(email).trim().toLowerCase()]
    );
    const user = rows[0];

    if (!user || !verifyPassword(password, user.password_hash) || user.role === 'contestant') {
      logAction({ actorId: user?.id, actorRole: user?.role, actorName: user?.name,
        action: 'login_failed', detail: `Failed login attempt for ${String(email).trim().toLowerCase()}` });
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    logAction({ actorId: user.id, actorRole: user.role, actorName: user.name,
      action: 'login', detail: `${user.role} logged in` });

    const token       = signToken(user);
    const permissions = user.role === 'superuser' ? ['*'] : (user.permissions || []);
    res.cookie('ltq_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({
      id:          user.id,
      role:        user.role,
      name:        user.name,
      email:       user.email,
      permissions,
      mustChangePassword: !!user.must_change_password,
      contestantId: user.contestant_id || null
    });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.get('/me', requireAuth(), (req, res) => {
  res.json({
    name:         req.user.name,
    email:        req.user.email,
    role:         req.user.role,
    permissions:  req.user.permissions || [],
    contestantId: req.user.contestantId || null
  });
});

router.post('/change-password', requireAuth(), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.sub]);
    const user = rows[0];
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
      [hashPassword(newPassword), req.user.sub]
    );
    const freshToken = signToken({
      id: req.user.sub, role: req.user.role, name: req.user.name, email: req.user.email,
      contestant_id: req.user.contestantId || null, permissions: req.user.permissions || [],
      must_change_password: false
    });
    res.cookie('ltq_session', freshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    logAction({ actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
      action: 'password_change', detail: 'Password changed' });
    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error('[POST /auth/change-password]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('ltq_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.json({ message: 'Logged out.' });
});

router.post('/forgot-password', passwordLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    const generic = "If an account exists for that email, we've sent a reset link.";
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [String(email).trim().toLowerCase()]
    );
    const user = rows[0];

    if (user) {
      const { token, hash, expiresAt } = generateResetToken(user.id);
      await db.query(
        'UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3',
        [hash, expiresAt, user.id]
      );
      const resetLink = `${APP_URL}/reset-password.html?token=${encodeURIComponent(token)}`;
      try {
        await sendMail(passwordResetEmail({ name: user.name, email: user.email, resetLink }));
      } catch (mailErr) {
        console.error('[forgot-password] email send failed:', mailErr.message);
      }
    }

    res.json({ message: generic });
  } catch (err) {
    console.error('[POST /auth/forgot-password]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.post('/reset-password', passwordLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    const invalid = 'This reset link is invalid or has expired. Request a new one.';

    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const parsed = parseResetToken(token);
    if (!parsed) return res.status(400).json({ error: invalid });

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [parsed.userId]);
    const user = rows[0];

    if (
      !user ||
      !user.reset_token_hash ||
      user.reset_token_hash !== parsed.secretHash ||
      !user.reset_token_expires_at ||
      new Date(user.reset_token_expires_at) < new Date()
    ) {
      return res.status(400).json({ error: invalid });
    }

    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $2',
      [hashPassword(newPassword), user.id]
    );
    res.json({ message: 'Password reset. You can log in with your new password now.' });
  } catch (err) {
    console.error('[POST /auth/reset-password]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

module.exports = router;
