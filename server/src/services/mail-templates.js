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
    title: 'Provisional Admission Notice',
    statuses: ['Selected', 'Shortlisted', 'Provisionally Admitted'],
    portal: false,
    tone: 'success',
    portalHeading: '🎉 Congratulations!',
    portalMessage: 'Your child has been selected for provisional admission in NIRMALA CONVENT SCHOOL, SILIGURI.\nClick below to download the notice.',
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
      '<p>The admission notice and the fee structure can also be downloaded from the school\'s admission portal: <a href="{{portal_url}}">{{portal_url}}</a> (login with your registered mobile number).</p>',
      '<p><span style="background:#ffff00"><b>*NOTE:</b> The payment portal will be active from 16th September 2026 till 20th September 2026. Provisional admission will be cancelled in case the admission fee is not paid till 20th September 2026.</span></p>',
      '<p>Best Regards,<br>(Nirmala Convent School)</p>',
    ].join('\n'),
  },
  {
    id: 'not-selected',
    name: 'Not selected — regret',
    title: 'Admission Result',
    statuses: ['Not Selected', 'Rejected', 'Waitlisted'],
    portal: false,
    tone: 'regret',
    portalHeading: 'Admission Result',
    portalMessage: 'Regret to inform you that your child is NOT SELECTED for admission to Class {{class}} for the academic session {{session}}.\nClick below to check the notice.',
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
  // Templates saved before a field existed inherit the built-in default for that id
  const base = DEFAULT_TEMPLATES.find((d) => d.id === t.id) || {};
  t = { ...base, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== null)) };
  return {
    id: String(t.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || `tpl-${Date.now()}`,
    name: String(t.name || '').trim().slice(0, 120) || 'Untitled template',
    subject: String(t.subject || '').trim().slice(0, 300) || 'Message from {{school}}',
    html: sanitizeHtml(String(t.html || ''), SANITIZE),
    // Notice PDF heading, e.g. "Provisional Admission Notice"
    title: String(t.title || '').trim().slice(0, 120) || 'Notice',
    // Status names this letter applies to (used for "notice as per status" and the parent portal)
    statuses: Array.isArray(t.statuses) ? [...new Set(t.statuses.map((x) => String(x).trim()).filter(Boolean))].slice(0, 30) : [],
    // Show as a downloadable Notice PDF on the parent's Track page when their status matches
    portal: t.portal === true || t.portal === 'true',
    // Popup shown on the parent's Track page (plain text; {{placeholders}} allowed; newlines kept)
    tone: ['success', 'regret', 'info'].includes(t.tone) ? t.tone : 'info',
    portalHeading: String(t.portalHeading || '').trim().slice(0, 120),
    portalMessage: String(t.portalMessage || '').trim().slice(0, 1000),
    // Optional extra PDF given with this notice (e.g. fee structure) — the file
    // itself lives in Setting MAIL_TEMPLATE_FILE_<id>; only its name is kept here.
    fileName: String(t.fileName || '').trim().slice(0, 120),
    fileLabel: String(t.fileLabel || '').trim().slice(0, 80),
  };
}

const FILE_KEY = (id) => `MAIL_TEMPLATE_FILE_${String(id).replace(/[^a-z0-9-]/gi, '')}`;
const FILE_MAX = 5 * 1024 * 1024;

/** Store a PDF for a template (replaces any previous one). */
async function setTemplateFile(id, { buffer, originalname }, label) {
  if (!buffer || !buffer.length) throw new Error('Empty file');
  if (buffer.length > FILE_MAX) throw new Error('File must be 5 MB or smaller');
  if (buffer.slice(0, 5).toString() !== '%PDF-') throw new Error('Only PDF files can be attached');
  const list = await listTemplates();
  const tpl = list.find((t) => t.id === id);
  if (!tpl) throw new Error('Template not found');
  const [row] = await Setting.findOrCreate({ where: { key: FILE_KEY(id) }, defaults: { key: FILE_KEY(id), value: '' } });
  await row.update({ value: buffer.toString('base64') });
  tpl.fileName = String(originalname || 'attachment.pdf').replace(/[^\w.() -]+/g, '-').slice(0, 120);
  tpl.fileLabel = String(label || '').trim().slice(0, 80) || tpl.fileName.replace(/\.pdf$/i, '');
  await saveTemplates(list);
  return tpl;
}

async function clearTemplateFile(id) {
  await Setting.destroy({ where: { key: FILE_KEY(id) } });
  const list = await listTemplates();
  const tpl = list.find((t) => t.id === id);
  if (tpl) { tpl.fileName = ''; tpl.fileLabel = ''; await saveTemplates(list); }
}

/** { name, label, buffer } or null. */
async function getTemplateFile(tpl) {
  if (!tpl || !tpl.fileName) return null;
  const row = await Setting.findOne({ where: { key: FILE_KEY(tpl.id) } });
  if (!row || !row.value) return null;
  return { name: tpl.fileName, label: tpl.fileLabel || tpl.fileName, buffer: Buffer.from(row.value, 'base64') };
}

/** What the parent's Track page shows for this template + submission (null if not published). */
function portalNoticeFor(tpl, sub) {
  if (!tpl || !tpl.portal) return null;
  const vars = varsFor(sub, '');
  return {
    title: fill(tpl.title, vars, false),
    tone: tpl.tone,
    heading: fill(tpl.portalHeading, vars, false) || fill(tpl.title, vars, false),
    message: fill(tpl.portalMessage, vars, false),
    file: tpl.fileName ? { label: tpl.fileLabel || tpl.fileName, name: tpl.fileName } : null,
  };
}

/** The template whose statuses include this status name (case-insensitive), or null. */
function templateForStatus(list, statusName) {
  const n = String(statusName || '').trim().toLowerCase();
  if (!n) return null;
  return list.find((t) => t.statuses.some((x) => x.toLowerCase() === n)) || null;
}

/** Data for one notice PDF page. */
function noticeFor(tpl, sub, studentName) {
  const vars = varsFor(sub, studentName);
  const r = render(tpl, vars);
  const date = new Date(Date.now() + 330 * 60000).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    formNo: vars.form_no, studentName: vars.student_name, parentName: vars.name, className: vars.class, session: vars.session, form: vars.form,
    title: fill(tpl.title, vars, false), html: r.html, date, subject: r.subject,
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
    portal_url: (process.env.PUBLIC_BASE_URL || 'https://form.techvein.org').replace(/\/$/, '') + '/track',
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

module.exports = { listTemplates, saveTemplates, render, varsFor, htmlToText, unresolved, templateForStatus, noticeFor, portalNoticeFor, setTemplateFile, clearTemplateFile, getTemplateFile, DEFAULT_TEMPLATES };
