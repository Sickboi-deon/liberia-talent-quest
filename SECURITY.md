# Security Architecture — Liberia Talent Quest

This document describes the security controls built into the platform.

---

## Authentication

### Session Token

- **Type:** JSON Web Token (JWT), signed with HS256
- **Transport:** HttpOnly cookie named `ltq_session` — inaccessible to JavaScript
- **TTL:** 7 days (cookie `maxAge` and JWT `expiresIn` are intentionally aligned)
- **Secure flag:** Set to `true` when `NODE_ENV=production` — cookie is only sent over HTTPS
- **SameSite:** `lax` — allows normal navigation, blocks cross-site POST forgery

### Password Security

- Passwords are hashed with **bcrypt**, cost factor 10 (≈ 100 ms per hash on modern hardware)
- Passwords are never stored in plaintext or logged anywhere
- Minimum length: 6 characters (enforced server-side)
- Temporary passwords for new staff accounts are generated using `crypto.randomInt` over a 55-character alphabet

### First-Login Enforcement

- Every new staff account has `must_change_password = TRUE`
- The `requireAuth` middleware blocks ALL routes except `/api/auth/change-password` for users with this flag set
- The frontend `guardRole()` also redirects to `change-password.html` before checking role

### Contestant Account Policy

- **Contestants are never given login accounts** — not even winners, runners-up, or group members.
- The login route explicitly rejects any account with `role = 'contestant'`.
- Solo contestants that qualify may have a legacy internal `users` row with a locked random password (used historically to gate Contestant Manager access). This is a technical internal record — no one can log in with it.
- Group contestants never have any `users` row.
- All Contestant Manager access is now gated on contestant **status**, not the presence of a `user_id`.

---

## Rate Limiting

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/auth/login` | 10 requests | 15 minutes |
| `POST /api/auth/forgot-password` | 5 requests | 15 minutes |
| `POST /api/auth/reset-password` | 5 requests | 15 minutes |
| `POST /api/votes` | 10 requests | 1 minute |
| `POST /api/contestants` (public registration) | 8 requests | 15 minutes |

Rate limit headers are set (`RateLimit-*`) per RFC 9110. All limits are per IP address.

Authenticated staff-only endpoints (create user, verify payment, submit a score, etc.) are
intentionally not additionally rate-limited — they already require a valid session, and legitimate
staff workflows (e.g. a judge scoring many contestants back-to-back) need to move quickly. A
compromised staff session is a bigger problem than request throughput at that point.

---

## Password Reset

- Token format: `userId:secret` — the `secret` is 32 random bytes (hex)
- Only the **SHA-256 hash** of the secret is stored in the database — never the raw token
- Tokens expire after **1 hour**
- Tokens are single-use: the hash and expiry are cleared immediately on use
- The forgot-password endpoint always returns the same message regardless of whether the email exists — prevents user enumeration

---

## Role-Based Access Control (RBAC)

See [ROLES.md](ROLES.md) for the full reference.

- Every protected API route uses `requireAuth(allowedRoles, requiredPermission)`
- Superuser has `permissions = ['*']` which bypasses all role and permission checks
- Non-matching requests receive `403 Forbidden` (never silently passed)
- Dashboard HTML pages (`dashboard-*.html`, `change-password.html`) return **404 Not Found** to unauthenticated requests — they are invisible to the public

---

## Input Validation

All user-supplied data is validated server-side before any database write:

| Field | Validation |
|---|---|
| `email` | Regex check: `[^\s@]+@[^\s@]+\.[^\s@]+` |
| `phone` | Liberian format: normalised to `231XXXXXXXXX` (11 digits) |
| `county` | Enum check against all 15 official Liberian counties |
| `gender` | Enum: `Male`, `Female`, `Prefer not to say` — **required for solo only; groups omit it** |
| `dateOfBirth` | Must produce a valid JS Date; age range 10–100 years — **required for solo only** |
| `categoryId` | Must exist in `categories` table with `active = TRUE` |
| `entryType` | Enum: `solo`, `group` — defaults to `solo` if absent or invalid |
| `members` (group) | JSON array; min 2 members, max `max_group_members` setting; every member must have a name |
| `status` (override) | Must be one of the 10 valid status strings |
| Numeric settings | Range-checked (e.g. score weights must sum to 1.0 ± 0.001) |

Validation is done in `lib/validate.js` and called before any DB operation.

---

## File Uploads

### Two-Stage Type Validation

- **Stage 1 — claimed-type filter:** Multer `fileFilter` checks the `Content-Type` the upload
  request claims before accepting the file at all. Allowed types: `image/jpeg`, `image/png`,
  `image/webp` (photos) and `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo`
  (videos). This value is client-supplied and can be spoofed by a non-browser client.
- **Stage 2 — magic-byte content check:** files are received into memory (`multer.memoryStorage`),
  and before being persisted anywhere, `detectRealType()` in `lib/upload.js` inspects the
  actual file bytes (JPEG/PNG/WebP/MP4/MOV/WebM/AVI/PDF signatures) and rejects anything whose
  real content doesn't match an allowed type for that upload — regardless of what the
  `Content-Type` header claimed. A disguised file (e.g. a script renamed to `photo.jpg` with a
  spoofed `image/jpeg` header) is rejected with `400` at this stage.
- File extension is derived from the **detected** type, not the original filename or the
  claimed MIME type — **user-supplied filenames are never trusted or preserved**.
- Uploaded filenames are: `{timestamp}-{7-char-random}{.ext}`.

### Storage: Cloudinary or Local Disk

- If the Superuser has configured Cloudinary (dashboard → **Media Storage**, or `CLOUDINARY_*`
  env vars), validated files are streamed there and never touch the server's disk at all.
- Otherwise, files are written outside the project directory in `~/ltq-uploads/` (or
  `UPLOAD_DIR`) and served at `/uploads/` via a static route — they are never executable
  regardless of content, since Express's static middleware only streams bytes.
- `X-Content-Type-Options: nosniff` prevents MIME sniffing attacks in older browsers.
- Cloudinary credentials are stored in the `settings` table exactly like SMTP/WhatsApp
  credentials — the API secret is never returned by any API response, only a `configured`
  boolean.

### Size Limits

| Upload type | Limit |
|---|---|
| Profile / group photo | 8 MB |
| Audition / performance video | 300 MB |
| Event photos | 300 MB |
| Documents (PDF) | 20 MB |

### Cleanup on Failure

- If a registration or upload request fails validation at any point, `removeFile()` deletes
  any files already persisted earlier in that same request (local disk or Cloudinary, whichever
  applies) before returning the error response — no orphaned files, and no partial state left
  behind when e.g. a photo succeeds but a paired video in the same submission fails.

---

## SQL Injection Prevention

- All database queries use **parameterised queries** via the `pg` library (`$1`, `$2`, …)
- No user-supplied data is interpolated into SQL strings
- Query parameters are cast explicitly where needed (e.g. `$1::boolean`, `$1::int`, `$1::text[]`)

---

## XSS Prevention

- All user-supplied strings rendered in HTML use `escapeHtml()` (defined in `app.js`)
- Server-side HTML email templates use a dedicated `esc()` function with the same escaping logic
- No `innerHTML` is set from raw API data — values always pass through `escapeHtml()` first
- A Content Security Policy is enforced via `helmet` in `server.js` on every response: scripts and
  styles are restricted to `'self'` plus the specific third-party origins the frontend actually
  uses (Google Fonts, Google Analytics/Tag Manager). `unsafe-inline` is allowed for scripts/styles
  because the frontend is plain HTML with inline theme-init `<script>`/`<style>` blocks by design,
  not a bundled SPA — this is a deliberate, scoped trade-off, not an oversight.

## HTTP Security Headers

`helmet` is mounted first in `server.js`, before any route, and applies to every response:
- `Content-Security-Policy` (see above)
- `Strict-Transport-Security` (HSTS) — only meaningful once served over HTTPS
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy`

JSON and URL-encoded request bodies are capped at 1 MB (`express.json({ limit: '1mb' })`) to blunt
oversized-payload DoS attempts. This does not affect file uploads, which go through Multer with
their own per-file-type size limits (see File Uploads below).

---

## Sensitive Data Handling

- SMTP, WhatsApp, and Cloudinary credentials are stored in the `settings` table; the public `/api/settings` endpoint **never returns them** — they are only readable (and masked) via the authenticated `/api/integrations` endpoint
- Payment fields (`payment_method`, `payment_reference`, `payment_notes`, `payment_verified_by`, `payment_verified_at`) are stripped from Contestant Manager API responses — finance data is Finance Manager territory only
- JWT tokens contain role, permissions, and display name — no passwords, no payment info, no personal data beyond the user's name

---

## Audit Log

All material actions are written to the `audit_log` table via `lib/audit.js`:

- Login / login failure
- Password change / reset
- Status overrides (contestant status changes)
- Qualification run triggered
- Round advance / finale triggered
- Staff account creation / deactivation
- Payment verified
- Content created / deleted (announcements, sponsors, schedule entries, etc.)
- Site settings updated
- SMTP / WhatsApp / Cloudinary integration credentials updated (the credential values themselves are never logged — only which fields changed)

The audit log is readable by Superuser and Admin from their dashboards. It is append-only —
there is no delete endpoint for audit entries.

---

## CORS

CORS headers are only set when `CORS_ORIGIN` is defined in the environment. When the
frontend and API are served by the same Express process (default deployment), no CORS
configuration is needed.

In split deployments, set `CORS_ORIGIN` to an explicit comma-separated list of allowed
origins — wildcard `*` is never used.

---

## Security Hardening Checklist (pre-production)

Verify these before going live:

- [ ] `NODE_ENV=production` is set (enables Secure cookie flag)
- [ ] `JWT_SECRET` is a long random string (minimum 48 bytes of entropy), not the default value
- [ ] `SUPERUSER_PASSWORD` has been changed from the initial value (and changed again in the dashboard)
- [ ] HTTPS is configured (Nginx + Certbot or managed SSL)
- [ ] `Superuser.txt` is deleted from the server if it exists (it is gitignored but may exist locally)
- [ ] PostgreSQL is not exposed on a public port (bind to `127.0.0.1` only)
- [ ] The upload directory (`UPLOAD_DIR`) is on a disk with adequate free space and is included in backups
- [ ] Nginx has `client_max_body_size 350M` set (for video uploads)
- [ ] HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) are already applied
      at the application layer via `helmet` in `server.js` — no Nginx-level duplication needed.
      If you customize the CSP for a new third-party script/font origin, edit the `helmet()` config
      in `server.js`, not Nginx.
- [ ] Server logs are rotated and do not contain SMTP passwords or JWT secrets
- [ ] Regular database backups are scheduled (see DEPLOY.md)
- [ ] Upload directory backups are scheduled
- [ ] PM2 is configured to auto-restart and run on boot (`pm2 save && pm2 startup`)

---

## Known Limitations

- **No CSRF token** on state-changing API calls — mitigated by `SameSite=lax` cookie and the fact that all authenticated endpoints require the HttpOnly cookie. Acceptable for same-origin deployment; evaluate if ever deploying with a separate frontend origin.
- **CSP allows `unsafe-inline` for scripts/styles** — the frontend is plain HTML with inline theme-init scripts by design (no build step). This is narrower than no CSP at all (script/style *sources* are still restricted to `'self'` plus a small explicit allowlist), but it does not block inline-script-based XSS the way a nonce-based strict CSP would.
- **Phone numbers are format-checked, not OTP-verified** — a registrant can enter any syntactically valid Liberian phone number.
- **Magic-byte detection covers container/signature format only, not deep content safety** — `detectRealType()` confirms a file is genuinely a JPEG/PNG/WebP/MP4/MOV/WebM/AVI/PDF at the byte level (catching disguised/relabeled files), but does not scan for embedded malware, exploit payloads within an otherwise-valid media file, or run antivirus scanning. No files are ever executed server-side regardless (Express's static middleware only streams bytes), which limits the practical impact of this gap.
