const nodemailer = require('nodemailer');
const { Communication } = require('../models');
const { getConfig } = require('./settings');

function renderTemplate(tpl, vars) {
  return (tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

async function sendEmail(to, subject, body) {
  if (!to) return false;
  const cfg = await getConfig();

  // Brevo HTTP API (port 443) — works even where SMTP ports are blocked (e.g. new Linode accounts)
  if (cfg.BREVO_API_KEY) {
    try {
      const from = cfg.SMTP_FROM || 'Admissions <admissions@example.com>';
      const m = from.match(/^(.*)<(.+)>$/);
      const sender = m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() } : { email: from.trim() };
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': cfg.BREVO_API_KEY },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: body }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) console.error('[email:brevo] response:', (await res.text()).slice(0, 300));
      return res.ok;
    } catch (e) {
      console.error('[email:brevo] send failed:', e.message);
      return false;
    }
  }

  if (cfg.SMTP_HOST) {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.SMTP_HOST,
        port: Number(cfg.SMTP_PORT || 587),
        secure: Number(cfg.SMTP_PORT) === 465,
        auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
        // fail fast instead of hanging into a gateway timeout when ports are blocked
        connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
      });
      await transporter.sendMail({ from: cfg.SMTP_FROM || 'admissions@example.com', to, subject, text: body });
      return true;
    } catch (e) {
      console.error('[email] send failed:', e.message);
      return false;
    }
  }
  console.log(`[email:console] to=${to} subject="${subject}" body="${body}"`);
  return true;
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

module.exports = { notifyStatusChange, sendEmail, sendSms, renderTemplate };
