# Roles & Permissions — Liberia Talent Quest

The platform uses JWT-based role access control with named permission grants as a
supplementary mechanism. There are 9 staff roles.

> **Contestants are NOT users.** They never receive login accounts — not even
> winners, champions, group members, or runners-up. The login route explicitly
> rejects any account with `role = 'contestant'`.

---

## Role Overview

| Role | DB value | Dashboard |
|---|---|---|
| Superuser | `superuser` | `dashboard-superuser.html` |
| Admin | `admin` | `dashboard-admin.html` |
| Contestant Manager | `contestant_manager` | `dashboard-contestant-manager.html` |
| Finance Manager | `finance_manager` | `dashboard-finance-manager.html` |
| Head Judge | `head_judge` | `dashboard-head-judge.html` |
| Judge | `judge` | `dashboard-judge.html` |
| Content Manager | `content_manager` | `dashboard-content-manager.html` |
| Media Coordinator | `media_coordinator` | `dashboard-media-coordinator.html` |
| Communications Manager | `communications_manager` | `dashboard-communications-manager.html` |

---

## Superuser

**Permissions token:** `['*']` — bypasses every RBAC check.

The Superuser is the single account that controls everything. There should only be one.
The Superuser dashboard (`dashboard-superuser.html`) has full UI feature parity with every
other role's dashboard — Superuser is never limited to backend API access without a matching
UI. In addition to everything below, its sidebar also includes: **Contestant Media** (Media
Coordinator's per-contestant photo/video uploads), **Audition Videos** and **Score Live
Rounds** (Judge's scoring queues), **Voting Codes**, and **Accounting** (Finance Manager's
revenue ledger). The Superuser is also the only role that can grant or revoke named
permissions for every other staff account (see **Granting Permissions** below).

### Exclusive capabilities (no other role can do these)
- Create, edit, and deactivate any staff account
- Change site settings:
  - Registration open/close
  - Voting open/close
  - Audition video required (score-based vs auto-qualify mode)
  - Scoring thresholds (qualify, waitlist, judge weight, vote weight)
  - Maximum group members per registration
  - Contact information and social media links (10 platforms: Facebook, Instagram, TikTok, X, YouTube, LinkedIn, Pinterest, Snapchat, Reddit, Discord)
  - Payment instructions shown to applicants
- Run and configure seasons (create, activate, close)
- Trigger the qualification run
- Trigger round advance (move the top-N contestants overall to the next round — one competition, not one per category)
- Trigger the finale (assign one overall Champion / Runner Up / Second Runner Up / Finalist, across every category)
- Manual status override for any contestant to any status
- Manage scoring criteria (audition + live performance)
- Manage categories
- Manage notification channels (SMTP / WhatsApp credentials)
- View the full audit log
- Export and purge data (contestants, scores, votes, notifications)

### Shared with Admin
- Manage announcements, schedule, sponsors, sponsor page content, team profiles
- Upload proposal PDF
- View all applications and contestant queue (solo and group)
- Send notifications to contestants

---

## Admin

Read-heavy oversight role. Can manage content but cannot change competition settings
or trigger competition flow steps.

### Can do
- View all contestant applications and their full details (solo and group, all statuses)
- View all staff accounts
- Manage announcements, schedule, sponsors, sponsor page content, team profiles
- Upload/remove the sponsorship proposal PDF
- View audit log (read-only)
- View aggregate stats

### Cannot do
- Create or edit staff accounts
- Change site settings or scoring thresholds
- Trigger qualification, round advance, or finale
- Verify payments or manage voting codes
- Delete contestants or override statuses

---

## Contestant Manager

Focused on the competition side of qualified contestants — both solo and group.

### Can do
- View contestants in `qualified`, `waiting_list`, `eliminated`, `winner`, `runner_up`, `second_runner_up`, and `finalist` statuses
- See Group badge and member list for group contestants
- Edit contestant details (name, bio, county, category, judge notes) — `manage_contestants` permission
- View round standings and performances

### Cannot do
- View `pending_payment` or `registered` applicants (payment is Finance territory)
- See payment details (method, reference, amounts)
- Verify payments
- Trigger qualification or round advance
- Access accounting

---

## Finance Manager

Owns the payment verification and voting-code lifecycle.

### Can do
- View all contestant applications with payment details (solo and group, all statuses)
- See Group badge and member count in payment queue
- Verify registration payments (`verify_payments` permission) — moves contestant from `pending_payment` to `registered`
- Generate, list, export, and deactivate voting codes (`manage_voting_codes` permission)
- View accounting entries and revenue reports

### Cannot do
- Edit contestant details
- Trigger qualification or round advance
- Manage staff accounts
- Change site settings

---

## Head Judge

Oversees the judging panel and has authority over the scoring-based competition flow.

### Can do
- View all registered contestants pending audition scoring (solo and group)
- View all audition scores across all judges
- Override or delete another judge's audition score
- Preview qualification results (which contestants would qualify at current thresholds) — without committing
- Trigger the qualification run (shared with Superuser)
- View round standings
- Score live performances

### Cannot do
- Create staff accounts
- Change site settings or scoring weights
- Trigger round advance or finale (Superuser-only)
- Manage voting codes or verify payments

---

## Judge

Reviews audition submissions and scores live performances.

### Can do
- View their contestant queue (registered contestants with audition videos)
- See Group badge on group contestants (gender is not shown — groups have no individual gender)
- Submit audition scores (validated against active Audition Scoring Criteria)
  - **Scores are locked immediately on submission** — a judge cannot edit their own score
- Score live performances (for rounds they are assigned to)
- View their own submitted scores

### Cannot do
- See other judges' scores (except via the Head Judge's aggregated view)
- Edit or delete any submitted score
- Approve or reject contestants
- Trigger any competition flow step

---

## Content Manager

Manages the editorial content shown on the public site.

### Can do
- Create, edit, and delete announcements (`manage_announcements` permission)
- Create, edit, and delete schedule entries (`manage_schedule` permission)
- Manage team profiles (bios shown on the About page)

### Cannot do
- Manage sponsors (that is Admin / Superuser)
- Manage contestants
- Trigger any competition flow

---

## Media Coordinator

Manages visual media assets — for both solo and group contestants.

### Can do
- Upload event photos and videos (shown in the gallery)
- Upload and manage contestant media (additional photos and videos for a contestant's profile page)
  - Works for both solo and group contestants equally — media is linked by contestant ID
- Delete media they uploaded

### Cannot do
- Edit contestant details beyond the media
- Manage other content types

---

## Communications Manager

Handles outbound communication to contestants.

### Can do
- Send email and/or WhatsApp notifications to contestant groups or individual contestants
- Filter recipients by status (all, qualified, waiting list, registered, etc.)
- View notification history and delivery stats

### Cannot do
- Manage contestants or content
- Access competition flow controls

---

## RBAC Implementation

### Backend: `requireAuth(allowedRoles, requiredPermission)`

```javascript
// Allow only superuser and finance_manager by role:
requireAuth(['superuser', 'finance_manager'])

// Allow superuser + anyone with the named permission:
requireAuth(['superuser', 'contestant_manager'], 'manage_contestants')

// Allow any authenticated staff member:
requireAuth()
```

- `allowedRoles` — array of role strings. A user matches if their role is in the list.
- `requiredPermission` — a named permission stored in `users.permissions` (JSONB array). User matches if the array contains the key.
- **Superuser** always passes (permissions array is `['*']`).
- Both checks are OR'd: a user passes if they match the role list **or** have the named permission.
- `mustChangePassword` flag: blocks all routes except `/api/auth/change-password` until changed.

### Frontend: `guardRole(allowedRoles)` in `app.js`

Each dashboard page calls `guardRole(['role1','role2'])` at script start. If the stored
JWT role is not in the allowed list, the user is redirected to `login.html`. This is a
UX convenience only — all security is enforced server-side via `requireAuth`.

### Named Permissions (stored in `users.permissions`)

| Permission key | Grants access to |
|---|---|
| `manage_contestants` | Edit contestant details (Contestant Manager + any user granted this) |
| `verify_payments` | Verify registration payments (Finance Manager) |
| `manage_voting_codes` | Generate/manage voting codes (Finance Manager) |
| `manage_announcements` | Create/edit/delete announcements (Content Manager) |
| `manage_schedule` | Create/edit/delete schedule entries (Content Manager) |
| `manage_media` | Upload event photos and contestant media (Media Coordinator) |
| `manage_categories` | Create/edit/delete talent categories (superuser-only by default) |
| `manage_rounds` | Create/edit/delete rounds — does **not** include triggering round advance, which stays superuser-only |
| `run_qualification` | Trigger the qualification run (Head Judge can already *preview* results without this; this grants running it) |

Granting `manage_users` lets a non-superuser create, list, and delete staff accounts, but three
actions remain exclusively Superuser regardless of this permission: creating a new Superuser
account, deleting a Superuser account, and resetting a Superuser's password. This prevents a
granted permission from ever being used to mint or hijack a second all-access account.

### Granting Permissions

Only the **Superuser** can grant or revoke named permissions, via `PUT /api/users/:id/permissions`
(Superuser dashboard → Accounts → **Permissions** button on any non-superuser account). A staff
member cannot edit their own permissions, and the Superuser account's own permissions cannot be
edited (it is already `['*']`). Every grant/revoke is written to `permission_audit_log` with who
changed what and when, visible under Superuser → Permission Audit Log.

---

## Dashboard Access Guard Reference

| Dashboard | Allowed roles |
|---|---|
| `dashboard-superuser.html` | `superuser` |
| `dashboard-admin.html` | `superuser`, `admin` |
| `dashboard-contestant-manager.html` | `superuser`, `admin`, `contestant_manager` |
| `dashboard-finance-manager.html` | `superuser`, `finance_manager` |
| `dashboard-head-judge.html` | `superuser`, `head_judge` |
| `dashboard-judge.html` | `superuser`, `judge` |
| `dashboard-content-manager.html` | `superuser`, `content_manager` |
| `dashboard-media-coordinator.html` | `superuser`, `media_coordinator` |
| `dashboard-communications-manager.html` | `superuser`, `admin`, `communications_manager` |
| `change-password.html` | Any authenticated user (forced on first login) |

All dashboard pages return **404** to unauthenticated requests at the Express middleware
level — they are never served to public visitors.

---

## Staff Account Creation Flow

1. Only the **Superuser** can create and manage staff accounts.
2. New accounts are created with a temporary random password and `must_change_password = TRUE`.
3. If SMTP is configured, the temporary password is emailed to the new user. Otherwise it is shown in the server console.
4. On first login the user is redirected to `change-password.html` and cannot access any other route until they set a permanent password.
5. Staff accounts can be deactivated (not deleted) by the Superuser — deactivated accounts cannot log in but their audit history is preserved.
