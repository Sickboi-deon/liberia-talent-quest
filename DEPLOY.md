# Deployment Guide — Liberia Talent Quest

This guide covers deploying the platform to production. The stack is Node.js + PostgreSQL.
Any host that can run Node 18+ and connect to a PostgreSQL database will work.

---

## Prerequisites

- Node.js **18+**
- PostgreSQL **14+**
- A domain name (for HTTPS)
- SMTP credentials (for email sending — Gmail App Password works well)

---

## Option A — VPS / Dedicated Server (Recommended for production)

This is the most reliable option for a live season with real registrations and votes.

### 1. Provision a Server

Minimum: **1 GB RAM, 1 vCPU, 20 GB SSD**. Suitable providers:
- **Contabo** (affordable, data centers in Germany/Europe — good latency from Liberia)
- **DigitalOcean**, **Linode/Akamai**, **Vultr**, **Hetzner**
- **AWS Lightsail**, **Azure**, **Google Cloud** (enterprise-grade, pay-as-you-go)

Ubuntu 22.04 LTS is recommended as the base OS.

### 2. Install Dependencies

```bash
# Node.js 18 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# PM2 (process manager — keeps the app alive and auto-starts on reboot)
sudo npm install -g pm2

# Nginx (reverse proxy + SSL termination)
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 3. Create the Database

```bash
sudo -u postgres psql
```
```sql
CREATE USER ltq_user WITH PASSWORD 'use-a-strong-password-here';
CREATE DATABASE ltq OWNER ltq_user;
GRANT ALL PRIVILEGES ON DATABASE ltq TO ltq_user;
\q
```

### 4. Deploy the Application

```bash
# Upload the project (or clone from your git remote)
git clone https://your-git-remote/liberia-talent-quest.git /srv/ltq
cd /srv/ltq/ltq-app

npm install

# Create .env from template
cp .env.example .env
nano .env   # fill in all required values (see Environment Variables below)
```

### 5. Initialise and Migrate the Database

```bash
# Create the schema, default categories, scoring criteria, and superuser account
npm run db:init

# Run all migrations (social platform columns, group entry support, etc.)
npm run db:migrate
```

> `npm run db:init` applies `schema.sql`, which is fully idempotent — safe to run on a fresh
> database AND safe to re-run on every subsequent upgrade to pick up new tables/columns.
> `npm run db:migrate` handles one-time *data* migrations (legacy category remap, contestant
> number backfill) and is also safe to re-run at any time.

### 6. Required `.env` Values for Production

```env
DATABASE_URL=postgresql://ltq_user:STRONGPASSWORD@localhost:5432/ltq
NODE_ENV=production
JWT_SECRET=<64-char random hex — see below>
APP_URL=https://your-domain.com
SUPERUSER_NAME=Your Name
SUPERUSER_EMAIL=your@email.com
SUPERUSER_PASSWORD=YourSecurePassword123!
```

Generate `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 7. Start with PM2

```bash
pm2 start server.js --name ltq
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

Useful PM2 commands:
```bash
pm2 status          # check if the app is running
pm2 logs ltq        # tail live logs
pm2 restart ltq     # restart after a code change
pm2 stop ltq        # stop the app
```

### 8. Configure Nginx + HTTPS

```bash
sudo nano /etc/nginx/sites-available/ltq
```

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Large body limit for video uploads
    client_max_body_size 350M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE (real-time leaderboard) — disable buffering so events flush immediately
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ltq /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Issue a free SSL certificate via Let's Encrypt
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Certbot modifies the Nginx config to redirect HTTP → HTTPS automatically.

### 9. Configure Upload Storage

By default uploads go to `~/ltq-uploads/`. For a VPS deployment, set an explicit path:

```env
UPLOAD_DIR=/var/data/ltq-uploads
```

```bash
sudo mkdir -p /var/data/ltq-uploads
sudo chown $(whoami):$(whoami) /var/data/ltq-uploads
```

---

## Option B — Render.com (Quick cloud deploy)

Suitable for staging or early demos. Render provides managed PostgreSQL and free SSL.

### Steps

1. Push the project to a GitHub repository.

2. **render.com** → **New +** → **PostgreSQL**. Create a database named `ltq`. Copy the **Internal Database URL**.

3. **New +** → **Web Service** → connect the GitHub repo.
   - **Root Directory:** `ltq-app`
   - **Build Command:** `npm install && npm run db:init && npm run db:migrate`
   - **Start Command:** `npm start`
   - **Region:** Frankfurt (best latency to Liberia)

4. Add **Environment Variables** in Render:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | (paste Internal DB URL from step 2) |
   | `DATABASE_SSL` | `true` |
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | (generate a 48-byte hex string) |
   | `APP_URL` | `https://your-service-name.onrender.com` |
   | `SUPERUSER_NAME` | Your name |
   | `SUPERUSER_EMAIL` | your@email.com |
   | `SUPERUSER_PASSWORD` | YourSecurePassword123! |

5. Click **Create Web Service**. First deploy takes 3–5 minutes.

6. Log in at `/login.html` and change the superuser password immediately.

> **Note:** Render's free tier sleeps after 15 minutes of inactivity (cold starts take
> 20–50 seconds). Use a paid tier for a live public competition.

---

## Option C — Railway.app

1. Create a new project → **Add Service** → **Database** → **PostgreSQL**. Copy the `DATABASE_URL`.
2. **Add Service** → **GitHub Repo** → connect the repo.
3. Set **Root Directory** to `ltq-app`.
4. Set environment variables (same as Render above, `DATABASE_SSL=true`).
5. Set start command to `npm run db:init && npm run db:migrate && npm start` for the first deploy, then `npm start` for subsequent deploys.

---

## Script Safety Guardrails

A few `db/` scripts are destructive or seed demo data with published default passwords. They now
refuse to run when `NODE_ENV=production` is set, and the two genuinely destructive ones also
require an explicit `--force` flag:

| Script | Guardrail |
|---|---|
| `seed-full.js`, `seed-mock.js`, `seed-groups.js`, `seed-rounds.js`, `add-missing-roles.js` | Refuse to run if `NODE_ENV=production` |
| `db/reset-su.js` | Requires `--force`; e.g. `node db/reset-su.js --force` |
| `db/clear-season2.js` | Requires `--force` **and** refuses to run if `NODE_ENV=production` |

If you need to reset the superuser password on a production box (lost access), run it directly
with `NODE_ENV` unset or temporarily overridden for that one command — never disable the guard
in code.

---

## Post-Deployment Checklist

- [ ] Run `npm run db:public` and `npm run db:sponsors` to seed real About-page and sponsor-page content (safe for production; skips seeding if content already exists)
- [ ] Log in as Superuser → **change the default password immediately**
- [ ] Superuser → **Site Settings** → set contact phone, email, and social media links
- [ ] Superuser → **Site Settings** → set Maximum group members (default: 6)
- [ ] Superuser → **Notification Channels** → configure SMTP for email sending
- [ ] Superuser → **Seasons** → confirm the current season is marked active
- [ ] Superuser → **Categories** → verify all 6 categories are active
- [ ] Superuser → **Scoring Criteria** → verify audition and live performance criteria are configured
- [ ] Superuser → **Accounts** → create staff accounts (Admin, Judges, Finance, Content, Media, Communications)
- [ ] Test solo registration end-to-end (submit → verify payment → qualify)
- [ ] Test group registration end-to-end (2+ members → verify payment → qualify)
- [ ] Test voting with a real voting code
- [ ] Verify leaderboard SSE updates in real time
- [ ] Confirm gallery shows Group badges for group contestants
- [ ] Confirm all dashboard pages return 404 without login
- [ ] Confirm `contestant-profile.html` IS accessible without login (public page)
- [ ] Delete `Superuser.txt` from the server if it exists

---

## Upgrading an Existing Installation

```bash
# 1. Back up the database first
pg_dump -U ltq_user ltq > ltq_backup_$(date +%Y%m%d).sql

# 2. Pull the latest code
git pull

# 3. Install any new dependencies
npm install

# 4. Re-apply the schema — schema.sql is the single source of truth and is
#    100% idempotent, so this is always safe to re-run and picks up any new
#    tables/columns/constraints/indexes added since your last deploy.
npm run db:init

# 5. Run one-time data migrations (safe to re-run)
npm run db:migrate

# 6. Restart the app
pm2 restart ltq
```

---

## Backups

```bash
# Dump the database
pg_dump -U ltq_user ltq > ltq_backup_$(date +%Y%m%d).sql

# Restore from a backup
psql -U ltq_user ltq < ltq_backup_YYYYMMDD.sql
```

Automated daily backups (add to crontab with `crontab -e`):
```bash
0 2 * * * pg_dump -U ltq_user ltq > /backups/ltq_$(date +\%Y\%m\%d).sql
```

Also back up the upload directory periodically:
```bash
0 3 * * * tar -czf /backups/ltq-uploads_$(date +\%Y\%m\%d).tar.gz /var/data/ltq-uploads
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `DATABASE_SSL` | No | `false` | Set `true` for managed cloud providers |
| `NODE_ENV` | Yes (prod) | `development` | `production` enables Secure cookies |
| `JWT_SECRET` | Yes (prod) | insecure dev default | JWT signing key — minimum 48 bytes of entropy |
| `APP_URL` | Yes | `http://localhost:3000` | Used in password-reset email links |
| `PORT` | No | `3000` | HTTP port to listen on |
| `CORS_ORIGIN` | No | — | Allowed origins (comma-separated) — only needed if frontend and API are on different domains |
| `UPLOAD_DIR` | No | `~/ltq-uploads` | Absolute path for uploaded file storage |
| `SUPERUSER_EMAIL` | Init only | `admin@...local` | First-run superuser email |
| `SUPERUSER_PASSWORD` | Init only | `ChangeMe123!` | First-run superuser password (change immediately) |
| `SUPERUSER_NAME` | Init only | `Super Admin` | First-run superuser display name |
| `SMTP_HOST` | No | `smtp.gmail.com` | SMTP mail host |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username / email |
| `SMTP_PASS` | No | — | SMTP password or app password |
| `SMTP_FROM` | No | LTQ default | Email From header |
| `WHATSAPP_TOKEN` | No | — | Meta WhatsApp Cloud API permanent token |
| `WHATSAPP_PHONE_ID` | No | — | Meta phone number ID |
| `WHATSAPP_TEMPLATE` | No | `ltq_notification` | WhatsApp message template name |
| `WHATSAPP_TEMPLATE_LANG` | No | `en` | WhatsApp template language code |
