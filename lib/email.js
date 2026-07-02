const nodemailer = require('nodemailer');
const { getEmailConfig } = require('./integrations');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Credentials are loaded dynamically from DB (with .env fallback)
// so they update without a server restart.
async function sendMail({ to, subject, html, text }) {
  const cfg = await getEmailConfig();

  if (!cfg.configured) {
    console.log('\n========== EMAIL (logged, not sent) ==========');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Body:\n' + (text || '[HTML email]'));
    console.log('=============================================\n');
    return { sent: false, loggedOnly: true };
  }

  const transporter = nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.port === 465,
    auth:   { user: cfg.user, pass: cfg.pass }
  });

  await transporter.sendMail({ from: cfg.from, to, subject, html, text });
  return { sent: true };
}

// ── HTML email builder ──────────────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml({ name, email, subject, body, ctaLabel, ctaUrl }) {
  const bodyHtml = esc(body).replace(/\n/g, '<br />');
  const cta = ctaLabel && ctaUrl
    ? `<tr><td align="center" style="padding:8px 36px 28px;">
        <a href="${esc(ctaUrl)}" style="display:inline-block;background:linear-gradient(135deg,#F6D374,#E3B341 55%,#A87C1E);color:#1A1304;font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;font-weight:700;padding:12px 28px;border-radius:9px;text-decoration:none;letter-spacing:0.01em;">${esc(ctaLabel)}</a>
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0d13;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0d13;">
  <tr>
    <td align="center" style="padding:40px 16px 48px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

        <!-- Badge -->
        <tr>
          <td align="center" style="padding-bottom:20px;">
            <span style="display:inline-block;background:rgba(246,211,116,0.1);border:1px solid rgba(246,211,116,0.28);border-radius:10px;padding:6px 16px;">
              <span style="color:#F6D374;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Liberia Talent Quest</span>
            </span>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background-color:#12141d;border-radius:16px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

              <!-- Card header -->
              <tr>
                <td style="background:linear-gradient(160deg,#151821,#1a1d2e);padding:26px 36px 22px;border-bottom:1px solid rgba(246,211,116,0.1);">
                  <h1 style="margin:0;color:#F6F4EE;font-size:21px;font-weight:700;line-height:1.3;">${esc(subject)}</h1>
                </td>
              </tr>

              <!-- Card body -->
              <tr>
                <td style="padding:28px 36px 20px;">
                  <p style="margin:0 0 18px;color:#9CA1B0;font-size:15px;line-height:1.5;">Hi <strong style="color:#F6F4EE;">${esc(name)}</strong>,</p>
                  <div style="color:#e8e6e0;font-size:15px;line-height:1.8;">${bodyHtml}</div>
                </td>
              </tr>

              ${cta}

              <!-- Divider -->
              <tr><td style="padding:0 36px;"><div style="height:1px;background:rgba(255,255,255,0.06);"></div></td></tr>

              <!-- Card footer -->
              <tr>
                <td style="padding:18px 36px 26px;">
                  <p style="margin:0 0 4px;color:#6A6F7D;font-size:12px;">Liberia Talent Quest &mdash; Legacy Hub Incorporated</p>
                  <a href="${esc(APP_URL)}" style="color:#F6D374;font-size:12px;text-decoration:none;">${esc(APP_URL)}</a>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- Bottom note -->
        <tr>
          <td align="center" style="padding-top:22px;">
            <p style="margin:0;color:#2e3245;font-size:11px;">This email was sent to <strong style="color:#2e3245;">${esc(email)}</strong> because you are a registered contestant.</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── Email builders ──────────────────────────────────────────────────────────

function registrationReceivedEmail({ name, email }) {
  const body = `Thank you for applying to Liberia Talent Quest!

Your application has been received. The next step is to pay the registration fee.

Payment options:
  • MTN Mobile Money
  • Orange Money
  • Cash (in person)

Once you have paid, please contact us so we can verify your payment and move your application forward.`;
  return {
    to: email,
    subject: 'LTQ — Application received, payment required',
    html: buildHtml({ name, email, subject: 'Application received — payment required', body, ctaLabel: 'Contact us', ctaUrl: `${APP_URL}/contact.html` }),
    text: `Hi ${name},\n\n${body}\n\nContact: ${APP_URL}/contact.html\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function paymentVerifiedEmail({ name, email }) {
  const body = `Great news — your registration payment has been verified!

Your application is now registered and our judges will review your audition video. We'll be in touch with the outcome soon.`;
  return {
    to: email,
    subject: 'LTQ — Payment verified, you\'re registered!',
    html: buildHtml({ name, email, subject: "Payment verified — you're registered!", body }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function qualifiedEmail({ name, email }) {
  const body = `Congratulations! Our judges have reviewed your audition video and you have QUALIFIED for Liberia Talent Quest!

The organizers will be in contact with you directly regarding rehearsals, schedules, and next steps.

Follow competition updates and see the schedule on our website.`;
  return {
    to: email,
    subject: "Congratulations — you've qualified for Liberia Talent Quest!",
    html: buildHtml({ name, email, subject: "You've qualified for Liberia Talent Quest!", body, ctaLabel: 'View competition schedule', ctaUrl: APP_URL }),
    text: `Hi ${name},\n\n${body}\n\n${APP_URL}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function waitingListEmail({ name, email }) {
  const body = `Thank you for submitting your audition video for Liberia Talent Quest.

Based on judge scores, you have been placed on the WAITING LIST. This means if a spot opens up, you may be called to compete.

We'll contact you if your status changes.`;
  return {
    to: email,
    subject: "LTQ — You're on the waiting list",
    html: buildHtml({ name, email, subject: "You've been placed on the waiting list", body }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function rejectionEmail({ name, email }) {
  const body = `Thank you for applying to Liberia Talent Quest and for sharing your performance with us.

After careful review, our judges have decided not to advance your application this round. We received a high number of strong submissions, and this isn't a reflection of your talent.

We'd love to see you apply again for a future season.`;
  return {
    to: email,
    subject: 'Your Liberia Talent Quest application',
    html: buildHtml({ name, email, subject: 'Regarding your Liberia Talent Quest application', body }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function staffWelcomeEmail({ name, email, tempPassword, role }) {
  const roleLabel = role.replace(/_/g, ' ');
  const body = `You've been added as a ${roleLabel} for Liberia Talent Quest.

  Login:             ${APP_URL}/login.html
  Email:             ${email}
  Temporary password: ${tempPassword}

Please log in and set a new password right away.`;
  return {
    to: email,
    subject: `Your LTQ ${roleLabel} account`,
    html: buildHtml({ name, email, subject: `Your LTQ ${roleLabel} account`, body, ctaLabel: 'Log in now', ctaUrl: `${APP_URL}/login.html` }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function passwordResetEmail({ name, email, resetLink }) {
  const body = `We received a request to reset the password on your Liberia Talent Quest account.

This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.`;
  return {
    to: email,
    subject: 'Reset your Liberia Talent Quest password',
    html: buildHtml({ name, email, subject: 'Reset your LTQ password', body, ctaLabel: 'Reset password', ctaUrl: resetLink }),
    text: `Hi ${name},\n\n${body}\n\nReset link: ${resetLink}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function contestantNotifyEmail({ name, email, subject, message }) {
  return {
    to: email,
    subject,
    html: buildHtml({ name, email, subject, body: message }),
    text: `Hi ${name},\n\n${message}\n\n— Liberia Talent Quest / Legacy Hub Incorporated\n${APP_URL}`
  };
}

function winnerEmail({ name, email }) {
  const body = `CONGRATULATIONS! You have been crowned the CHAMPION of Liberia Talent Quest!

Your talent, hard work, and dedication have made you our Season Champion. The organizers will be in touch with you regarding your prize and next steps.

Thank you for being an inspiration to all of Liberia!`;
  return {
    to: email,
    subject: 'LTQ — You are the Champion!',
    html: buildHtml({ name, email, subject: 'You are the Liberia Talent Quest Champion!', body, ctaLabel: 'View results', ctaUrl: APP_URL }),
    text: `Hi ${name},\n\n${body}\n\n${APP_URL}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function runnerUpEmail({ name, email }) {
  const body = `Congratulations! You have finished as RUNNER UP in Liberia Talent Quest!

Your incredible performance throughout the competition has earned you 2nd place. You should be incredibly proud of everything you have achieved.

The organizers will be in touch regarding your placement and recognition.`;
  return {
    to: email,
    subject: 'LTQ — Congratulations, Runner Up!',
    html: buildHtml({ name, email, subject: 'Congratulations — Liberia Talent Quest Runner Up!', body }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function secondRunnerUpEmail({ name, email }) {
  const body = `Congratulations! You have finished as SECOND RUNNER UP in Liberia Talent Quest!

Your outstanding talent has earned you 3rd place in the competition. This is a remarkable achievement and you have made Liberia proud.

The organizers will be in touch regarding your placement and recognition.`;
  return {
    to: email,
    subject: 'LTQ — Congratulations, Second Runner Up!',
    html: buildHtml({ name, email, subject: 'Congratulations — Liberia Talent Quest Second Runner Up!', body }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function finalistEmail({ name, email }) {
  const body = `Congratulations! You have finished as a FINALIST in Liberia Talent Quest!

Reaching the finale is an incredible achievement. Your talent and dedication have made you one of the top competitors of this season.

Thank you for being part of the Liberia Talent Quest journey.`;
  return {
    to: email,
    subject: 'LTQ — Congratulations, Finalist!',
    html: buildHtml({ name, email, subject: 'Congratulations — Liberia Talent Quest Finalist!', body }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function eliminatedEmail({ name, email }) {
  const body = `Thank you for competing in Liberia Talent Quest!

You have been eliminated from this round of the competition. Your performance and talent have been an inspiration throughout the competition.

We appreciate your participation and hope to see you again in a future season.`;
  return {
    to: email,
    subject: 'Regarding your Liberia Talent Quest competition',
    html: buildHtml({ name, email, subject: 'Thank you for competing in Liberia Talent Quest', body }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function waitlistPromotedEmail({ name, email }) {
  const body = `Great news! A spot has opened up and you have been promoted from the waiting list into the competition!

You are now an active contestant. The organizers will be in contact with you directly regarding the next steps, rehearsals, and schedules.

Congratulations and good luck!`;
  return {
    to: email,
    subject: 'LTQ — You have been promoted from the waiting list!',
    html: buildHtml({ name, email, subject: "You've been promoted — you're in the competition!", body, ctaLabel: 'View competition', ctaUrl: APP_URL }),
    text: `Hi ${name},\n\n${body}\n\n${APP_URL}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function contestantWelcomeEmail({ name, email, tempPassword }) {
  const body = `Welcome to Liberia Talent Quest!

Your contestant account has been created. Use the credentials below to log in and manage your profile.

  Login:              ${APP_URL}/login.html
  Email:              ${email}
  Temporary password: ${tempPassword}

Please log in and set a new password right away.`;
  return {
    to: email,
    subject: 'Welcome to Liberia Talent Quest — your account is ready',
    html: buildHtml({ name, email, subject: 'Welcome to Liberia Talent Quest!', body, ctaLabel: 'Log in now', ctaUrl: `${APP_URL}/login.html` }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

function staffPasswordResetEmail({ name, email, tempPassword }) {
  const body = `Your Liberia Talent Quest account password has been reset by an administrator.

  Login:              ${APP_URL}/login.html
  Email:              ${email}
  Temporary password: ${tempPassword}

You will be asked to set a new password when you log in.
If you did not expect this, contact your system administrator immediately.`;
  return {
    to: email,
    subject: 'LTQ — Your password has been reset',
    html: buildHtml({ name, email, subject: 'LTQ — Your password has been reset', body, ctaLabel: 'Log in now', ctaUrl: `${APP_URL}/login.html` }),
    text: `Hi ${name},\n\n${body}\n\n— Liberia Talent Quest / Legacy Hub Incorporated`
  };
}

module.exports = {
  sendMail,
  registrationReceivedEmail,
  paymentVerifiedEmail,
  qualifiedEmail,
  waitingListEmail,
  rejectionEmail,
  winnerEmail,
  runnerUpEmail,
  secondRunnerUpEmail,
  finalistEmail,
  eliminatedEmail,
  waitlistPromotedEmail,
  staffWelcomeEmail,
  staffPasswordResetEmail,
  passwordResetEmail,
  contestantNotifyEmail,
  contestantWelcomeEmail,
};
