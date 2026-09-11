/**
 * Reusable email templates for staff → applicant mail (e.g. "selected for
 * provisional admission", "not selected"). Stored as JSON in the Setting
 * table (key MAIL_TEMPLATES) so the school can edit them in the admin panel;
 * seeded with the two letters the school already uses.
 *
 * Placeholders (case-insensitive): {{form_no}} {{name}} {{student_name}}
 * {{phone}} {{email}} {{class}} {{session}} {{form}} {{school}}
 */
const sanitizeHtml = require('sanitize-html');
const { Setting } = require('../models');

const SCHOOL = process.env.SCHOOL_NAME || 'Nirmala Convent School, Siliguri';
const SETTING_KEY = 'MAIL_TEMPLATES';

const DEFAULT_TEMPLATES = [
  {
    id: 'selected',
    name: 'Selected — provisional admission (fee payment)',
    subject: 'Provisional admission — Form No {{form_no}} — {{school}}',
    html: [
      '<p><b>Dear Parent,</b></p>',
      '<p><b>FORM NO: {{form_no}}</b></p>',
      '<p>This is to inform you that your child has been selected for provisional admission in NIRMALA CONVENT SCHOOL, SILIGURI.</p>',
      '<p>You are requested to make the requisite fee payment to confirm your child’s admission.</p>',
      '<p>Click on the link below.</p>',
      '<p><span style="color:#c00000">*NOTE: YOUR FORM NO. FOR PAYMENT IS: <b>{{form_no}}</b></span><br>',
      '(Your form number will be your provisional registration number.)<br>',
      '<b>Payment URL:</b> <a href="https://payments.billdesk.com/bdcollect/pay?p1=422&amp;p2=1">https://payments.billdesk.com/bdcollect/pay?p1=422&amp;p2=1</a></p>',
      '<p>You can make your payments through <b>Credit Card, Net Banking and Wallet</b></p>',
      '<p>Profile of your child has been linked to the registered phone number used during the form submission.</p>',
      '<p>For any support, queries and concerns related to the fee payment, please contact 9733312464</p>',
      '<p><span style="background:#ffff00"><b>*NOTE:</b> The payment portal will be active from 16th September 2026 till 20th September 2026. Provisional admission will be cancelled in case the admission fee is not paid till 20th September 2026.</span></p>',
      '<p>Best Regards,<br>(Nirmala Convent School)</p>',
    ].join('\n'),
  },
  {
    id: 'not-selected',
    name: 'Not selected — regret',
    subject: 'Admission result — Form No {{form_no}} — {{school}}',
    html: [
      '<p><b>Dear Parent,</b></p>',
      '<p><b>FORM NO: {{form_no}}</b></p>',
      '<p>Regret to inform you that your child is <b>NOT SELECTED</b> for admission to Class {{class}} for the academic session {{session}}.</p>',
      '<p>I appreciate the sincere time and effort you have put into the application process, but due to limited seats, we are not in a position to accommodate all.</p>',
      '<p>Thank you,<br>Best Regards,<br>(Nirmala Convent School)</p>',
    ].join('\n'),
  },
];

const SANITIZE = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'a', 'span', 'div', 'hr', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'font'],
  allowedAttributes: { a: ['href', 'target'], font: ['color'], '*': ['style'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
};

function clean(t) {
  return {
    id: String(t.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || `tpl-${Date.now()}`,
    name: String(t.name || '').trim().slice(0, 120) || 'Untitled template',
    subject: String(t.subject || '').trim().slice(0, 300) || 'Message from {{school}}',
    html: sanitizeHtml(String(t.html || ''), SANITIZE),
  };
}

async function listTemplates() {
  const row = await Setting.findOne({ where: { key: SETTING_KEY } });
  if (!row || !row.value) return DEFAULT_TEMPLATES.map(clean);
  try {
    const arr = JSON.parse(row.value);
    if (Array.isArray(arr) && arr.length) return arr.map(clean);
  } catch { /* fall through */ }
  return DEFAULT_TEMPLATES.map(clean);
}

async function saveTemplates(list) {
  if (!Array.isArray(list)) throw new Error('templates must be a list');
  const cleaned = list.map(clean);
  const ids = new Set();
  for (const t of cleaned) {
    if (ids.has(t.id)) throw new Error(`Duplicate template id "${t.id}"`);
    ids.add(t.id);
    if (!t.html.replace(/<[^>]+>/g, '').trim()) throw new Error(`Template "${t.name}" has an empty body`);
  }
  const [row] = await Setting.findOrCreate({ where: { key: SETTING_KEY }, defaults: { key: SETTING_KEY, value: '[]' } });
  await row.update({ value: JSON.stringify(cleaned) });
  return cleaned;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Fill {{placeholders}}. HTML output escapes the values; text output does not. */
function fill(str, vars, asHtml) {
  return String(str || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, k) => {
    const key = k.toLowerCase();
    if (!(key in vars)) return match; // unknown placeholder stays visible so the preview can flag it
    const out = vars[key] == null ? '' : String(vars[key]);
    return asHtml ? escapeHtml(out) : out;
  });
}

/** Plain-text version of the HTML body (for the text part and the portal thread). */
function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => (txt.replace(/<[^>]+>/g, '').trim() === href ? href : `${txt} (${href})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Variables for one submission (with applicant + activation loaded). */
function varsFor(sub, studentName) {
  const a = sub.activation || {};
  return {
    form_no: sub.formNo || '',
    name: sub.applicant?.name || 'Parent',
    student_name: studentName || '',
    phone: sub.applicant?.phone || '',
    email: sub.applicant?.email || '',
    class: a.classRoom?.name || '',
    session: a.session?.name || '',
    form: a.title || '',
    school: SCHOOL,
  };
}

function render(tpl, vars) {
  const html = fill(tpl.html, vars, true);
  const subject = fill(tpl.subject, vars, false);
  const text = htmlToText(html);
  const wrapped = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${html}</div>`;
  return { subject, html: wrapped, text };
}

/** Placeholders still unreplaced after rendering (a template typo like {{formno}}). */
function unresolved(str) {
  return [...String(str).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
}

module.exports = { listTemplates, saveTemplates, render, varsFor, htmlToText, unresolved, DEFAULT_TEMPLATES };
