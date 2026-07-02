# Changelog

## Competition model change: overall, not per-category — 2026-07-01 (later same day)

The competition previously treated each talent category (Dancing, Singing, Rapping, Comedy,
Creative Arts, Spoken Words) as its own separate bracket — contestants only competed against
others in their own category at every stage, and each category crowned its own Champion /
Runner-Up / Second Runner-Up / Finalist. This was wrong: it's meant to be **one overall
competition** — every contestant competes against everyone else regardless of category, at
every stage (round advancement, waitlist, and the Grand Finale). Category is now purely a
descriptive label on each contestant's entry, never a competitive bracket.

Qualification was already category-agnostic (flat score thresholds per contestant) and needed
no change. Changed everywhere else category-scoping lived:

- **`routes/rounds.routes.js`** — `computeStandings()` no longer computes a per-category
  ranking (`byCategory`); the single flat `standings` ranking (already existed, used for
  display) is now the only ranking used for advance/waitlist/cut decisions and finale
  placements. `POST /:id/advance`'s normal-advance and finale-mode logic both rewritten from
  per-category loops to one pass over the flat, overall-ranked list.
- **`routes/contestants.routes.js`** — `GET /placements` flattened from one entry per category
  (each with its own 4 placements) to a single `{ placements: [...] }` with 4 entries total for
  the whole season. The waitlist auto-fill (when a contestant is manually eliminated/rejected)
  no longer restricts promotion to the same category — it promotes whoever is next on the
  single overall waitlist queue.
- **`routes/votes.routes.js`** — fixed a related bug this surfaced: the public leaderboard
  applied the `?category=` filter *before* assigning rank, so a category-filtered view
  incorrectly re-numbered from #1 instead of showing each contestant's true overall position.
  Rank is now computed across the full field first, then filtered for display.
- **Frontend** (`leaderboard.html`, `index.html`, `dashboard-superuser.html`) — all three
  updated to render one overall podium/table instead of one per category. Also fixed a related
  bug in `leaderboard.html`'s podium/grid renderers: they computed the displayed rank number
  from array position instead of the API's true `rank` field, which would have kept showing
  "#1, #2, #3..." within a category filter even after the backend fix.
- Category filter tabs stay on the public leaderboard as a browsing convenience (confirmed with
  the user) — filtering to a category narrows the list but never changes the rank numbers shown.
- Regenerated the demo Grand Final data through the real API (reset the 24 previously-placed
  contestants back to `qualified`, re-ran the finale advance) so the stored result is one
  genuine overall Champion/Runner-Up/Second Runner-Up/Finalist rather than the old six
  per-category sets.

## Permissions expansion — 2026-07-01 (later same day)

Added three new grantable permissions and fixed one that didn't do what its name promised:

- **`run_qualification`** — lets a non-superuser (e.g. Head Judge) trigger the qualification
  run itself; previously only *previewing* results was delegable.
- **`manage_categories`** and **`manage_rounds`** — talent-category and round CRUD were
  hardcoded `superuser`-only with no permission escape hatch. `manage_rounds` deliberately
  excludes triggering round advance, which stays superuser-only (it's a semi-irreversible
  competition-flow action, not routine CRUD).
- **Fixed `manage_users`** — it already existed and gated the staff list, but creating and
  deleting accounts were still hardcoded `superuser`-only, so granting it didn't do what its
  name implied. Extended it to cover create/delete, but added an explicit guard so a
  `manage_users` holder can never create a new Superuser account, delete the Superuser
  account, or reset the Superuser's password — closing off what would otherwise be a
  privilege-escalation path (also closed the same gap on the existing password-reset
  endpoint, which had it even before this change). Verified all of this live: a permission
  holder can create/manage ordinary staff accounts but every Superuser-targeting action
  correctly returns 403, and the real Superuser account is provably untouched afterward.

## Feature follow-up — 2026-07-01 (later same day)

Three specific gaps raised after the production-readiness pass below.

- **Public contestant ID now assigned at registration, not qualification.** Every new
  applicant (solo or group) gets a permanent `LTQ-S{season}-{number}` ID the moment they
  submit the form, numbered in registration order, inside a per-season advisory-locked
  transaction to prevent collisions under concurrent public submissions
  (`routes/contestants.routes.js` POST `/`). Rewrote `db/migrate-contestant-numbers.js`
  (its old logic wiped and reassigned numbers by admission order only, which would have
  conflicted with the new scheme) into a one-time backfill for any pre-existing contestant
  that doesn't have a number yet. Ran it: all 17 existing contestants (across every status,
  including `pending_payment` and `rejected`) now have an ID with zero collisions. No frontend
  changes were needed — every dashboard table and public page already rendered `competitionId`
  conditionally; it was just never populated this early before.
- **Superuser dashboard now has full feature parity with every other role.** Backend RBAC
  already let Superuser call every endpoint, but the dashboard UI itself was missing four
  sections that only existed on other roles' dashboards. Ported, verified live with real data,
  and namespaced to avoid ID/function collisions in the (5,600+ line) shared script:
  **Contestant Media** (photo/video upload per contestant, from Media Coordinator), **Audition
  Videos** and **Score Live Rounds** (judging queues, from Judge), **Voting Codes**, and
  **Accounting** (from Finance Manager). Also documented in `ROLES.md` that only Superuser can
  grant/revoke other staff members' permissions (this was already true in the backend — added
  the missing "Granting Permissions" doc section).
- **Sponsors page PDF download** — investigated and confirmed this was already fully built
  (public download section, Superuser upload UI, backend endpoints) in a prior pass. It wasn't
  showing because no PDF had ever actually been uploaded. Verified the entire upload → public
  display → download flow end-to-end with a real file; no code change was needed.

## Production-readiness pass — 2026-07-01

Full-stack audit and fix pass across frontend, backend, and database, focused on closing real
bugs and gaps rather than cosmetic changes. Every item below was verified against the running
app (live DB queries, a running server, and browser checks), not just read from source.

### Fixed — user-reported issues

- **Group registration form felt endlessly long.** The two-column layout was already in place,
  but the Group Members list was nested inside the half-width left column, forcing member cards
  to stack one-per-row. Moved the Group Members section to span the full form width and laid the
  member cards out in a responsive 2-column grid (1 column on mobile) — roughly halves the
  vertical height for a 4+ member group. See `public/register.html`, `public/style.css`.
- **Password show/hide toggle.** Already implemented on `login.html`, `reset-password.html`, and
  `change-password.html` in a prior pass — verified working end-to-end in a live browser session.

### Fixed — active bugs found during the audit

These were breaking real requests before this pass, independent of the UX work above:

- `GET /api/contestants/:id` referenced `contestant_number`, a column that did not exist in
  `schema.sql` (only in a separate, never-run migration script) — every staff "view contestant"
  request threw a 500.
- `GET /api/event-photos` referenced `media_type`, and the upload path also needs `season_id` —
  neither existed in `schema.sql` — every request to the public Gallery's event-photos section
  and the Media Coordinator dashboard threw a 500.
- `sponsor_testimonials`, `sponsor_benefits`, `sponsor_tiers` tables were only ever created by a
  standalone script (`add-sponsor-content.js`), never by `schema.sql` — a fresh `db:init` install
  was missing them entirely, breaking the sponsors page content management routes.
- Settings' 8 extra social-media columns (`tiktok`, `twitter`, `youtube`, `linkedin`, `pinterest`,
  `snapchat`, `reddit`, `discord`) were only ever added by a standalone migration script — on this
  DB they had never been applied, so `GET /api/settings` 500'd.
- A legacy data issue predating this pass — 8 contestants assigned to categories
  (`singing-rapping`, `spoken-word`) that no longer exist in the current 6-category list — was
  blocking `db/init.js`'s category cleanup step from ever completing on this database. Remapped
  via the existing `migrate-categories.js` and made `init.js`'s cleanup query defensive going
  forward (only deletes a legacy category if no contestant still references it).

`schema.sql` is now genuinely the single source of truth: every table/column/constraint the
routes depend on is declared there, idempotently, and running `node db/init.js` against an
existing older database now brings it fully up to date rather than silently no-op'ing.

### Backend security

- Added `helmet` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) to every response.
- Capped JSON/form request bodies at 1 MB (file uploads are unaffected — Multer handles those
  with its own per-type limits).
- Added a rate limiter to the public, unauthenticated `POST /api/contestants` registration
  endpoint (8 requests / 15 min per IP) — previously unlimited.
- Replaced a string-interpolated (though hardcoded-value) SQL fragment in
  `contestants.routes.js` with a parameterized query.
- Fixed a raw Postgres error leak: deleting a staff user who has associated records (e.g. a judge
  with submitted scores) now returns a friendly 409 instead of a 500 with a raw constraint-
  violation message.
- Added the `manage_content` permission requirement to `team-profiles.routes.js`'s write routes,
  matching every other content-management route (sponsors, announcements, schedule).
- Added audit logging for site-settings updates and SMTP/WhatsApp integration credential changes
  (credential values themselves are never logged, only which fields changed).

### Database cleanup

- Removed 9 migration scripts that were 100% superseded by `schema.sql`
  (`add-notifications.js`, `add-permissions.js`, `add-integrations.js`, `add-wa-notify.js`,
  `add-contestant-media.js`, `add-round-settings.js`, `add-achievements.js` [dead/unused column],
  `migrate-social-columns.js`, `migrate-group-support.js`, `add-roles.js`).
- Simplified `add-sponsor-content.js` and `add-public-content.js` to pure seed scripts (table
  creation now lives in `schema.sql`).
- Added `--force` + `NODE_ENV=production` guardrails to `db/clear-season2.js` and `db/reset-su.js`
  (destructive scripts), and a `NODE_ENV=production` guard to every demo-data seed script.
- Added missing indexes, `ON DELETE` behavior on `votes`/`voting_codes` contestant references,
  and a `contestant_media.category` CHECK constraint that had drifted out of sync between
  `schema.sql` and its standalone migration script.

### Not changed (evaluated, decided against)

- Did **not** add `ON DELETE CASCADE` to judge-scoring foreign keys — deleting a judge who has
  submitted scores is now handled with a friendly error instead, preserving score history rather
  than silently cascading it away.
- Did **not** add rate limits to authenticated staff-only endpoints (create user, verify payment,
  submit score) — they already require a valid session, and legitimate staff workflows need to
  move quickly.
- Left `lib/db.js`'s `rejectUnauthorized: false` SSL option as-is when `DATABASE_SSL=true` — this
  is standard practice for managed Postgres providers (Render, Railway, Supabase) whose
  certificates aren't in the default Node CA trust store, not an oversight.
