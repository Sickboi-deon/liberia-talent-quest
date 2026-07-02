// Credential loader for email and WhatsApp channels.
// Checks the settings DB row first; falls back to .env values.
// Results are cached for 60 s so sends don't hit the DB on every message.

const db = require('./db');

const CACHE_MS = 60_000;
let _cache    = null;
let _cacheTTL = 0;

async function _load() {
  if (_cache && Date.now() < _cacheTTL) return _cache;

  const { rows } = await db.query(
    `SELECT smtp_user, smtp_pass, smtp_from,
            wa_token, wa_phone_id, wa_template, wa_template_lang,
            cloudinary_cloud_name, cloudinary_api_key, cloudinary_api_secret
     FROM settings WHERE id = 1`
  );
  const row = rows[0] || {};

  const emailUser = row.smtp_user || process.env.SMTP_USER || '';
  const emailPass = row.smtp_pass || process.env.SMTP_PASS || '';
  const emailFrom = row.smtp_from
    || process.env.SMTP_FROM
    || 'Liberia Talent Quest <no-reply@liberiatalentquest.local>';

  const waToken   = row.wa_token    || process.env.WHATSAPP_TOKEN    || '';
  const waPhoneId = row.wa_phone_id || process.env.WHATSAPP_PHONE_ID || '';

  const cloudName = row.cloudinary_cloud_name || process.env.CLOUDINARY_CLOUD_NAME || '';
  const cloudKey  = row.cloudinary_api_key    || process.env.CLOUDINARY_API_KEY    || '';
  const cloudSecret = row.cloudinary_api_secret || process.env.CLOUDINARY_API_SECRET || '';

  _cache = {
    email: {
      host:       process.env.SMTP_HOST || 'smtp.gmail.com',
      port:       Number(process.env.SMTP_PORT || 587),
      user:       emailUser,
      pass:       emailPass,
      from:       emailFrom,
      configured: !!(emailUser && emailPass),
    },
    wa: {
      token:      waToken,
      phoneId:    waPhoneId,
      template:   row.wa_template      || process.env.WHATSAPP_TEMPLATE      || 'ltq_notification',
      lang:       row.wa_template_lang || process.env.WHATSAPP_TEMPLATE_LANG || 'en',
      configured: !!(waToken && waPhoneId),
    },
    cloudinary: {
      cloudName:  cloudName,
      apiKey:     cloudKey,
      apiSecret:  cloudSecret,
      configured: !!(cloudName && cloudKey && cloudSecret),
    },
  };

  _cacheTTL = Date.now() + CACHE_MS;
  return _cache;
}

async function getEmailConfig()      { return (await _load()).email; }
async function getWaConfig()         { return (await _load()).wa; }
async function getCloudinaryConfig() { return (await _load()).cloudinary; }

function invalidateCache() {
  _cache    = null;
  _cacheTTL = 0;
}

module.exports = { getEmailConfig, getWaConfig, getCloudinaryConfig, invalidateCache };
