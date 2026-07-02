# Liberia Talent Quest

Liberia's premier talent competition platform. Full-stack Node.js + PostgreSQL system managing
public registration (solo and group entries), audition review, live rounds, real-time voting,
leaderboard, media gallery, and season finale placements — with a 9-role staff RBAC system
and real-time SSE push.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18+ / Express |
| Database | PostgreSQL 14+ |
| Auth | JWT (HttpOnly cookie `ltq_session`, 7-day TTL) |
| Frontend | Plain HTML / CSS / JavaScript (no build step) |
| Real-time | Server-Sent Events (SSE) — leaderboard live updates |
| File uploads | Multer — stored outside the web root in `~/ltq-uploads/` |
| Email | Nodemailer (SMTP, configurable via Superuser dashboard or `.env`) |
| WhatsApp | Meta Cloud API (optional, configurable via Superuser dashboard or `.env`) |

---

## Quick Start (local development)

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, and SUPERUSER_* at minimum

# 3. Create the PostgreSQL database and user
createdb ltq
# or: psql -c "CREATE DATABASE ltq;"

# 4. Apply the schema (single source of truth — all tables, columns,
#    constraints, and indexes) + seed default categories/criteria + superuser
npm run db:init

# 5. Run one-time data migrations (legacy category remap + contestant numbering backfill)
npm run db:migrate

# 6. Start the server
npm start
# Server runs on http://localhost:3000
```

Log in at `http://localhost:3000/login.html` with the `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD`
you set in `.env`. **Change the password immediately on first login.**

### (Optional) Load test data / default public content

```bash
npm run db:public         # About-page team profiles + event photos (real launch content)
npm run db:sponsors       # Sponsor page testimonials/benefits/tiers (real launch content)
npm run db:seed:mock      # staff accounts + solo mock contestants across all 6 categories (dev only)
npm run db:seed:groups    # 7 group contestants across all 6 categories + gallery photos (dev only)
npm run db:seed           # full demo dataset (contestants, rounds, votes, announcements) (dev only)
```

`db:public`, `db:sponsors` seed real launch-ready marketing content and are safe to run in
production. The `db:seed*` scripts create demo accounts with published default passwords and
refuse to run when `NODE_ENV=production`.

---

## Available NPM Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start the production server |
| `npm run db:init` | Apply the full schema (idempotent, safe to re-run) + seed default categories/criteria + create superuser |
| `npm run db:migrate` | Run one-time data migrations: legacy category remap, contestant-number backfill |
| `npm run db:public` | Seed About-page team profiles + event photos (safe for production) |
| `npm run db:sponsors` | Seed sponsor-page testimonials, benefits, and tiers (safe for production) |
| `npm run db:seed` | Seed full demo dataset (contestants, rounds, votes, announcements) — dev only |
| `npm run db:seed:mock` | Seed mock staff accounts and solo contestants for testing — dev only |
| `npm run db:seed:groups` | Seed 7 group contestants across all categories + gallery photos — dev only |

---

## Talent Categories

Six official categories, each operating as an independent competition track:

- **Dancing**
- **Singing**
- **Rapping** *(separate from Singing — different disciplines)*
- **Comedy**
- **Creative Arts**
- **Spoken Words**

---

## Entry Types

Contestants can compete as **solo** performers or as **groups**.

- A **group** is a single competing unit — one registration, one photo, one vote tally, one score, one status.
- Group members are stored separately in the `contestant_members` table, linked to the group's contestant record.
- Gender and date of birth are **not required** for groups (they belong to the group as a whole, not an individual).
- The **Superuser** sets the maximum allowed group size under **Site Settings → Maximum group members** (default: 6, min: 2, max: 50).
- Groups are identified with a **Group badge** everywhere they appear — gallery, vote page, leaderboard, contestant profile, and all staff dashboards.

---

## Roles

Full RBAC reference: see **[ROLES.md](ROLES.md)**.

| Role | Dashboard | Summary |
|---|---|---|
| **Superuser** | `dashboard-superuser.html` | Unrestricted. Manages everything. |
| **Admin** | `dashboard-admin.html` | Broad oversight — applications, accounts, content, scheduling. |
| **Contestant Manager** | `dashboard-contestant-manager.html` | Manages qualified contestants and their competition progress. |
| **Finance Manager** | `dashboard-finance-manager.html` | Verifies registration payments and manages voting codes. |
| **Head Judge** | `dashboard-head-judge.html` | Oversees all judges, triggers qualification and round advance. |
| **Judge** | `dashboard-judge.html` | Reviews audition videos, submits scores for live performances. |
| **Content Manager** | `dashboard-content-manager.html` | Manages announcements, schedule, and team profiles. |
| **Media Coordinator** | `dashboard-media-coordinator.html` | Uploads event photos and contestant media. |
| **Communications Manager** | `dashboard-communications-manager.html` | Sends notifications to contestants. |

> **Important:** Contestants are NOT staff members and do NOT have login accounts — not even winners or group members.

---

## Contestant Flow

```
Public registers (solo or group) → pending_payment
  ↓  Finance Manager verifies payment
registered
  ↓  Head Judge / Superuser triggers qualification run
qualified  |  waiting_list  |  rejected
  ↓  (competition rounds: performances → judge scores + public votes)
  ↓  Head Judge / Superuser triggers round advance
  ↓  (repeat rounds as needed)
  ↓  Finale triggered (no next round exists)
winner | runner_up | second_runner_up | finalist  (overall, top 4 — one competition, not one per category)
remaining → eliminated
```

**Statuses:** `pending_payment` → `registered` → `qualified` / `waiting_list` / `rejected` → `eliminated` / `winner` / `runner_up` / `second_runner_up` / `finalist`

---

## Public Contestant ID

Every contestant — solo or group — is assigned a permanent public ID the moment their
application is submitted (status `pending_payment`), not at qualification. Format:
`LTQ-S{season number}-{3-digit sequence}`, e.g. `LTQ-S2-014`. The number reflects
**registration order** within that season (the 14th applicant this season), not admission
order — it's a stable reference ID from day one, including for applicants who are later
rejected or never complete payment.

Numbers are assigned inside a transaction holding a per-season `pg_advisory_xact_lock`, so
concurrent public registrations can't collide (see `routes/contestants.routes.js` POST `/`).
The ID shows up automatically anywhere a contestant is displayed to staff or the public —
staff Applications tables, the public contestant profile, gallery, leaderboard, and vote page —
once their status makes them visible in that context.

---

## Season & Competition Logic

- A **season** is the top-level container. Only one season has `is_current = TRUE` at a time.
- **Rounds** are created within a season (audition, competition, or finale type).
- **Qualification** can run in two modes:
  - **Score-based** (default): judges score auditions; configurable thresholds determine pass/waitlist/reject.
  - **Auto-qualify** (`audition_video_required = false`): all verified-payment applicants are auto-qualified in payment order (no judge scoring needed).
- **This is one overall competition, not one per category.** Talent category (Dancing,
  Singing, etc.) is a descriptive label on each entry only — it never scopes qualification,
  round advancement, or placements. Every contestant competes against everyone else.
- **Advance** moves the top-N contestants overall forward from one round to the next.
- **Finale** is triggered when no next round exists: the top 4 overall are assigned `winner`,
  `runner_up`, `second_runner_up`, or `finalist`; the rest are `eliminated`.
- **Leaderboard scoring:** `combinedScore = (judgeWeight × normJudgeScore) + (voteWeight × normVotes)`
  - Votes and judge scores are normalised **across all contestants** in the round (global, not per-category).

---

## Public Pages

| Page | Purpose |
|---|---|
| `index.html` | Homepage — countdown, stats, category strip, announcements |
| `register.html` | Public registration form — solo or group, photo + optional video upload |
| `vote.html` | Public voting (requires a purchased voting code) |
| `leaderboard.html` | Live leaderboard — one overall ranking; category tabs filter the view but always show true overall rank; Grand Final view when finale is triggered |
| `gallery.html` | Contestant photo gallery + event photos |
| `contestant-profile.html` | Public profile for a single qualified/finalist contestant; shows group members if applicable |
| `about.html` | About the competition, rules, eligibility |
| `sponsors.html` | Sponsor logos and sponsorship proposal download |
| `contact.html` | Contact details and public announcements |
| `login.html` | Staff login |

---

## Social Media

The footer social media icons are managed by the Superuser under **Site Settings → Social Media Links**. Up to 10 platforms are supported:

Facebook · Instagram · TikTok · X (Twitter) · YouTube · LinkedIn · Pinterest · Snapchat · Reddit · Discord

WhatsApp appears in the **Contact** footer column (not Socials). Only platforms with a URL configured will show an icon.

---

## Project Structure

```
ltq-app/
├── server.js                          Entry point — mounts all routes and middleware
├── .env.example                       Environment variable template
├── package.json
├── README.md
├── ROLES.md
├── DEPLOY.md
├── SECURITY.md
├── USER-MANUAL.md
├── db/
│   ├── schema.sql                     Single source of truth for the full schema — every
│   │                                   table, column, constraint, and index. 100% idempotent:
│   │                                   `CREATE TABLE IF NOT EXISTS` for fresh installs, plus
│   │                                   `ALTER ... ADD COLUMN IF NOT EXISTS` / `DO $$` constraint
│   │                                   blocks so re-running it against an older existing DB
│   │                                   brings it fully up to date too.
│   ├── init.js                        npm run db:init — applies schema.sql + seeds default
│   │                                   categories/criteria + creates the superuser
│   ├── migrate-categories.js          npm run db:migrate — one-time: remaps contestants off
│   │                                   legacy category slugs onto the 6 official categories
│   ├── migrate-contestant-numbers.js  npm run db:migrate — one-time: backfills a public
│   │                                   contestant_number for any contestant created before
│   │                                   IDs were assigned at registration (any status, ordered
│   │                                   by created_at per season). New registrations no longer
│   │                                   need this — see "Public Contestant ID" above.
│   ├── add-public-content.js          npm run db:public — seeds team_profiles + event_photos
│   ├── add-sponsor-content.js         npm run db:sponsors — seeds sponsor_testimonials/benefits/tiers
│   ├── add-missing-roles.js           Dev-only: seeds any of the 4 newer demo staff roles that
│   │                                   are missing. Refuses to run when NODE_ENV=production.
│   ├── seed-full.js                   npm run db:seed — full demo dataset (dev only)
│   ├── seed-mock.js                   npm run db:seed:mock — staff + solo contestants (dev only)
│   ├── seed-groups.js                 npm run db:seed:groups — group contestants + gallery photos (dev only)
│   ├── seed-rounds.js                 Dev-only: seeds 4 placeholder competition rounds
│   ├── check-su.js                    Diagnostic: prints the current superuser account (read-only)
│   ├── verify-no-contestant-logins.js Diagnostic: confirms no `role='contestant'` user can log in
│   ├── reset-su.js --force            Emergency: resets every superuser's password (destructive)
│   └── clear-season2.js --force       Destructive, dev only: wipes all Season 2 data. Refuses to
│                                       run when NODE_ENV=production.
├── lib/
│   ├── auth.js                        bcrypt hashing, JWT sign/verify, reset token generation
│   ├── db.js                          pg Pool wrapper + getClient()
│   ├── email.js                       Nodemailer + HTML email templates
│   ├── events.js                      SSE subscribe/emit (leaderboard real-time)
│   ├── integrations.js                Credential loader (DB → .env fallback, 60-s cache)
│   ├── seasons.js                     getCurrentSeasonId(), getPreviousSeason()
│   ├── upload.js                      Multer storage configs (photos/videos/documents)
│   ├── validate.js                    Phone/email/county/gender/DOB validators
│   ├── audit.js                       logAction() — writes to audit_log table
│   ├── contestant-accounts.js         ensureContestantAccount() — locked users row on solo qualification
│   └── whatsapp.js                    Meta Cloud API sender
├── middleware/
│   └── requireAuth.js                 JWT verification + RBAC role/permission check
├── routes/
│   ├── auth.routes.js                 Login, logout, change-password, forgot/reset password
│   ├── users.routes.js                Staff account CRUD (Superuser / Admin)
│   ├── contestants.routes.js          Registration, queue, profile, status override, payment verify
│   ├── categories.routes.js           Category list (public) + CRUD (Superuser)
│   ├── criteria.routes.js             Scoring criteria CRUD (Superuser / Head Judge)
│   ├── audition-scores.routes.js      Audition video scoring (Judges)
│   ├── qualification.routes.js        Run/preview qualification (Superuser / Head Judge)
│   ├── rounds.routes.js               Round CRUD + advance + finale trigger (Superuser)
│   ├── performances.routes.js         Performance entries (Superuser / Admin / Head Judge)
│   ├── votes.routes.js                Public vote casting + leaderboard API
│   ├── voting-codes.routes.js         Generate/list/export voting codes (Finance Manager)
│   ├── announcements.routes.js        Public announcements CRUD (Superuser / Admin / Content Manager)
│   ├── schedule.routes.js             Event schedule CRUD (Superuser / Admin / Content Manager)
│   ├── sponsors.routes.js             Sponsors CRUD (Superuser / Admin)
│   ├── settings.routes.js             Site settings (Superuser only)
│   ├── media.routes.js                Contestant media uploads (Media Coordinator / Superuser)
│   ├── notifications.routes.js        Bulk / individual notifications (Superuser / Comms Manager)
│   ├── integrations.routes.js         SMTP + WhatsApp credential management (Superuser)
│   ├── seasons.routes.js              Season CRUD (Superuser)
│   ├── team-profiles.routes.js        Team bios (Superuser / Admin / Content Manager)
│   ├── event-photos.routes.js         Event photo/video uploads (Media Coordinator / Superuser)
│   ├── stats.routes.js                Aggregate stats (authenticated staff)
│   ├── accounting.routes.js           Revenue entries (Finance Manager / Superuser)
│   ├── sponsor-content.routes.js      Sponsor page content management (Superuser / Admin)
│   └── admin.routes.js                Audit log + contestant CSV export (Superuser / Admin)
└── public/                            All frontend pages (HTML / CSS / JS — no build step)
    ├── style.css                      Global styles + component library
    ├── app.js                         Shared helpers: auth, nav, theme, footer, toasts, SVG icons
    └── [all .html pages]
```

---

## Email

SMTP credentials are loaded from the database first (Superuser → Notification Channels) and
fall back to `.env` values. If neither is configured, emails are printed to the server console
— useful for development.

Credentials are cached for 60 seconds so they update without a server restart.

---

## File Uploads

All uploaded files (contestant photos, audition videos, event photos, documents) are stored
**outside the web root** in `~/ltq-uploads/` (or `UPLOAD_DIR` env var). They are served via
Express static middleware at `/uploads/`.

- Filenames are randomly generated (timestamp + random suffix) — no user-supplied filenames are preserved.
- MIME type is validated server-side via Multer `fileFilter` — extension spoofing is not possible.
- `X-Content-Type-Options: nosniff` is set on all `/uploads/` responses.

---

## Real-time

The leaderboard and vote counts update in real time via Server-Sent Events at
`/api/events/leaderboard`. Every time a vote is cast, the server emits an `update` event
and all connected leaderboard clients re-fetch.

---

## Password Reset

1. Staff clicks "Forgot your password?" on `/login.html`
2. Enters email → server generates a `userId:secret` token, stores the SHA-256 hash + expiry in the DB, emails the raw token
3. Link opens `/reset-password.html?token=...` → validates hash + expiry, sets new password, clears the token
4. Links expire after 1 hour and are single-use
5. The forgot-password endpoint always returns the same message regardless of whether the email exists (prevents user enumeration)

---

## Security Overview

See **[SECURITY.md](SECURITY.md)** for the full security architecture.

Key controls at a glance:
- HttpOnly JWT cookie (no JS access), `Secure` in production, `SameSite=Lax`
- 7-day token TTL
- `helmet` security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.) on every response
- JSON/form request bodies capped at 1 MB (file uploads are handled separately by Multer with their own limits)
- Rate limiting on login, password reset, public registration, and vote endpoints
- RBAC: every protected route checks role AND/OR named permission; superuser has wildcard `['*']`
- `mustChangePassword` flag blocks all routes except change-password on first login
- Passwords hashed with bcrypt (cost factor 10)
- Upload MIME validation (filenames never trusted)
- Dashboard HTML pages return 404 for unauthenticated requests
- Audit log records all material actions, including settings/integration credential changes
