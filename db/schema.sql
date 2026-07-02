-- Liberia Talent Quest — PostgreSQL Schema
-- Run once: psql -U <user> -d ltq -f db/schema.sql
-- Or via:   node db/init.js

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users (internal staff + contestant login accounts) ───────────
CREATE TABLE IF NOT EXISTS users (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   VARCHAR(255) NOT NULL,
  email                  VARCHAR(255) UNIQUE NOT NULL,
  password_hash          VARCHAR(255) NOT NULL,
  role                   VARCHAR(50)  NOT NULL CHECK (role IN (
                           'superuser','contestant_manager','finance_manager',
                           'judge','content_manager','contestant',
                           'admin','head_judge','media_coordinator','communications_manager')),
  permissions            JSONB        DEFAULT '[]',
  must_change_password   BOOLEAN      DEFAULT TRUE,
  reset_token_hash       VARCHAR(255),
  reset_token_expires_at TIMESTAMPTZ,
  contestant_id          UUID,        -- plain reference (no FK) to contestants.id
  created_at             TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Seasons (one row per competition season) ─────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  number                INT          NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  status                VARCHAR(20)  DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','archived')),
  start_date            DATE,
  end_date              DATE,
  is_current            BOOLEAN      DEFAULT FALSE,
  registration_fee_lrd  NUMERIC(12,2) DEFAULT 0,
  voting_code_price_lrd NUMERIC(12,2) DEFAULT 0,
  usd_to_lrd_rate       NUMERIC(10,2) DEFAULT 180,
  created_at            TIMESTAMPTZ  DEFAULT NOW()
);
-- Enforce at most one current season at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_number    ON seasons (number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_one_current ON seasons (is_current) WHERE is_current = TRUE;

-- ── System settings (always exactly one row, id = 1) ────────────
CREATE TABLE IF NOT EXISTS settings (
  id                    INT          PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  event_date            TIMESTAMPTZ,
  registration_open     BOOLEAN      DEFAULT FALSE,
  voting_open           BOOLEAN      DEFAULT FALSE,
  qualify_min_score     INT          DEFAULT 70,
  waitlist_min_score    INT          DEFAULT 50,
  min_judges_to_qualify INT          DEFAULT 3,
  round_advance_count   INT          DEFAULT 10,
  judge_score_weight    NUMERIC(5,4) DEFAULT 0.70,
  vote_weight           NUMERIC(5,4) DEFAULT 0.30,
  contact_phone         VARCHAR(100),
  contact_email         VARCHAR(255),
  whatsapp              VARCHAR(500),
  facebook              VARCHAR(500),
  instagram             VARCHAR(500),
  tiktok                VARCHAR(500),
  twitter               VARCHAR(500),
  youtube               VARCHAR(500),
  linkedin              VARCHAR(500),
  pinterest             VARCHAR(500),
  snapchat              VARCHAR(500),
  reddit                VARCHAR(500),
  discord               VARCHAR(500),
  smtp_user             VARCHAR(255),
  smtp_pass             TEXT,
  smtp_from             VARCHAR(255),
  wa_phone_id           VARCHAR(255),
  wa_token              TEXT,
  wa_template           VARCHAR(255) DEFAULT 'ltq_notification',
  wa_template_lang      VARCHAR(20)  DEFAULT 'en',
  payment_instructions  TEXT,
  audition_video_required BOOLEAN    DEFAULT TRUE,
  max_group_members     INT          DEFAULT 6,
  proposal_file_url     VARCHAR(500),
  updated_at            TIMESTAMPTZ  DEFAULT NOW()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Talent categories (admin-configurable) ───────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(100) UNIQUE NOT NULL,
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Audition scoring criteria (Stage 3 video review) ────────────
CREATE TABLE IF NOT EXISTS audition_criteria (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  max_score     INT          NOT NULL DEFAULT 10,
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Live performance scoring criteria ────────────────────────────
CREATE TABLE IF NOT EXISTS scoring_criteria (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  max_score     INT          NOT NULL DEFAULT 20,
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Contestants (all applicants, one row per person per season) ──
CREATE TABLE IF NOT EXISTS contestants (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            VARCHAR(255) NOT NULL,
  stage_name           VARCHAR(255),
  entry_type           VARCHAR(10)  DEFAULT 'solo' CHECK (entry_type IN ('solo','group')),
  gender               VARCHAR(50),
  date_of_birth        DATE,
  county               VARCHAR(100),
  phone                VARCHAR(50)  NOT NULL,
  email                VARCHAR(255) NOT NULL,
  category_id          UUID         REFERENCES categories(id),
  short_bio            TEXT,
  talent_description   TEXT,
  profile_photo_url    VARCHAR(500),
  talent_video_url     VARCHAR(500),
  status               VARCHAR(50)  DEFAULT 'pending_payment' CHECK (status IN (
                         'pending_payment','registered','qualified',
                         'waiting_list','rejected','eliminated',
                         'winner','runner_up','second_runner_up','finalist')),
  -- payment fields
  payment_method       VARCHAR(100),
  payment_reference    VARCHAR(255),
  payment_notes        TEXT,
  payment_verified_by  UUID         REFERENCES users(id),
  payment_verified_at  TIMESTAMPTZ,
  -- judge notes
  judge_notes          TEXT,
  -- waiting list placement within a round (1 = next in line overall — one
  -- competition, not one waitlist per category)
  waitlist_position    INT,
  waitlist_round_id    UUID,
  -- linked login account (created when qualified)
  user_id              UUID         REFERENCES users(id),
  season_id            UUID         REFERENCES seasons(id),
  created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Audition scores (Stage 3 — one set per judge per contestant) ─
CREATE TABLE IF NOT EXISTS audition_scores (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id UUID         NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
  judge_id      UUID         NOT NULL REFERENCES users(id),
  scores        JSONB        NOT NULL,
  total_score   INT          NOT NULL,
  comments      TEXT,
  submitted_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(contestant_id, judge_id)
);

-- ── Competition rounds ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rounds (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  display_order INT          DEFAULT 0,
  status        VARCHAR(50)  DEFAULT 'upcoming' CHECK (status IN (
                  'upcoming','open','scoring','closed')),
  round_type    VARCHAR(20)  DEFAULT 'competition' CHECK (round_type IN ('audition','competition')),
  capacity      INT,         -- max contestants to advance overall (NULL = unlimited) — one
                              -- competition, not one per category
  season_id     UUID         REFERENCES seasons(id),
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Contestant performances (one per contestant per round) ───────
CREATE TABLE IF NOT EXISTS performances (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id         UUID         NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
  round_id              UUID         NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  performance_type      VARCHAR(20)  DEFAULT 'live' CHECK (performance_type IN ('live','video')),
  performance_video_url VARCHAR(500),
  song_name             VARCHAR(255),
  description           TEXT,
  submitted_at          TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(contestant_id, round_id)
);

-- ── Live performance scores (per performance per judge) ──────────
CREATE TABLE IF NOT EXISTS performance_scores (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_id UUID         NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
  judge_id       UUID         NOT NULL REFERENCES users(id),
  scores         JSONB        NOT NULL,
  total_score    INT          NOT NULL,
  comments       TEXT,
  submitted_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(performance_id, judge_id)
);

-- ── Voting codes (one code = one paid vote) ──────────────────────
CREATE TABLE IF NOT EXISTS voting_codes (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(50)  UNIQUE NOT NULL,
  used              BOOLEAN      DEFAULT FALSE,
  used_by_id        UUID         REFERENCES contestants(id),
  used_at           TIMESTAMPTZ,
  round_id          UUID         REFERENCES rounds(id),
  payment_method    VARCHAR(100),
  payment_reference VARCHAR(255),
  generated_by      UUID         REFERENCES users(id),
  created_at        TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Votes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id  UUID         NOT NULL REFERENCES contestants(id),
  voting_code_id UUID         UNIQUE REFERENCES voting_codes(id),
  round_id       UUID         REFERENCES rounds(id),
  cast_at        TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Announcements ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(500) NOT NULL,
  message     TEXT         NOT NULL,
  posted_by   UUID         REFERENCES users(id),
  season_id   UUID         REFERENCES seasons(id),
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Schedule entries ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_entries (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(500) NOT NULL,
  datetime    TIMESTAMPTZ  NOT NULL,
  location    VARCHAR(255),
  notes       TEXT,
  season_id   UUID         REFERENCES seasons(id),
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Sponsors ──────────────────────────────────────────────────────
-- season_id NULL = global sponsor (appears in every season)
-- season_id set  = tied to that season only
CREATE TABLE IF NOT EXISTS sponsors (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  logo_url      VARCHAR(500),
  website_url   VARCHAR(500),
  tier          VARCHAR(100) DEFAULT 'Partner',
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  season_id     UUID         REFERENCES seasons(id),
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Sent notifications log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type              VARCHAR(60)  NOT NULL,
  recipients_type   VARCHAR(30)  NOT NULL CHECK (recipients_type IN ('all','qualified','waiting_list','individual','registered')),
  recipient_id      UUID         REFERENCES contestants(id) ON DELETE SET NULL,
  subject           TEXT         NOT NULL,
  message           TEXT         NOT NULL,
  sent_count        INT          NOT NULL DEFAULT 0,
  email_sent_count  INT          NOT NULL DEFAULT 0,
  wa_sent_count     INT          NOT NULL DEFAULT 0,
  sent_by           UUID         REFERENCES users(id) ON DELETE SET NULL,
  sent_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Contestant media (photos and videos managed by staff) ────────
CREATE TABLE IF NOT EXISTS contestant_media (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id UUID         NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
  media_type    VARCHAR(20)  NOT NULL CHECK (media_type IN ('photo', 'video')),
  category      VARCHAR(100) DEFAULT 'other',
  file_path     VARCHAR(500) NOT NULL,
  original_name VARCHAR(500),
  file_size     BIGINT,
  mime_type     VARCHAR(100),
  title         VARCHAR(500),
  is_primary    BOOLEAN      DEFAULT FALSE,
  uploaded_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Group members (contestant_members) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS contestant_members (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id  UUID         NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
  member_name    VARCHAR(255) NOT NULL,
  member_dob     DATE,
  member_phone   VARCHAR(50),
  display_order  SMALLINT     DEFAULT 0,
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contestants_status  ON contestants(status);
CREATE INDEX IF NOT EXISTS idx_contestants_email   ON contestants(email);
CREATE INDEX IF NOT EXISTS idx_audition_scores_cid ON audition_scores(contestant_id);
CREATE INDEX IF NOT EXISTS idx_performances_round  ON performances(round_id);
CREATE INDEX IF NOT EXISTS idx_perf_scores_perf    ON performance_scores(performance_id);
CREATE INDEX IF NOT EXISTS idx_votes_contestant    ON votes(contestant_id);
CREATE INDEX IF NOT EXISTS idx_votes_round         ON votes(round_id);
CREATE INDEX IF NOT EXISTS idx_voting_codes_code    ON voting_codes(code);
CREATE INDEX IF NOT EXISTS idx_contestant_media_cid   ON contestant_media(contestant_id);
CREATE INDEX IF NOT EXISTS idx_contestant_members_cid ON contestant_members(contestant_id);

-- ── Migrations for existing databases ────────────────────────────
-- These ALTER TABLE statements are idempotent (IF NOT EXISTS).
-- On a fresh install the columns already exist from the CREATE TABLE above.
-- On an existing database they add columns that were introduced after initial setup.
ALTER TABLE users    ADD COLUMN IF NOT EXISTS permissions            JSONB        DEFAULT '[]';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS min_judges_to_qualify  INT          DEFAULT 3;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS round_advance_count    INT          DEFAULT 10;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS judge_score_weight     NUMERIC(5,4) DEFAULT 0.70;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vote_weight            NUMERIC(5,4) DEFAULT 0.30;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_user              VARCHAR(255);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_pass              TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_from              VARCHAR(255);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS wa_phone_id            VARCHAR(255);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS wa_token               TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS wa_template            VARCHAR(255) DEFAULT 'ltq_notification';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS wa_template_lang       VARCHAR(20)  DEFAULT 'en';
-- Extra social links (previously only added to existing DBs by the now-removed
-- db/migrate-social-columns.js — CREATE TABLE IF NOT EXISTS above is a no-op on
-- a settings table that already existed, so these never landed without it).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tiktok    VARCHAR(500);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS twitter   VARCHAR(500);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS youtube   VARCHAR(500);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS linkedin  VARCHAR(500);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pinterest VARCHAR(500);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS snapchat  VARCHAR(500);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS reddit    VARCHAR(500);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS discord   VARCHAR(500);
ALTER TABLE rounds        ADD COLUMN IF NOT EXISTS round_type        VARCHAR(20)  DEFAULT 'competition' CHECK (round_type IN ('audition','competition'));
ALTER TABLE performances  ADD COLUMN IF NOT EXISTS performance_type  VARCHAR(20)  DEFAULT 'live' CHECK (performance_type IN ('live','video'));
ALTER TABLE contestants      ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id);
ALTER TABLE rounds           ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id);
ALTER TABLE announcements    ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id);
ALTER TABLE schedule_entries ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id);
ALTER TABLE sponsors         ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id);

-- Add 'winner' to the contestants status constraint (idempotent)
DO $$
DECLARE v_con TEXT;
BEGIN
  -- Drop old auto-named constraint if it exists (pre-naming era)
  SELECT conname INTO v_con FROM pg_constraint
  WHERE conrelid = 'contestants'::regclass
    AND pg_get_constraintdef(oid) LIKE '%pending_payment%'
    AND conname != 'contestants_status_check';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE contestants DROP CONSTRAINT %I', v_con);
  END IF;
  -- Drop our named constraint if it already exists (safe re-run)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'contestants'::regclass
      AND conname = 'contestants_status_check'
  ) THEN
    EXECUTE 'ALTER TABLE contestants DROP CONSTRAINT contestants_status_check';
  END IF;
  ALTER TABLE contestants ADD CONSTRAINT contestants_status_check
    CHECK (status IN ('pending_payment','registered','qualified',
                      'waiting_list','rejected','eliminated',
                      'winner','runner_up','second_runner_up','finalist'));
END $$;

-- Per-season unique email: the same person can register across different seasons.
-- We drop the old global unique (if it exists) and replace with (email, season_id).
DO $$
BEGIN
  -- Drop the old global unique constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'contestants'::regclass AND conname = 'contestants_email_unique'
  ) THEN
    ALTER TABLE contestants DROP CONSTRAINT contestants_email_unique;
  END IF;
  -- Add the per-season composite unique if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'contestants'::regclass AND conname = 'contestants_email_season_unique'
  ) THEN
    ALTER TABLE contestants ADD CONSTRAINT contestants_email_season_unique UNIQUE (email, season_id);
  END IF;
END $$;

-- ── Broad system audit log (all significant staff actions) ──────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(255),
  actor_role  VARCHAR(50),
  action      VARCHAR(80)  NOT NULL,
  entity_type VARCHAR(50),
  entity_id   UUID,
  detail      TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- ── Permission audit log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permission_audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  target_user UUID         REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50)  NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perm_audit_target ON permission_audit_log(target_user);
CREATE INDEX IF NOT EXISTS idx_perm_audit_by     ON permission_audit_log(changed_by);

-- Extend notifications recipients_type to include eliminated and winner (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notifications'::regclass AND conname = 'notifications_recipients_type_check') THEN
    ALTER TABLE notifications DROP CONSTRAINT notifications_recipients_type_check;
  END IF;
  ALTER TABLE notifications ADD CONSTRAINT notifications_recipients_type_check
    CHECK (recipients_type IN ('all','qualified','waiting_list','individual','registered','eliminated','winner'));
END $$;

-- ── Missing column migrations (idempotent — safe for existing DBs) ───────────
-- contestants: waiting list placement tracking
ALTER TABLE contestants ADD COLUMN IF NOT EXISTS waitlist_position    INT;
ALTER TABLE contestants ADD COLUMN IF NOT EXISTS waitlist_round_id    UUID REFERENCES rounds(id) ON DELETE SET NULL;
-- rounds: max contestants to advance overall (NULL = unlimited)
ALTER TABLE rounds      ADD COLUMN IF NOT EXISTS capacity             INT;
-- settings: registration and audition config
ALTER TABLE settings    ADD COLUMN IF NOT EXISTS payment_instructions  TEXT;
ALTER TABLE settings    ADD COLUMN IF NOT EXISTS audition_video_required BOOLEAN DEFAULT TRUE;
ALTER TABLE settings    ADD COLUMN IF NOT EXISTS proposal_file_url     VARCHAR(500);
-- seasons: financial pricing per season
ALTER TABLE seasons     ADD COLUMN IF NOT EXISTS registration_fee_lrd  NUMERIC(12,2) DEFAULT 0;
ALTER TABLE seasons     ADD COLUMN IF NOT EXISTS voting_code_price_lrd NUMERIC(12,2) DEFAULT 0;
ALTER TABLE seasons     ADD COLUMN IF NOT EXISTS usd_to_lrd_rate       NUMERIC(10,2) DEFAULT 180;
-- notifications: per-channel counters
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_sent_count INT NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS wa_sent_count    INT NOT NULL DEFAULT 0;
-- contestants: group support
ALTER TABLE contestants ADD COLUMN IF NOT EXISTS entry_type VARCHAR(10) DEFAULT 'solo';
-- settings: group member limit
ALTER TABLE settings    ADD COLUMN IF NOT EXISTS max_group_members INT DEFAULT 6;

-- ── Accounting entries ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_entries (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id      UUID         REFERENCES seasons(id),
  type           VARCHAR(30)  NOT NULL CHECK (type IN ('registration','voting_code','other')),
  amount_lrd     NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_usd     NUMERIC(12,2) NOT NULL DEFAULT 0,
  reference_id   UUID,        -- contestant_id or voting_code_id
  reference_name VARCHAR(255),
  description    TEXT,
  created_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounting_season ON accounting_entries(season_id);
CREATE INDEX IF NOT EXISTS idx_accounting_type   ON accounting_entries(type);

-- ── Team profiles (about page) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_profiles (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  role_tag      VARCHAR(30)  NOT NULL,
  name          TEXT         NOT NULL,
  title         TEXT         NOT NULL,
  bio           TEXT,
  quote         TEXT,
  photo_url     TEXT,
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Event photos (gallery / about page) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_photos (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path     TEXT         NOT NULL,
  media_type    VARCHAR(20)  NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video')),
  caption       TEXT,
  wide          BOOLEAN      DEFAULT FALSE,
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  uploaded_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  season_id     UUID         REFERENCES seasons(id),
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);
-- routes/event-photos.routes.js depends on both of these; CREATE TABLE IF NOT
-- EXISTS above is a no-op on a pre-existing table, so this DB (and any other
-- upgraded install) never got them — every GET /api/event-photos 500'd.
ALTER TABLE event_photos ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) NOT NULL DEFAULT 'photo';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'event_photos'::regclass AND conname = 'event_photos_media_type_check'
  ) THEN
    ALTER TABLE event_photos DROP CONSTRAINT event_photos_media_type_check;
  END IF;
  ALTER TABLE event_photos ADD CONSTRAINT event_photos_media_type_check
    CHECK (media_type IN ('photo','video'));
END $$;
ALTER TABLE event_photos ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id);

-- ── Sponsor content blocks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsor_content (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id    UUID         REFERENCES sponsors(id) ON DELETE CASCADE,
  type          VARCHAR(20)  NOT NULL CHECK (type IN ('banner','video','text')),
  content       TEXT,
  url           VARCHAR(500),
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Sponsor testimonials / benefits / tiers (sponsors.html marketing content) ─
-- These were previously created only by db/add-sponsor-content.js, which meant
-- a fresh `node db/init.js` install never got them even though
-- routes/sponsor-content.routes.js depends on them. schema.sql is now the
-- single source of truth; add-sponsor-content.js only seeds default rows.
CREATE TABLE IF NOT EXISTS sponsor_testimonials (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  quote         TEXT         NOT NULL,
  author_name   VARCHAR(120) NOT NULL,
  author_role   VARCHAR(200) NOT NULL,
  initials      VARCHAR(4)   NOT NULL DEFAULT '',
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsor_benefits (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  icon_name     VARCHAR(80)  DEFAULT 'star',
  title         VARCHAR(120) NOT NULL,
  description   TEXT         NOT NULL,
  display_order INT          DEFAULT 0,
  active        BOOLEAN      DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sponsor_tiers (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(80)  NOT NULL,
  subtitle       VARCHAR(120) NOT NULL DEFAULT '',
  features       TEXT[]       NOT NULL DEFAULT '{}',
  featured       BOOLEAN      DEFAULT FALSE,
  style_variant  VARCHAR(20)  DEFAULT 'silver',
  display_order  INT          DEFAULT 0,
  active         BOOLEAN      DEFAULT TRUE
);

-- ── Contestant number (public competition ID, e.g. LTQ-S2-007) ──────────────
-- Previously only added by db/migrate-contestant-numbers.js. contestants.routes.js
-- (GET /:id) reads this column unconditionally, so a fresh install without it
-- threw "column c.contestant_number does not exist" for every staff detail view.
ALTER TABLE contestants ADD COLUMN IF NOT EXISTS contestant_number INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'contestants'::regclass AND conname = 'contestants_season_number_unique'
  ) THEN
    ALTER TABLE contestants ADD CONSTRAINT contestants_season_number_unique
      UNIQUE (season_id, contestant_number);
  END IF;
END $$;

-- ── contestant_media.category — enforce the same enum the upload routes use ──
-- schema.sql previously created this column as a free-text VARCHAR with no
-- CHECK, while db/add-contestant-media.js (run separately) added a stricter
-- constrained version. Consolidating here so both paths agree.
ALTER TABLE contestant_media ALTER COLUMN category SET DEFAULT 'other';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'contestant_media'::regclass AND conname = 'contestant_media_category_check'
  ) THEN
    ALTER TABLE contestant_media DROP CONSTRAINT contestant_media_category_check;
  END IF;
  ALTER TABLE contestant_media ADD CONSTRAINT contestant_media_category_check
    CHECK (category IN ('profile','headshot','audition','performance','interview','bts','promo','other'));
END $$;

-- ── contestants.entry_type — enforce solo/group at the DB level ─────────────
-- Was previously only enforced by db/migrate-group-support.js on existing DBs;
-- fresh installs relied on the inline CHECK in the CREATE TABLE above, which
-- doesn't help a pre-existing DB where the column was added via ALTER.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'contestants'::regclass AND conname = 'contestants_entry_type_check'
  ) THEN
    ALTER TABLE contestants ADD CONSTRAINT contestants_entry_type_check
      CHECK (entry_type IN ('solo','group'));
  END IF;
END $$;

-- ── Defensive ON DELETE behavior ─────────────────────────────────────────────
-- votes/voting_codes reference contestants; the only bulk contestant delete in
-- the app is the admin "purge old rejected applications" tool
-- (routes/admin.routes.js DELETE /purge). Rejected contestants should never
-- have live votes, but these make the purge safe rather than throwing a raw
-- FK-violation 500 in the rare case test/demo data has both.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'votes_contestant_id_fkey') THEN
    ALTER TABLE votes DROP CONSTRAINT votes_contestant_id_fkey;
  END IF;
  ALTER TABLE votes ADD CONSTRAINT votes_contestant_id_fkey
    FOREIGN KEY (contestant_id) REFERENCES contestants(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voting_codes_used_by_id_fkey') THEN
    ALTER TABLE voting_codes DROP CONSTRAINT voting_codes_used_by_id_fkey;
  END IF;
  ALTER TABLE voting_codes ADD CONSTRAINT voting_codes_used_by_id_fkey
    FOREIGN KEY (used_by_id) REFERENCES contestants(id) ON DELETE SET NULL;
END $$;

-- ── users.role — ensure the CHECK constraint covers all 10 roles ────────────
-- Previously only added to pre-existing DBs by db/add-roles.js. schema.sql's
-- inline CHECK on CREATE TABLE only helps fresh installs, not upgrades.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_role_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'superuser','contestant_manager','finance_manager',
    'judge','content_manager','contestant',
    'admin','head_judge','media_coordinator','communications_manager'
  ));
END $$;

-- ── Missing performance indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audition_scores_judge    ON audition_scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_perf_scores_judge        ON performance_scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_voting_codes_round_used  ON voting_codes(round_id, used);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity         ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_contestants_season_status ON contestants(season_id, status);
CREATE INDEX IF NOT EXISTS idx_rounds_season            ON rounds(season_id);
CREATE INDEX IF NOT EXISTS idx_announcements_season     ON announcements(season_id);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_season  ON schedule_entries(season_id);
CREATE INDEX IF NOT EXISTS idx_sponsors_season          ON sponsors(season_id);
