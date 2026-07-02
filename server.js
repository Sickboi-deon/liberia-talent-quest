require('dotenv').config();
require('express-async-errors');
const express = require('express');
const path    = require('path');
const cors    = require('cors');
const helmet  = require('helmet');

const app  = express();
const PORT = process.env.PORT || 3000;

// Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc).
// CSP is relaxed for inline <script>/<style> and a small set of third-party
// origins the frontend actually loads (Google Fonts, Google Analytics) —
// the public pages use inline theme/init scripts by design, not a bundler.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      mediaSrc:   ["'self'", 'https:'],
      connectSrc: ["'self'", 'https://www.google-analytics.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS — enabled only when CORS_ORIGIN is set in the environment.
// In development the frontend is served from the same Express process so CORS
// is not needed. In production, set CORS_ORIGIN to a comma-separated list of
// allowed frontend origins (e.g. https://liberiatalentquest.com).
if (process.env.CORS_ORIGIN) {
  app.use(cors({
    origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(require('cookie-parser')());

// Serve uploaded media from outside the project directory.
// X-Content-Type-Options: nosniff prevents browsers from MIME-sniffing responses.
const { UPLOAD_ROOT } = require('./lib/upload');
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  next();
}, express.static(UPLOAD_ROOT));

// Serve the logo as favicon.ico so the browser's automatic /favicon.ico request
// resolves immediately — prevents the blank-icon flash before <link rel="icon"> loads.
app.get('/favicon.ico', (_req, res) => {
  res.type('image/png').sendFile(path.join(__dirname, 'public/assets/logo-icon.png'));
});

// Block unauthenticated access to all dashboard pages and the staff-only
// contestant profile page. These are internal tools — public visitors get 404.
const { verifyToken } = require('./lib/auth');
const STAFF_PAGES = /^\/(dashboard-[a-z-]+|manage-content|change-password)\.html$/;
app.use((req, res, next) => {
  if (!STAFF_PAGES.test(req.path)) return next();
  try {
    verifyToken(req.cookies?.ltq_session);
    next();
  } catch {
    res.status(404).send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>404 Not Found</title></head><body style="font-family:sans-serif;text-align:center;padding:80px;color:#555"><h1>404</h1><p>Page not found.</p></body></html>');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',          require('./routes/auth.routes'));
app.use('/api/users',         require('./routes/users.routes'));
app.use('/api/contestants',   require('./routes/contestants.routes'));
app.use('/api/categories',    require('./routes/categories.routes'));
app.use('/api/criteria',      require('./routes/criteria.routes'));
app.use('/api/audition-scores', require('./routes/audition-scores.routes'));
app.use('/api/qualification', require('./routes/qualification.routes'));
app.use('/api/rounds',        require('./routes/rounds.routes'));
app.use('/api/performances',  require('./routes/performances.routes'));
app.use('/api/voting-codes',  require('./routes/voting-codes.routes'));
app.use('/api/votes',         require('./routes/votes.routes'));
app.use('/api/announcements', require('./routes/announcements.routes'));
app.use('/api/schedule',      require('./routes/schedule.routes'));
app.use('/api/sponsors',      require('./routes/sponsors.routes'));
app.use('/api/settings',      require('./routes/settings.routes'));
app.use('/api/media',         require('./routes/media.routes'));
app.use('/api/notifications',  require('./routes/notifications.routes'));
app.use('/api/integrations',  require('./routes/integrations.routes'));
app.use('/api/admin',         require('./routes/admin.routes'));
app.use('/api/seasons',        require('./routes/seasons.routes'));
app.use('/api/team-profiles',  require('./routes/team-profiles.routes'));
app.use('/api/event-photos',   require('./routes/event-photos.routes'));
app.use('/api/stats',          require('./routes/stats.routes'));
app.use('/api/sponsor-content', require('./routes/sponsor-content.routes'));
app.use('/api/accounting',      require('./routes/accounting.routes'));

// SSE — real-time push events (no auth; public endpoint)
const { subscribe } = require('./lib/events');
app.get('/api/events/:channel', (req, res) => {
  subscribe(res, req.params.channel);
});

// 404 handler — must be after all routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler — catches unhandled errors thrown in route handlers
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[unhandled error]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Liberia Talent Quest running on http://localhost:${PORT}`);
  console.log('Run "node db/init.js" first if this is a fresh database.');
});
