const express = require('express');
const router  = express.Router();

const db = require('../lib/db');
const { requireAuth }                        = require('../middleware/requireAuth');
const { getEmailConfig, getWaConfig,
        invalidateCache }                    = require('../lib/integrations');
const { sendMail }                           = require('../lib/email');
const { sendWhatsApp, normalizePhone }       = require('../lib/whatsapp');
const { logAction }                          = require('../lib/audit');

// GET /api/integrations — current config (sensitive values masked)
// Superuser always passes (wildcard). Others need configure_notifications permission.
router.get('/', requireAuth([], 'configure_notifications'), async (_req, res) => {
  const [email, wa] = await Promise.all([getEmailConfig(), getWaConfig()]);
  res.json({
    email: {
      user:       email.user,
      from:       email.from,
      passSet:    !!email.pass,
      configured: email.configured,
    },
    whatsapp: {
      phoneId:    wa.phoneId,
      template:   wa.template,
      lang:       wa.lang,
      tokenSet:   !!wa.token,
      configured: wa.configured,
    }
  });
});

// PUT /api/integrations/email — save SMTP credentials
router.put('/email', requireAuth([], 'configure_notifications'), async (req, res) => {
  const { user, pass, from } = req.body || {};

  const sets = [];
  const vals = [];
  let   idx  = 1;

  if (user !== undefined) { sets.push(`smtp_user = $${idx++}`); vals.push(user.trim() || null); }
  if (pass !== undefined && pass.trim()) { sets.push(`smtp_pass = $${idx++}`); vals.push(pass.trim()); }
  if (from !== undefined) { sets.push(`smtp_from = $${idx++}`); vals.push(from.trim() || null); }

  if (!sets.length) return res.status(400).json({ error: 'No fields provided.' });

  await db.query(`UPDATE settings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = 1`, vals);
  invalidateCache();

  await logAction({
    actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
    action: 'integration_credentials_updated', entityType: 'settings', entityId: null,
    detail: `Email/SMTP credentials updated (fields: ${Object.keys(req.body || {}).join(', ')})`,
  });

  const cfg = await getEmailConfig();
  res.json({ message: 'Email settings saved.', configured: cfg.configured });
});

// PUT /api/integrations/whatsapp — save WhatsApp credentials
router.put('/whatsapp', requireAuth([], 'configure_notifications'), async (req, res) => {
  const { phoneId, token, template, lang } = req.body || {};

  const sets = [];
  const vals = [];
  let   idx  = 1;

  if (phoneId  !== undefined) { sets.push(`wa_phone_id = $${idx++}`);      vals.push(phoneId.trim() || null); }
  if (token    !== undefined && token.trim()) { sets.push(`wa_token = $${idx++}`); vals.push(token.trim()); }
  if (template !== undefined) { sets.push(`wa_template = $${idx++}`);      vals.push(template.trim() || 'ltq_notification'); }
  if (lang     !== undefined) { sets.push(`wa_template_lang = $${idx++}`); vals.push(lang.trim() || 'en'); }

  if (!sets.length) return res.status(400).json({ error: 'No fields provided.' });

  await db.query(`UPDATE settings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = 1`, vals);
  invalidateCache();

  await logAction({
    actorId: req.user.sub, actorRole: req.user.role, actorName: req.user.name,
    action: 'integration_credentials_updated', entityType: 'settings', entityId: null,
    detail: `WhatsApp credentials updated (fields: ${Object.keys(req.body || {}).join(', ')})`,
  });

  const cfg = await getWaConfig();
  res.json({ message: 'WhatsApp settings saved.', configured: cfg.configured });
});

// POST /api/integrations/test/email — send test email to the logged-in user
router.post('/test/email', requireAuth([], 'configure_notifications'), async (req, res) => {
  const cfg = await getEmailConfig();
  if (!cfg.configured) {
    return res.status(400).json({ error: 'Email is not configured yet. Save your SMTP credentials first.' });
  }
  try {
    await sendMail({
      to:      req.user.email,
      subject: 'LTQ — Email channel test',
      html:    `<div style="font-family:sans-serif;background:#0b0d13;color:#e8e6e0;padding:32px;border-radius:12px;max-width:520px;margin:auto;">
                  <p style="color:#F6D374;font-weight:700;margin:0 0 12px;">Liberia Talent Quest</p>
                  <p>Hello <strong>${req.user.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</strong>,</p>
                  <p>This test confirms your email channel is working correctly. Contestant notifications will be delivered to their inboxes.</p>
                  <p style="color:#6A6F7D;font-size:12px;margin-top:24px;">— Liberia Talent Quest</p>
                </div>`,
      text:    `Hello ${req.user.name},\n\nThis test confirms your LTQ email channel is working correctly.\n\n— Liberia Talent Quest`
    });
    res.json({ message: `Test email sent to ${req.user.email}.` });
  } catch (err) {
    res.status(500).json({ error: `Send failed: ${err.message}` });
  }
});

// POST /api/integrations/test/whatsapp — send test WA to a provided phone
router.post('/test/whatsapp', requireAuth([], 'configure_notifications'), async (req, res) => {
  const cfg = await getWaConfig();
  if (!cfg.configured) {
    return res.status(400).json({ error: 'WhatsApp is not configured yet. Save your credentials first.' });
  }
  const { phone } = req.body || {};
  const normalised = normalizePhone(phone || '');
  if (!phone || !normalised || !/^\d{10,15}$/.test(normalised)) {
    return res.status(400).json({ error: 'A valid phone number is required (e.g. 0770123456).' });
  }
  try {
    await sendWhatsApp({
      to:   phone,
      name: req.user.name,
      body: 'This is a test message from Liberia Talent Quest. Your WhatsApp notification channel is working correctly.'
    });
    res.json({ message: `Test WhatsApp sent to ${phone}.` });
  } catch (err) {
    res.status(500).json({ error: `Send failed: ${err.message}` });
  }
});

module.exports = router;
