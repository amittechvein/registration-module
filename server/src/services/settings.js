/**
 * Admin-configurable settings, stored in the DB with .env as fallback.
 * Values saved from the admin panel override environment variables.
 */
const { Setting } = require('../models');

const SETTING_DEFS = [
  // Razorpay
  { key: 'RAZORPAY_KEY_ID', group: 'razorpay', label: 'Key ID', secret: false },
  { key: 'RAZORPAY_KEY_SECRET', group: 'razorpay', label: 'Key Secret', secret: true },
  // SMS (Infobip primary, MSG91 alternative)
  { key: 'INFOBIP_BASE_URL', group: 'sms', label: 'Infobip Base URL', secret: false },
  { key: 'INFOBIP_USERNAME', group: 'sms', label: 'Infobip Username', secret: false },
  { key: 'INFOBIP_PASSWORD', group: 'sms', label: 'Infobip Password', secret: true },
  { key: 'INFOBIP_SENDER', group: 'sms', label: 'Sender ID', secret: false },
  { key: 'SMS_COUNTRY_CODE', group: 'sms', label: 'Country Code Prefix', secret: false },
  { key: 'OTP_SMS_TEMPLATE', group: 'sms', label: 'OTP SMS Template (DLT)', secret: false },
  { key: 'MSG91_AUTH_KEY', group: 'sms', label: 'MSG91 Auth Key (alternative)', secret: true },
  { key: 'MSG91_SENDER_ID', group: 'sms', label: 'MSG91 Sender ID', secret: false },
  { key: 'DEV_SHOW_OTP', group: 'sms', label: 'Show OTP on screen (testing mode)', secret: false },
  // Login options
  { key: 'GOOGLE_CLIENT_ID', group: 'auth', label: 'Google OAuth Client ID', secret: false },
  { key: 'GOOGLE_CLIENT_SECRET', group: 'auth', label: 'Google OAuth Client Secret', secret: true },
  // Email — TatvaOS Mail API (one endpoint, one key; see TatvaOS Mail API Integration Guide)
  { key: 'TATVAOS_MAIL_KEY', group: 'email', label: 'TatvaOS API Key (tvos_…)', secret: true },
  { key: 'MAIL_FROM', group: 'email', label: 'From Address (a mailbox on your verified domain)', secret: false },
  { key: 'MAIL_REPLY_TO', group: 'email', label: 'Reply-To Address (optional)', secret: false },
  // Daily report to Owners
  { key: 'REPORT_ENABLED', group: 'reports', label: 'Send daily report', secret: false },
  { key: 'REPORT_TIME', group: 'reports', label: 'Send time (IST, 24h e.g. 08:00)', secret: false },
];

/** Keys from the previous Brevo/SMTP integration — removed from the DB on first load. */
const LEGACY_KEYS = ['BREVO_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

const MASK = '••••••••';
let cache = null;
let legacyCleaned = false;

async function getConfig() {
  if (!cache) {
    if (!legacyCleaned) {
      legacyCleaned = true;
      try {
        const n = await Setting.destroy({ where: { key: LEGACY_KEYS } });
        if (n) console.log(`[settings] removed ${n} legacy email setting(s) (Brevo/SMTP)`);
      } catch (e) { console.error('[settings] legacy cleanup failed:', e.message); }
    }
    const rows = await Setting.findAll();
    const db = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cache = {};
    for (const def of SETTING_DEFS) {
      const dbVal = db[def.key];
      cache[def.key] = dbVal !== undefined && dbVal !== null && dbVal !== '' ? dbVal : (process.env[def.key] ?? '');
    }
  }
  return cache;
}

function invalidate() { cache = null; }

/** For the admin UI: secrets are masked, but we report whether they're set. */
async function listForAdmin() {
  const cfg = await getConfig();
  return SETTING_DEFS.map((def) => ({
    key: def.key, group: def.group, label: def.label, secret: def.secret,
    isSet: !!cfg[def.key],
    value: def.secret ? (cfg[def.key] ? MASK : '') : cfg[def.key],
  }));
}

/** Save from the admin UI; masked placeholders mean "keep the existing value". */
async function saveFromAdmin(values) {
  const validKeys = new Set(SETTING_DEFS.map((d) => d.key));
  for (const [key, raw] of Object.entries(values || {})) {
    if (!validKeys.has(key)) continue;
    const value = String(raw ?? '').trim();
    if (value === MASK) continue; // untouched secret
    if (key === 'TATVAOS_MAIL_KEY' && value && !/^tvos_[A-Za-z0-9]+$/.test(value)) {
      throw new Error('TatvaOS API key should start with "tvos_" — copy it exactly as shown in TatvaOS → Organisation → API keys');
    }
    if ((key === 'MAIL_FROM' || key === 'MAIL_REPLY_TO') && value && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) {
      throw new Error(`${key === 'MAIL_FROM' ? 'From' : 'Reply-To'} address must be a plain email like noreply@your-domain.com (no display name)`);
    }
    const [row] = await Setting.findOrCreate({ where: { key }, defaults: { key, value } });
    if (row.value !== value) await row.update({ value });
  }
  invalidate();
}

module.exports = { getConfig, invalidate, listForAdmin, saveFromAdmin, SETTING_DEFS, MASK };
