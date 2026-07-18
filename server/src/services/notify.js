const nodemailer = require('nodemailer');
const { Communication } = require('../models');

function renderTemplate(tpl, vars) {
  return (tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function sendEmail(to, subject, body) {
  if (!to) return false;
  if (transporter) {
    try {
      await transporter.sendMail({ from: process.env.SMTP_FROM || 'admissions@example.com', to, subject, text: body });
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
  if (process.env.MSG91_AUTH_KEY) {
    try {
      const res = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: process.env.MSG91_AUTH_KEY },
        body: JSON.stringify({ sender: process.env.MSG91_SENDER_ID || 'SCHOOL', mobiles: '91' + phone, message }),
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
    // Placeholder: plug WhatsApp Business API here
    console.log(`[whatsapp:console] to=${applicant?.phone} message="${message}"`);
    jobs.push(Communication.create({ submissionId: submission.id, sender: 'system', channel: 'whatsapp', message }));
  }
  await Promise.all(jobs);
}

module.exports = { notifyStatusChange, sendEmail, sendSms, renderTemplate };
