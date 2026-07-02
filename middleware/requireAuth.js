const { verifyToken } = require('../lib/auth');

/**
 * requireAuth(allowedRoles?, requiredPermission?)
 *
 * allowedRoles       – array of role strings; omit or pass [] for "any authenticated user"
 * requiredPermission – single permission key; user must have it (superuser always passes)
 *
 * Superuser (permissions: ['*']) bypasses every check automatically.
 */
function requireAuth(allowedRoles, requiredPermission) {
  return (req, res, next) => {
    const token = req.cookies?.ltq_session || null;
    if (!token) return res.status(401).json({ error: 'Login required.' });

    try {
      const payload    = verifyToken(token);
      const perms      = payload.permissions || [];
      const isSuperuser = perms.includes('*');

      if (!isSuperuser) {
        const hasRoleAccess = !!(allowedRoles && allowedRoles.length > 0 && allowedRoles.includes(payload.role));
        const hasPermAccess = !!(requiredPermission && perms.includes(requiredPermission));
        // Open route: no roles and no permission required — any authenticated user passes
        const isOpenRoute   = (!allowedRoles || allowedRoles.length === 0) && !requiredPermission;

        if (!isOpenRoute && !hasRoleAccess && !hasPermAccess) {
          return res.status(403).json({ error: 'You do not have permission to do that.' });
        }
      }

      // Enforce password-change requirement: block all routes except change-password itself
      if (payload.mustChangePassword) {
        const allowedPaths = ['/change-password', '/api/auth/change-password'];
        if (!allowedPaths.some(p => req.path === p || req.originalUrl === p)) {
          return res.status(403).json({ error: 'You must change your password before continuing.', mustChangePassword: true });
        }
      }

      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    }
  };
}

module.exports = { requireAuth };
