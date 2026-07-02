const https = require('https');
const { getWaConfig } = require('./integrations');

// Convert any Liberian phone format to E.164 digits (no +).
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s\-\(\)\.]/g, '');
  if (p.startsWith('+'))   return p.slice(1);
  if (p.startsWith('00'))  return p.slice(2);
  if (p.startsWith('231')) return p;
  if (p.startsWith('0'))   return '231' + p.slice(1);
  if (p.length <= 9)       return '231' + p;
  return p;
}

async function sendWhatsApp({ to, name, body: msgBody }) {
  const cfg   = await getWaConfig();
  const phone = normalizePhone(to);
  if (!phone) throw new Error('Invalid or empty phone number');

  if (!cfg.configured) {
    console.log('\n===== WHATSAPP MESSAGE (not sent — no credentials) =====');
    console.log('To    :', '+' + phone, '|', name);
    console.log('Body  :', msgBody);
    console.log('========================================================\n');
    return { sent: false, loggedOnly: true };
  }

  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name:     cfg.template,
      language: { code: cfg.lang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: String(name    || '').slice(0, 1024) },
            { type: 'text', text: String(msgBody || '').slice(0, 1024) }
          ]
        }
      ]
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'graph.facebook.com',
        path:     `/v20.0/${cfg.phoneId}/messages`,
        method:   'POST',
        headers: {
          'Authorization':  `Bearer ${cfg.token}`,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let parsed = {};
          try { parsed = JSON.parse(raw); } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ sent: true, messageId: parsed.messages?.[0]?.id });
          } else {
            const errMsg = parsed.error?.message || `Meta API ${res.statusCode}`;
            reject(new Error(errMsg));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { sendWhatsApp, normalizePhone };
