const { Communication } = require('../models');
const { getConfig } = require('./settings');

function renderTemplate(tpl, vars) {
  return (tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

const TATVAOS_MAIL_URL = 'https://core.tatvaos.com/api/v1/mail/send';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Plain text → minimal HTML (TatvaOS recommends sending both; links become clickable). */
function textToHtml(text) {
  const withLinks = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${withLinks}</div>`;
}

/**
 * Send one email through the TatvaOS Mail API and report exactly what happened.
 * Returns { ok, status, error, provider }. Never throws.
 *
 * TatvaOS Mail (Integration Guide v1.1): POST JSON {from,to,subject,text,html,replyTo}
 * with "Authorization: Bearer tvos_…"; 202 = accepted for delivery. Attachments
 * are NOT supported by the API — callers must link to files instead (the daily
 * report does). If something passes attachments anyway they are dropped and a
 * note is added to the body, rather than failing the whole email.
 */
async function sendEmailDetailed(to, subject, body, attachments = [], opts = {}) {
  if (!to) return { ok: false, error: 'no recipient address', provider: 'TatvaOS' };
  const cfg = await getConfig();
  const key = (cfg.TATVAOS_MAIL_KEY || '').trim();
  const from = (cfg.MAIL_FROM || '').trim();

  if (!key || !from) {
    console.log(`[email:console] to=${to} subject="${subject}" body="${String(body).slice(0, 200)}…" (TatvaOS not configured)`);
    return { ok: true, status: 0, provider: 'console (TatvaOS Mail not configured)' };
  }

  let text = String(body ?? '');
  if (attachments.length) {
    console.warn(`[email:tatvaos] ${attachments.length} attachment(s) dropped — TatvaOS Mail does not support attachments (${attachments.map((a) => a.filename).join(', ')})`);
    text += `\n\n(Files cannot be attached to this email. Please download them from the admin panel.)`;
  }
  const payload = { from, to: String(to).trim(), subject: String(subject || '').slice(0, 500), text, html: opts.html || textToHtml(text) };
  if (cfg.MAIL_REPLY_TO) payload.replyTo = cfg.MAIL_REPLY_TO.trim();

  try {
    const res = await fetch(TATVAOS_MAIL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }
    if (res.status === 202) return { ok: true, status: 202, provider: 'TatvaOS', outcome: data.outcome };
    const error = data.error || `HTTP ${res.status}`;
    console.error(`[email:tatvaos] ${res.status} to=${to}: ${error}`);
    return { ok: false, status: res.status, error, provider: 'TatvaOS' };
  } catch (e) {
    console.error('[email:tatvaos] request failed:', e.message);
    return { ok: false, status: 0, error: e.name === 'TimeoutError' ? 'TatvaOS did not respond within 20 s' : e.message, provider: 'TatvaOS' };
  }
}

/** Boolean convenience wrapper used throughout the app. */
async function sendEmail(to, subject, body, attachments = []) {
  return (await sendEmailDetailed(to, subject, body, attachments)).ok;
}

async function sendSms(phone, message) {
  if (!phone) return false;
  const cfg = await getConfig();
  // Infobip (query API)
  if (cfg.INFOBIP_USERNAME && cfg.INFOBIP_PASSWORD) {
    try {
      const url =
        (cfg.INFOBIP_BASE_URL || 'https://api.infobip.com') +
        '/sms/1/text/query?' +
        new URLSearchParams({
          username: cfg.INFOBIP_USERNAME,
          password: cfg.INFOBIP_PASSWORD,
          from: cfg.INFOBIP_SENDER || 'TCVEIN',
          to: (cfg.SMS_COUNTRY_CODE || '') + phone,
          text: message,
        }).toString();
      const res = await fetch(url);
      const body = await res.text();
      const ok = res.ok && !/REJECTED|error/i.test(body);
      if (!ok) console.error('[sms:infobip] response:', body.slice(0, 300));
      return ok;
    } catch (e) {
      console.error('[sms:infobip] send failed:', e.message);
      return false;
    }
  }
  // MSG91 (alternative)
  if (cfg.MSG91_AUTH_KEY) {
    try {
      const res = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: cfg.MSG91_AUTH_KEY },
        body: JSON.stringify({ sender: cfg.MSG91_SENDER_ID || 'SCHOOL', mobiles: '91' + phone, message }),
      });
      return res.ok;
    } catch (e) {
      console.error('[sms] send failed:', e.message);
      return false;
    }
  }
  console.log(`[sms:console] to=${phone} message="${message}"`);
  return true;
}

/**
 * Fire notifications configured on a status, and log them in the communication thread.
 */
async function notifyStatusChange({ submission, applicant, status, activation, className }) {
  if (!status.sendNotification) return;
  const vars = {
    name: applicant?.name || 'Applicant',
    phone: applicant?.phone || '',
    form_no: submission.formNo || '',
    status: status.name,
    class: className || '',
    form: activation?.title || '',
  };
  const message =
    renderTemplate(status.messageTemplate, vars) ||
    `Dear ${vars.name}, your form ${vars.form_no} status is now "${vars.status}".`;

  const jobs = [];
  if (status.notifySms) {
    jobs.push(
      sendSms(applicant?.phone, message).then((ok) =>
        Communication.create({ submissionId: submission.id, sender: 'system', channel: 'sms', message: `${ok ? '' : '[FAILED] '}${message}` })
      )
    );
  }
  if (status.notifyEmail) {
    jobs.push(
      sendEmail(applicant?.email, `Application ${vars.form_no}: ${vars.status}`, message).then((ok) =>
        Communication.create({ submissionId: submission.id, sender: 'system', channel: 'email', message: `${ok ? '' : '[FAILED] '}${message}` })
      )
    );
  }
  if (status.notifyWhatsapp) {
    console.log(`[whatsapp:console] to=${applicant?.phone} message="${message}"`);
    jobs.push(Communication.create({ submissionId: submission.id, sender: 'system', channel: 'whatsapp', message }));
  }
  await Promise.all(jobs);
}

module.exports = { notifyStatusChange, sendEmail, sendEmailDetailed, sendSms, renderTemplate };
