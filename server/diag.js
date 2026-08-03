/**
 * PDF diagnostic — run ON THE SERVER:
 *   cd /opt/registration/server && node diag.js "0032"
 * (argument = any part of the form number; default finds the biggest form)
 * Prints data sizes, per-field value sizes, attachment sizes, and exact
 * timings for each stage of PDF generation. READ-ONLY — changes nothing.
 */
require('dotenv').config();
const {
  sequelize, Submission, FormActivation, ClassRoom, AcademicSession,
  FormTemplate, FormSection, FormField, Applicant, FormStatus, Payment, Attachment,
} = require('./src/models');
const { renderPdfBuffer } = require('./src/services/pdf-render');

const needle = process.argv[2] || '';

(async () => {
  const t = (ms) => `${ms}ms`;

  console.log('=== 1. Biggest submissions by stored data size ===');
  const [big] = await sequelize.query(
    `SELECT id, "formNo", length(data) AS data_chars FROM "Submissions" ORDER BY length(data) DESC NULLS LAST LIMIT 5`);
  for (const r of big) console.log(`  #${r.id}  ${r.formNo || '(draft)'}  data=${Number(r.data_chars).toLocaleString()} chars`);

  console.log('=== 2. Biggest attachments ===');
  const [atts] = await sequelize.query(
    `SELECT a.id, a."submissionId", s."formNo", a.mimetype, length(a.data) AS bytes
     FROM "Attachments" a LEFT JOIN "Submissions" s ON s.id = a."submissionId"
     ORDER BY length(a.data) DESC NULLS LAST LIMIT 5`);
  for (const r of atts) console.log(`  att#${r.id} sub#${r.submissionId} ${r.formNo || ''} ${r.mimetype} ${Number(r.bytes).toLocaleString()} bytes`);

  // Pick the target: matching formNo, else the biggest one
  let where;
  if (needle) where = { formNo: { [require('sequelize').Op.iLike]: `%${needle}%` } };
  const include = [
    { model: FormActivation, as: 'activation', include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }, { model: FormTemplate, as: 'template', include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }] }] },
    { model: Applicant, as: 'applicant' },
    { model: FormStatus, as: 'status' },
    { model: Payment, as: 'payments' },
    { model: Attachment, as: 'attachments' },
  ];

  let t0 = Date.now();
  const s = where
    ? await Submission.findOne({ where, include })
    : await Submission.findByPk(big[0]?.id, { include });
  const loadMs = Date.now() - t0;
  if (!s) { console.log(`No submission matching "${needle}"`); process.exit(0); }
  console.log(`=== 3. Target: #${s.id} ${s.formNo} (${s.applicant?.name || '?'}) — DB load ${t(loadMs)} ===`);
  console.log(`  template style: ${s.activation?.pdfTemplate || '(default modern)'}`);
  console.log(`  payments: ${(s.payments || []).map((p) => `${p.status}:${p.paymentId || p.orderId}`).join(' | ') || 'none'}`);
  console.log(`  attachments: ${(s.attachments || []).map((a) => `#${a.id} ${a.mimetype} ${(a.data?.length || 0).toLocaleString()}B`).join(' | ') || 'none'}`);

  console.log('=== 4. Field values over 500 chars ===');
  const data = JSON.parse(s.data || '{}');
  const labels = {};
  for (const sec of s.activation?.template?.sections || []) for (const f of sec.fields || []) labels[f.id] = f.label;
  let bigFields = 0;
  for (const [k, v] of Object.entries(data)) {
    const str = typeof v === 'string' ? v : JSON.stringify(v);
    if (str && str.length > 500) {
      bigFields++;
      console.log(`  field ${k} "${(labels[k] || '?').slice(0, 40)}": ${str.length.toLocaleString()} chars, starts: ${str.slice(0, 60).replace(/\n/g, ' ')}…`);
    }
  }
  if (!bigFields) console.log('  none — all values are normal size');

  console.log('=== 5. toJSON + render timing ===');
  t0 = Date.now();
  const plain = s.toJSON();
  console.log(`  toJSON: ${t(Date.now() - t0)}`);
  t0 = Date.now();
  const buf = await renderPdfBuffer([plain], { timeoutMs: 20000, label: `diag ${s.formNo}` });
  console.log(`  render: ${t(Date.now() - t0)}, output ${buf.length.toLocaleString()} bytes, valid PDF: ${buf.slice(0, 5).toString() === '%PDF-'}`);

  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error('DIAG FAILED:', e); process.exit(1); });
