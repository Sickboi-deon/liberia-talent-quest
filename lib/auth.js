const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const TOKEN_TTL = '7d';

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[auth] FATAL: JWT_SECRET must be set in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
  console.warn('[auth] WARNING: JWT_SECRET is not set — using an insecure dev default. Never deploy without setting this.');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

// Returns { token, hash, expiresAt } - `token` goes in the email link,
// `hash`/`expiresAt` get stored on the user record. The raw secret is never stored.
function generateResetToken(userId) {
  const secret = crypto.randomBytes(32).toString('hex');
  return {
    token: `${userId}:${secret}`,
    hash: hashResetSecret(secret),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString()
  };
}

// Splits an incoming token into { userId, secretHash } for lookup, or null if malformed.
function parseResetToken(token) {
  if (!token || typeof token !== 'string' || !token.includes(':')) return null;
  const [userId, secret] = token.split(':');
  if (!userId || !secret) return null;
  return { userId, secretHash: hashResetSecret(secret) };
}

function signToken(user) {
  const permissions = user.role === 'superuser' ? ['*'] : (user.permissions || []);
  // Accept both DB snake_case (must_change_password) and JWT camelCase (mustChangePassword)
  const mustChangePassword = !!(user.must_change_password || user.mustChangePassword);
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email,
      contestantId: user.contestant_id || user.contestantId || null,
      permissions, mustChangePassword },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTempPassword,
  signToken,
  verifyToken,
  generateResetToken,
  parseResetToken
};
