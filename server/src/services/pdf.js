/**
 * Styled PDF rendering for application forms and payment receipts.
 * School identity comes from env: SCHOOL_NAME, SCHOOL_ADDRESS.
 */
const SCHOOL_NAME = process.env.SCHOOL_NAME || 'Nirmala Convent School, Siliguri';
const SCHOOL_ADDRESS = process.env.SCHOOL_ADDRESS || '3rd Mile, Sevoke Road, Ward 42, Siliguri, West Bengal 734008';

const RED = '#b91c1c';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const L = 50;          // left margin
const R = 545;         // right edge
const LABEL_W = 210;   // label column width

function header(doc) {
  doc.fontSize(15).font('Helvetica-Bold').fillColor(RED).text(SCHOOL_NAME, L, 40);
  doc.fontSize(9.5).font('Helvetica').fillColor(INK).text(SCHOOL_ADDRESS, L, doc.y + 2);
  doc.moveTo(L, doc.y + 8).lineTo(R, doc.y + 8).lineWidth(1.2).strokeColor(RED).stroke();
  doc.y += 18;
}

function metaRow(doc, cells) {
  const w = (R - L) / cells.length;
  const top = doc.y;
  cells.forEach((c, i) => {
    doc.fontSize(7.5).font('Helvetica').fillColor(MUTED).text(c.label.toUpperCase(), L + i * w, top, { width: w - 8 });
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(INK).text(c.value || '—', L + i * w, top + 11, { width: w - 8 });
  });
  doc.y = top + 34;
  doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.y += 10;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > 780) { doc.addPage({ margin: 40 }); header(doc); }
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 60);
  doc.moveDown(0.4);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(RED).text(title, L, doc.y);
  doc.moveTo(L, doc.y + 3).lineTo(R, doc.y + 3).lineWidth(0.8).strokeColor('#374151').stroke();
  doc.y += 12;
}

function row(doc, label, value) {
  ensureSpace(doc, 26);
  const top = doc.y;
  doc.fontSize(9).font('Helvetica').fillColor(MUTED).text(label, L + 4, top, { width: LABEL_W - 10 });
  const labelBottom = doc.y;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(INK).text(value, L + LABEL_W, top, { width: R - L - LABEL_W - 4 });
  doc.y = Math.max(labelBottom, doc.y) + 7;
}

function drawSubmissionPdf(doc, s) {
  const data = JSON.parse(s.data || '{}');
  header(doc);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(INK).text(s.activation?.title || 'Application Form', L, doc.y, { width: R - L });
  doc.y += 6;
  metaRow(doc, [
    { label: 'Academic Year', value: s.activation?.session?.name },
    { label: 'Class', value: s.activation?.classRoom?.name },
    { label: 'Form Number', value: s.formNo },
    { label: 'Status', value: s.status?.name },
    { label: 'Application Date', value: s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '' },
  ]);

  const sections = (s.activation?.template?.sections || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  for (const sec of sections) {
    sectionTitle(doc, sec.title);
    for (const f of (sec.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
      const v = data[f.id];
      const display = Array.isArray(v) ? v.join(', ')
        : v && typeof v === 'object' ? `Attached: ${v.filename || 'file'}`
        : v != null && v !== '' ? String(v) : '—';
      row(doc, f.label, display);
    }
  }

  // Payment summary
  if (Number(s.amount) > 0 || s.paymentStatus === 'paid') {
    sectionTitle(doc, 'Payment Details');
    row(doc, 'Registration Amount (Rs)', Number(s.amount || 0).toFixed(2));
    row(doc, 'Payment Status', s.paymentStatus === 'paid' ? 'Paid' : s.paymentStatus);
    const pay = (s.payments || []).find((p) => ['paid', 'mock_paid'].includes(p.status));
    if (pay) {
      row(doc, 'Payment Mode', 'Online');
      row(doc, 'Transaction ID', pay.paymentId || pay.orderId || '—');
      row(doc, 'Receipt No.', String(s.id).padStart(5, '0'));
    }
  }

  // Signature footer
  ensureSpace(doc, 70);
  doc.y += 30;
  doc.moveTo(R - 160, doc.y).lineTo(R, doc.y).lineWidth(0.7).strokeColor(INK).stroke();
  doc.fontSize(9).font('Helvetica').fillColor(MUTED).text('Signature', R - 160, doc.y + 4, { width: 160, align: 'center' });
}

function drawReceiptPdf(doc, s) {
  const pay = (s.payments || []).find((p) => ['paid', 'mock_paid'].includes(p.status)) || {};
  header(doc);

  doc.y += 6;
  doc.fontSize(14).font('Helvetica-Bold').fillColor(INK).text('PAYMENT RECEIPT', L, doc.y, { width: R - L, align: 'center' });
  doc.y += 10;

  // Receipt box
  const boxTop = doc.y;
  const rows = [
    ['Receipt No.', String(s.id).padStart(5, '0')],
    ['Receipt Date', pay.updatedAt ? new Date(pay.updatedAt).toLocaleString('en-IN') : new Date(s.submittedAt || Date.now()).toLocaleString('en-IN')],
    ['Form Number', s.formNo || '—'],
    ['Form', s.activation?.title || '—'],
    ['Class / Session', `${s.activation?.classRoom?.name || '—'} / ${s.activation?.session?.name || '—'}`],
    ['Received From', `${s.applicant?.name || '—'} (${s.applicant?.phone || '—'})`],
    ['Payment Mode', 'Online (Razorpay)'],
    ['Order ID', pay.orderId || '—'],
    ['Transaction ID', pay.paymentId || '—'],
    ['Amount Paid', `Rs. ${Number(s.amount || 0).toFixed(2)}`],
  ];
  let y = boxTop + 14;
  for (const [label, value] of rows) {
    doc.fontSize(9.5).font('Helvetica').fillColor(MUTED).text(label, L + 20, y, { width: 170 });
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(INK).text(String(value), L + 200, y, { width: R - L - 220 });
    y += 22;
  }
  doc.rect(L, boxTop, R - L, y - boxTop + 6).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.y = y + 16;

  // PAID stamp
  doc.save();
  doc.rotate(-8, { origin: [R - 110, boxTop + 30] });
  doc.rect(R - 165, boxTop + 12, 110, 36).lineWidth(2).strokeColor('#16a34a').stroke();
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#16a34a').text('PAID', R - 165, boxTop + 20, { width: 110, align: 'center' });
  doc.restore();

  doc.fontSize(8.5).font('Helvetica').fillColor(MUTED)
    .text('This is a computer-generated receipt and does not require a physical signature.', L, y + 24, { width: R - L, align: 'center' });
}

module.exports = { drawSubmissionPdf, drawReceiptPdf };
