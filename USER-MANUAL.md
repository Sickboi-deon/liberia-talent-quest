# Staff User Manual — Liberia Talent Quest

This guide covers the full workflow for every staff role, including complete coverage of group entry handling. Read the section that matches your role. For permission details see [ROLES.md](ROLES.md).

> **Important:** Contestants are NEVER given login accounts — not even winners, champions, or group members. Only staff (the 9 roles below) can log in.

---

## Table of Contents

1. [Getting Started — All Roles](#getting-started--all-roles)
2. [Superuser](#superuser)
3. [Admin](#admin)
4. [Contestant Manager](#contestant-manager)
5. [Finance Manager](#finance-manager)
6. [Head Judge](#head-judge)
7. [Judge](#judge)
8. [Content Manager](#content-manager)
9. [Media Coordinator](#media-coordinator)
10. [Communications Manager](#communications-manager)
11. [Public Workflows](#public-workflows)
12. [Reference: Contestant Statuses](#reference-contestant-statuses)
13. [Reference: Competition Flow](#reference-competition-flow)
14. [Reference: Site Settings](#reference-site-settings)

---

## Getting Started — All Roles

### Logging In

1. Go to `/login.html`
2. Enter your email and password
3. On first login, you will be redirected to the Change Password page immediately — you cannot access anything else until you set a new password

### Forgotten Password

1. Click **Forgot your password?** on the login page
2. Enter your email — a reset link will be sent (link expires in 1 hour)
3. Click the link in the email to set a new password

### Navigation

Each role has its own dashboard. The sidebar shows only the sections relevant to your role. The header shows your name and a logout button.

---

## Superuser

The Superuser has full control over everything — settings, seasons, competition flow, accounts, and all content.

### Initial Setup After Deployment

1. **Change the default password** — you are forced to on first login
2. **Site Settings → General** — set the competition name, contact email, phone, and social media links
3. **Site Settings → Competition** — configure scoring thresholds and registration settings
4. **Site Settings → Maximum group members** — set the max number of members per group entry (default: 6, range: 2–50)
5. **Seasons** — verify the current season is marked active (or create a new one)
6. **Categories** — verify all 6 categories are active: Dancing, Singing, Rapping, Comedy, Creative Arts, Spoken Words. Deactivating a category only hides it from the public registration form — it stays in the management table (marked "No") and can be reactivated any time; it is never deleted.
7. **Scoring Criteria** — set up audition and live performance scoring criteria
8. **Notification Channels** — configure SMTP email and/or WhatsApp credentials
9. **Media Storage** — optional: configure Cloudinary if deploying to a host that rebuilds a
   fresh server on every deploy (Render, Railway, etc.) — otherwise uploaded photos/videos won't
   survive a redeploy. Safe to skip entirely; uploads use local disk automatically until you do.
10. **Accounts** — create staff accounts for all team members

### Managing Staff Accounts

1. Go to **Accounts → Create Account**
2. Fill in name, email, and role
3. A temporary random password is generated — it is emailed to the new user if SMTP is configured, or printed to the server console otherwise
4. The new user must change their password on first login
5. To deactivate an account: click the account → **Deactivate** — the user will no longer be able to log in, but their history is preserved

### Site Settings Explained

| Setting | What it does |
|---|---|
| Registration open | Opens/closes the public `/register.html` form |
| Voting open | Opens/closes the public `/vote.html` form |
| Audition video required | ON = score-based qualification; OFF = auto-qualify all verified payments |
| Qualify threshold | Minimum average judge score to qualify (score-based mode) |
| Waiting list threshold | Minimum average score for waiting list (score-based mode) |
| Minimum judges per contestant | How many judges must score before the system decides status |
| Contestants advanced per round | Default capacity when creating a new round |
| Judge score weight | Fraction of combined round score from judges (e.g. 0.70) |
| Vote weight | Fraction of combined round score from public votes (e.g. 0.30) |
| Next live show date | Controls the homepage countdown timer |
| Maximum group members | Maximum members per group registration |
| Contact phone/email/WhatsApp | Shown on public pages and in email footers |
| Social media links | Shown as icons in the site footer (10 platforms supported) |
| Payment instructions | Shown to applicants immediately after registration |
| Audience reach | "Audience Reach" stat on the public Sponsors page — update manually as your real reach grows |
| Media mentions | "Media Mentions" stat on the public Sponsors page — update manually |

> Judge weight + Vote weight must sum to 1.0 (e.g. 0.70 + 0.30, or 1.0 + 0.0 for judge-only).

### Seasons

- Only one season can be **current** at a time
- Creating and activating a new season archives the previous one automatically
- All contestants, rounds, votes, scores, and notifications are linked to a specific season
- The public site always shows the current season's data (with fallback to the previous season if the current one has no leaderboard data yet)

### Running Qualification

1. Finance Manager must have verified payments first (contestants move to `registered`)
2. In score-based mode: Judges must score audition videos
3. Go to **Qualification → Run Qualification**
4. Review the preview (which contestants would qualify at current thresholds)
5. Click **Confirm & Run** to apply statuses in bulk

**Auto-qualify mode** (when "Audition video required" is OFF):
- All `registered` contestants with verified payment are auto-qualified in payment order (first come, first served)
- No judge scoring required

**Score-based mode** (when "Audition video required" is ON):
- Contestants with average score ≥ qualify threshold → `qualified`
- Contestants with average score ≥ waiting list threshold → `waiting_list`
- Contestants below waiting list threshold → `rejected`

### Round Advance

This is **one overall competition** — every contestant competes against everyone else,
regardless of talent category. Category is a descriptive label on each entry, not a bracket.

1. Go to **Rounds** → select the current open round
2. Click **Close & Advance**
3. The system calculates combined scores: `(judge weight × normalised judge score) + (vote weight × normalised votes)`
   - Scores are normalised **across all contestants** in the round — not per category
4. Top **Capacity** contestants overall advance to the next round (status stays `qualified`)
5. Next 3 overall (positions Capacity+1, Capacity+2, Capacity+3) go to `waiting_list`, in a single
   overall queue
6. Everyone else → `eliminated`
7. Contestants with no performance submission → `eliminated` (no-show)

### Finale

Triggered automatically when there is no next round. Placements are overall — one Champion for
the whole season, not one per category:
- Rank 1 overall → `winner`
- Rank 2 overall → `runner_up`
- Rank 3 overall → `second_runner_up`
- Rank 4 overall → `finalist`
- Everyone else → `eliminated`

### Manual Status Override

Go to **Qualification → Manual Status Override**. Use this sparingly — only for exceptional cases where an automated step produced an incorrect status. Every override is recorded in the Audit Log.

> Note: To set a contestant to `winner`, `runner_up`, `second_runner_up`, or `finalist` manually, use the Override table — these statuses are normally assigned only by the Finale trigger.

### Data Export & Purge

Under **Data Management**:
- **Export** → downloads contestant data, scores, votes, or notifications as CSV
- **Purge** → permanently deletes old records (type `CONFIRM DELETE` to proceed)
  - Always export before purging
  - Purge options: rejected contestants, old notification history, unused voting codes, old audit log entries

### Audit Log

View a full log of all staff actions — logins, payment verifications, status changes, qualification runs, round advances, notifications, and more. The log is read-only. The Superuser's own actions are also included.

---

## Admin

The Admin has broad oversight and manages content, but cannot change competition settings or trigger competition flow steps.

### What Admins can do

- View all contestant applications (solo and group, all statuses, all payment details visible)
- View all staff accounts
- Manage announcements, schedule, sponsors, sponsor page content, team profiles
- Upload/remove the sponsorship proposal PDF
- View the audit log (read-only)
- View aggregate stats

### What Admins cannot do

- Create or edit staff accounts
- Change site settings or scoring thresholds
- Trigger qualification, round advance, or finale
- Verify payments or manage voting codes
- Delete contestants or override statuses

### Managing Announcements

1. **Announcements → New Announcement**
2. Fill in title, body, and optional link
3. Set **Pinned** if it should appear at the top of the public announcements list
4. Click **Publish**

### Managing Sponsors

1. **Sponsors → Add Sponsor**
2. Upload a logo, enter name, tier (gold/silver/bronze/custom), and website URL
3. Sponsors appear on the public `/sponsors.html` page

### Uploading the Sponsorship Proposal

Go to **Sponsors → Proposal PDF** → upload a PDF. A "Download Proposal" button appears on the public sponsors page.

---

## Contestant Manager

Manages qualified contestants through the competition. Sees contestants only after they reach `qualified` status or later — the payment and application intake phase is handled by Finance Manager.

### Viewing Contestants

The queue shows contestants in these statuses: `qualified`, `waiting_list`, `eliminated`, `winner`, `runner_up`, `second_runner_up`, `finalist`.

**Group contestants** appear with a blue **Group** badge and a member count. A panel below the contestant's details shows all group member names.

### Editing Contestant Details

1. Click a contestant in the queue
2. Click **Edit Details**
3. You can update: name, stage name, county, category, bio, talent description, and judge notes
4. Click **Save**

> Note: You cannot see or edit payment details — that is Finance Manager territory.

### Group Contestants — What to Expect

- Groups have no gender or date of birth on the main contestant row (these belong to individuals, not the group)
- The detail panel shows "Type: Group entry" instead of a gender field
- The Members panel shows all member names (and birth year if provided at registration)
- All other fields (status, category, county, scores, votes) work identically to solo contestants

### Uploading a Profile Photo

1. Open the contestant's detail panel
2. Click **Upload photo** → select an image
3. The photo appears immediately on the contestant's public profile page

---

## Finance Manager

Controls the money side: payment verification and voting code lifecycle.

### Verifying Payments

1. The queue shows all `pending_payment` contestants (solo and group)
2. Group contestants are shown with a blue **Group** badge and member count
3. Locate the payment reference, confirm it matches records (mobile money, Orange Money, cash receipt)
4. Click **Verify Payment** → contestant moves to `registered`
5. An email is sent to the contestant confirming payment

> Groups and solos use the same payment flow — there is no per-member fee distinction in the system (the organizer sets the group fee externally).

### Generating Voting Codes

1. Go to **Voting Codes → Generate**
2. Enter quantity (up to 500 per batch), optional round, and payment method
3. Click **Generate**
4. Click **Export CSV** to download the codes for distribution
5. Deactivate unused codes if needed (e.g. a batch was distributed in error)

### Accounting

The **Accounting** tab shows all revenue entries automatically created when voting codes are used. Each entry shows the code, the amount, and which round/season it belongs to.

---

## Head Judge

Oversees the judging panel and has final authority over scores.

### Overriding a Judge Score

1. Go to **Scores** → find the contestant
2. Expand the score panel → click the judge score you want to change
3. Click **Override** → enter the corrected score with a reason
4. Click **Save** — the judge is notified and the override is logged

### Deleting a Judge Score

On the score panel, click **Delete** next to a score to remove it entirely. The judge can then re-score that contestant.

### Running Qualification

The Head Judge shares this authority with the Superuser:
1. Go to **Qualification**
2. Click **Preview** to see who would qualify at current thresholds without making any changes
3. Click **Run Qualification** to apply statuses

### Viewing Round Standings

Go to **Rounds → [Round name] → Standings** to see the current combined score ranking — one overall list, not one per category.

### Group Contestants

Groups appear in the judge queue with a **Group** badge. There is no gender displayed (groups have no individual gender). Scoring is identical — one score per group, per judge, using the same criteria.

---

## Judge

Reviews audition videos and scores live performances.

### Scoring an Audition

1. Go to **My Queue** — shows registered contestants with audition videos that you haven't scored yet
2. Click a contestant to open the scoring panel
3. Watch the audition video
4. Fill in each scoring criterion (as configured by the Superuser)
5. Click **Submit Score** — **scores are locked immediately and cannot be edited**
6. If you made a mistake, contact the Head Judge to override

### Group Contestants in Your Queue

- Groups appear with a blue **Group** badge
- No gender is shown (groups have no individual gender)
- Score the group as a single performing unit — one set of scores per group

### Scoring Live Performances

1. Go to **Performances → [Round name]**
2. Find the contestant's performance
3. Fill in the live performance criteria and submit

---

## Content Manager

Manages the editorial content shown on the public site.

### Announcements

1. **Announcements → New Announcement**
2. Fill in title, body text, and an optional external link
3. Toggle **Pinned** to keep it at the top of the list
4. Click **Publish** — it appears immediately on the public `/contact.html` page

### Schedule

1. **Schedule → Add Event**
2. Fill in event name, date/time, venue, and description
3. Click **Save** — it appears on the public schedule

### Team Profiles

1. **Team → Add Profile**
2. Enter name, role, and bio; upload a headshot photo
3. Profiles appear on the public `/about.html` page

> Note: Sponsors are managed by Admin / Superuser, not Content Manager.

---

## Media Coordinator

Manages visual and video media for the platform.

### Uploading Contestant Photos

1. Go to **Contestant Media → [Search for contestant]**
2. Click **Upload Photo**
3. Choose a category (headshot, performance, behind-the-scenes)
4. Toggle **Set as primary photo** to make it the photo shown on the public gallery and profile page
5. Click **Upload**

**Groups and solos use the same upload flow.** Media is linked to a contestant record by ID, so group contestants support exactly the same photo and video uploads as solos.

### Uploading Contestant Videos

Same flow as photos. Video categories: audition, performance, promotional, other.

### Uploading Event Photos

1. Go to **Event Photos → Upload**
2. Select one or more photos/videos from the event
3. Add a title and description
4. Click **Upload** — they appear in the public gallery under the Events section

### Deleting Media

Click the **×** button on any media item to delete it. This removes both the database record and the file from disk.

---

## Communications Manager

Sends notifications to contestants via email and/or WhatsApp.

### Sending a Notification

1. Go to **Notifications → Send**
2. **Type** — select the notification type (e.g. Rehearsal Notice, Qualification Notice)
3. **Recipients** — select who receives it:
   - `all` — all contestants with known email in the current season
   - `qualified` — qualified contestants only
   - `waiting_list` — waiting list contestants
   - `registered` — payment-verified contestants awaiting audition
   - `eliminated` — eliminated contestants
   - `winner` / `runner_up` / `second_runner_up` / `finalist` — placement-specific
   - `individual` — a specific contestant (enter their name)
4. **Subject** and **Message** — compose the notification
5. Use `[Contestant Name]` in the message body — it will be replaced with each recipient's real name
6. Click **Send** — the system sends via email and WhatsApp (if both channels are configured) with a short delay between messages to stay within rate limits

### Notification History

The **History** tab shows all sent notifications, when they were sent, how many were delivered, and who sent them.

### Channel Status

The status panel shows whether Email and WhatsApp are currently configured. If a channel shows as inactive, ask the Superuser to configure credentials under **Notification Channels**.

---

## Public Workflows

These are workflows experienced by the public visiting the site — not staff.

### Registration (Public)

1. Public visitor goes to `/register.html`
2. Chooses **Solo** or **Group** entry
   - **Solo:** fills in name, stage name, email, phone, county, category, gender, date of birth, bio, talent description, uploads a photo and optionally an audition video
   - **Group:** fills in group name, group email, county, category, uploads a group photo. Then adds each member (name, optional DOB and phone). Minimum 2 members, maximum set by the Superuser (default 6)
3. After submit → status is `pending_payment`
4. A registration confirmation email is sent with payment instructions

### Public Voting

1. Visitor goes to `/vote.html`
2. Enters their 10-character voting code
3. Selects a contestant from the list
4. Clicks **Vote** — the code is marked as used and cannot be used again
5. The leaderboard updates in real time

### Viewing Results

- `/index.html` — once the finale is triggered, the homepage shows only the season Champion, with a link to the full leaderboard for Runner-Up / 2nd Runner-Up / Finalist
- `/leaderboard.html` — live vote leaderboard, one overall ranking; category tabs filter the view but always show true overall rank; switches to Final Results view after the finale is triggered
- `/gallery.html` — photo gallery of contestants and event photos; group contestants show a **Group** badge
- `/contestant-profile.html?id=...` — public profile for a single contestant; group contestants show a Group Members panel

---

## Reference: Contestant Statuses

| Status | Meaning |
|---|---|
| `pending_payment` | Applied; waiting for Finance Manager to verify payment |
| `registered` | Payment verified; in the audition review / scoring queue |
| `qualified` | Passed qualification — active in the competition |
| `waiting_list` | Did not qualify outright; may be promoted if a spot opens |
| `rejected` | Did not pass qualification |
| `eliminated` | Was in the competition but eliminated during a round |
| `winner` | Overall Champion of the season — 1st place, not one per category |
| `runner_up` | 2nd place overall |
| `second_runner_up` | 3rd place overall |
| `finalist` | 4th place overall (reached the finale) |

---

## Reference: Competition Flow

```
Public registers (solo or group)
  ↓
pending_payment
  ↓ Finance Manager verifies payment
registered
  ↓ Judge scores submitted (score-based mode)
    OR
  ↓ Superuser triggers auto-qualify (no-video mode)
qualified  |  waiting_list  |  rejected
  ↓
[Competition rounds: performances → judge scores + public votes]
  ↓ Head Judge / Superuser triggers Round Advance
  ↓ (repeat for each round)
  ↓ Finale triggered (last round advances to finale)
winner | runner_up | second_runner_up | finalist  (overall — one competition, not one per category)
remaining qualified contestants → eliminated
```

**Waiting list promotion:** If a `qualified` contestant is eliminated or disqualified, the top `waiting_list` contestant overall — from a single season-wide waiting list, not one per category — is automatically promoted to `qualified`.

---

## Reference: Competition Scoring

**Combined score formula:**
```
combinedScore = (judgeWeight × normalisedJudgeScore) + (voteWeight × normalisedVotes)
```

- Scores are normalised **across all contestants in the round** — not per category. A contestant in Dancing is ranked against every other contestant in the round, regardless of category.
- `judgeWeight` and `voteWeight` are set in Site Settings and must sum to 1.0.
- Judge scores are averaged across all judges who have scored that contestant.

**Audition scoring (score-based qualification only):**
- Each judge submits a score once using the Audition Scoring Criteria
- Average of all submitted scores is compared to the qualify and waiting list thresholds
- Once a judge submits their score, it is locked — contact the Head Judge for corrections

**Live performance scoring:**
- Each judge scores each performance once, using the Live Performance Scoring Criteria
- These scores combine with public votes to determine round standings

---

## Reference: Group Entry Notes for All Roles

| Feature | Solo | Group |
|---|---|---|
| Gender field | Required at registration | Not applicable — not collected |
| Date of birth | Required at registration | Not applicable — not collected |
| Member names | N/A | Required (min 2, max per setting) |
| Login account | None (contestants never get logins) | None |
| Votes | One tally for the solo contestant | One tally for the entire group |
| Score | One score per judge | One score per judge (score the group as a unit) |
| Status | One status for the contestant | One status for the entire group |
| Photos/Videos | Uploaded to the contestant record | Uploaded to the group's contestant record |
| Gallery | Appears with no badge | Appears with a **Group** badge and member count |
