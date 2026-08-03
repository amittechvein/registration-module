/**
 * Daily admissions report — emailed automatically to every ACTIVE user with
 * Role: Owner. Contains a per-active-form summary (submitted, new today,
 * drafts, fees collected, status breakdown) and the full submissions Excel
 * attached. Runs inside the server (systemd keeps it alive); the send time
 * is configurable in Settings → Daily Report. Sent-once-per-day guard is
 * persisted so restarts never cause duplicate emails.
 */
const { AdminUser, Setting, FormActivation, FormSection, FormField, Submission, Applicant, FormStatus, ClassRoom, AcademicSession } = require('../models');
const { sendEmail } = require('./notify');
const { getConfig } = require('./settings');

const IST_OFFSET_MIN = 330; // UTC+5:30

function istNow() {
  return new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000);
}
function istDateStr(d = istNow()) {
  return d.toISOString().slice(0, 10);
}
function istTimeStr(d = istNow()) {
  return d.toISOString().slice(11, 16); // HH:MM
}

/** Full submissions Excel (same columns/order as the admin export). */
async function buildExcelBuffer() {
  const ExcelJS = require('exceljs');
  const rows = await Submission.findAll({
    where: { isDraft: false },
    include: [
      { model: FormActivation, as: 'activation', include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }] },
      { model: Applicant, as: 'applicant' },
      { model: FormStatus, as: 'status' },
    ],
    order: [['submittedAt', 'DESC']],
  });
  const templateIds = [...new Set(rows.map((r) => r.activation?.templateId).filter(Boolean))];
  const sections = await FormSection.findAll({
    where: { templateId: templateIds.length ? templateIds : [0] },
    include: [{ model: FormField, as: 'fields' }],
    order: [['templateId', 'ASC'], ['sortOrder', 'ASC'], [{ model: FormField, as: 'fields' }, 'sortOrder', 'ASC']],
  });
  const fieldCols = [];
  for (const sec of sections) for (const f of sec.fields) fieldCols.push({ id: f.id, label: f.label });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Submissions');
  ws.columns = [
    { header: 'Form No', key: 'formNo', width: 14 },
    { header: 'Form', key: 'form', width: 22 },
    { header: 'Session', key: 'session', width: 12 },
    { header: 'Class', key: 'class', width: 12 },
    { header: 'Applicant Phone', key: 'phone', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Payment', key: 'payment', width: 10 },
    { header: 'Amount', key: 'amount', width: 10 },
    { header: 'Submitted At', key: 'submittedAt', width: 20 },
    ...fieldCols.map((c) => ({ header: c.label, key: 'f' + c.id, width: 18 })),
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const data = JSON.parse(r.data || '{}');
    const row = {
      formNo: r.formNo, form: r.activation?.title, session: r.activation?.session?.name,
      class: r.activation?.classRoom?.name, phone: r.applicant?.phone, status: r.status?.name,
      payment: r.paymentStatus, amount: Number(r.amount || 0),
      submittedAt: r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-IN') : '',
    };
    for (const c of fieldCols) {
      const v = data[c.id];
      row['f' + c.id] = Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? (v.filename || '[file]') : v ?? '';
    }
    ws.addRow(row);
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), count: rows.length };
}

/** Per-active-form summary text. */
async function buildSummaryText() {
  const acts = await FormActivation.findAll({
    include: [
      { model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' },
      { model: FormStatus, as: 'statuses' },
      { model: Submission, as: 'submissions', include: [{ model: FormStatus, as: 'status' }] },
    ],
  });
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const lines = [];
  let totalSubmitted = 0, totalCollected = 0, totalNew = 0;
  for (const a of acts.filter((x) => x.active)) {
    const subs = a.submissions.filter((s) => !s.isDraft);
    const drafts = a.submissions.length - subs.length;
    const newToday = subs.filter((s) => s.submittedAt && new Date(s.submittedAt) >= dayAgo).length;
    const collected = subs.filter((s) => s.paymentStatus === 'paid').reduce((t, s) => t + Number(s.amount || 0), 0);
    const pendingPay = subs.filter((s) => s.paymentStatus === 'pending').length;
    const byStatus = {};
    for (const s of subs) if (s.status) byStatus[s.status.name] = (byStatus[s.status.name] || 0) + 1;
    totalSubmitted += subs.length; totalCollected += collected; totalNew += newToday;
    lines.push(
      `▪ ${a.title} (${a.classRoom?.name || ''} · ${a.session?.name || ''})`,
      `   Submitted: ${subs.length} (last 24h: +${newToday}) · Drafts in progress: ${drafts}`,
      `   Fees collected: ₹${collected.toFixed(0)}${pendingPay ? ` · Payment pending: ${pendingPay}` : ''}`,
      `   Status: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`,
      ''
    );
  }
  if (!lines.length) lines.push('No active forms at the moment.', '');
  const header = [
    `DAILY ADMISSIONS REPORT — ${istNow().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
    `${process.env.SCHOOL_NAME || 'Nirmala Convent School, Siliguri'}`,
    '',
    `TOTALS: ${totalSubmitted} submitted · +${totalNew} in last 24h · ₹${totalCollected.toFixed(0)} collected`,
    '',
    'ACTIVE FORMS',
    '------------',
  ];
  const footer = [
    'The complete submissions Excel (all forms, every answer) is attached.',
    'Admin panel: https://form.techvein.org/admin',
  ];
  return [...header, ...lines, ...footer].join('\n');
}

/** Send the report to every active Owner. Returns { sent, skipped }. */
async function sendDailyReport() {
  const owners = await AdminUser.findAll({ where: { role: 'owner', active: true } });
  const emails = owners.map((o) => o.email).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ''));
  if (!emails.length) return { sent: [], skipped: 'no owner has a valid email' };
  const [summary, excel] = await Promise.all([buildSummaryText(), buildExcelBuffer()]);
  const subject = `Admissions Daily Report — ${istDateStr()} (${excel.count} submissions)`;
  const attachments = [{ filename: `submissions-${istDateStr()}.xlsx`, content: excel.buffer }];
  const sent = [];
  for (const email of emails) {
    const ok = await sendEmail(email, subject, summary, attachments);
    if (ok) sent.push(email);
  }
  console.log(`[report] daily report sent to: ${sent.join(', ') || 'nobody (email failed)'}`);
  return { sent, total: emails.length };
}

/** Scheduler: checks each minute; fires once per day at the configured IST time. */
function startReportScheduler() {
  setInterval(async () => {
    try {
      const cfg = await getConfig();
      if (String(cfg.REPORT_ENABLED ?? 'true') === 'false') return;
      const target = /^\d{2}:\d{2}$/.test(cfg.REPORT_TIME || '') ? cfg.REPORT_TIME : '08:00';
      if (istTimeStr() !== target) return;
      const today = istDateStr();
      const [row] = await Setting.findOrCreate({ where: { key: 'REPORT_LAST_SENT' }, defaults: { key: 'REPORT_LAST_SENT', value: '' } });
      if (row.value === today) return; // already sent today (survives restarts)
      await row.update({ value: today });
      await sendDailyReport();
    } catch (e) {
      console.error('[report] scheduler error:', e.message);
    }
  }, 60 * 1000);
  console.log('[report] daily report scheduler started (time configurable in Settings)');
}

module.exports = { sendDailyReport, startReportScheduler, buildExcelBuffer, buildSummaryText };
