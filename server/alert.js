/**
 * Emergency email to every active Owner — used by the server-side watchdog
 * and backup scripts, which have no other way to reach a human.
 *
 *   cd /opt/registration/server && node alert.js "<subject>" "<body>"
 *
 * Uses the same mailer (Brevo / SMTP) and Settings as the app. Exit code 0
 * only if at least one email was accepted.
 */
require('dotenv').config();
const { AdminUser } = require('./src/models');
const { sendEmail } = require('./src/services/notify');

const [subject, body] = process.argv.slice(2);
if (!subject) {
  console.error('usage: node alert.js "<subject>" "<body>"');
  process.exit(2);
}

(async () => {
  const owners = await AdminUser.findAll({ where: { role: 'owner', active: true } });
  const emails = owners.map((o) => o.email).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ''));
  if (!emails.length) {
    console.error('[alert] no active Owner has a valid email');
    process.exit(1);
  }
  let sent = 0;
  for (const to of emails) {
    // eslint-disable-next-line no-await-in-loop
    if (await sendEmail(to, `[Admissions Portal] ${subject}`, body || subject)) sent += 1;
  }
  console.log(`[alert] "${subject}" sent to ${sent}/${emails.length}: ${emails.join(', ')}`);
  process.exit(sent ? 0 : 1);
})().catch((e) => {
  console.error('[alert] failed:', e.message);
  process.exit(1);
});
