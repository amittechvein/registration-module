/**
 * Styled PDF rendering — application forms (5 selectable templates) + payment receipt.
 * Template is chosen per form in Admin → Active Forms → PDF Design:
 *   modern  — two-column, navy section bands (single page)
 *   classic — bordered table cells with grey labels (printed-register style)
 *   elegant — serif, maroon & gold, formal certificate feel
 *   card    — soft section cards with blue accents and zebra rows
 *   mono    — pure black & white, photocopy friendly
 * School identity via env: SCHOOL_NAME, SCHOOL_ADDRESS. Logo: src/assets/logo.jpg
 */
const fs = require('fs');
const path = require('path');

const SCHOOL_NAME = process.env.SCHOOL_NAME || 'Nirmala Convent School, Siliguri';
const SCHOOL_ADDRESS = process.env.SCHOOL_ADDRESS || '3rd Mile, Sevoke Road, Ward 42, Siliguri, West Bengal 734008';
const ASSETS = path.join(__dirname, '..', 'assets');
function getLogoPath() {
  for (const n of ['logo.png', 'logo.jpg']) {
    const p = path.join(ASSETS, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const RED = '#b91c1c';
const NAVY = '#1e3a8a';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const BAND = '#f3f4f6';
const L = 36;
const R = 559;
const GUTTER = 14;
const COL_W = (R - L - GUTTER) / 2;

/* ------------------------------- themes ------------------------------- */
const THEMES = {
  modern: {
    fonts: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
    nameColor: RED, rules: [RED, NAVY], bandBg: BAND, bandInk: INK,
    labelColor: MUTED, valueColor: INK,
    sectionHeader(doc, x, y, w, title) {
      doc.rect(x, y, w, 13).fillColor(NAVY).fill();
      doc.fontSize(7.2).font(this.fonts.bold).fillColor('#ffffff').text(title.toUpperCase(), x + 5, y + 3.5, { width: w - 10, lineBreak: false });
      return y + 16;
    },
    rowLine(doc, x, y, w) { doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.3).strokeColor(LINE).stroke(); },
    rowBg: null,
    paymentBg: '#14532d', paymentInk: '#ffffff', paidColor: '#15803d',
  },
  elegant: {
    fonts: { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
    nameColor: '#7f1d1d', rules: ['#7f1d1d', '#b45309'], bandBg: '#faf7f2', bandInk: '#44403c',
    labelColor: '#78716c', valueColor: '#1c1917',
    sectionHeader(doc, x, y, w, title) {
      const t = title.toUpperCase();
      doc.fontSize(7.6).font(this.fonts.bold).fillColor('#7f1d1d');
      const tw = doc.widthOfString(t);
      const mid = y + 8;
      doc.moveTo(x, mid).lineTo(x + (w - tw) / 2 - 6, mid).lineWidth(0.5).strokeColor('#b45309').stroke();
      doc.moveTo(x + (w + tw) / 2 + 6, mid).lineTo(x + w, mid).lineWidth(0.5).strokeColor('#b45309').stroke();
      doc.text(t, x, y + 4, { width: w, align: 'center', lineBreak: false });
      return y + 17;
    },
    rowLine(doc, x, y, w) {
      doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.4).strokeColor('#d6d3d1').dash(1, { space: 2 }).stroke().undash();
    },
    rowBg: null,
    paymentBg: '#7f1d1d', paymentInk: '#ffffff', paidColor: '#7f1d1d',
  },
  card: {
    fonts: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
    nameColor: '#1d4ed8', rules: ['#1d4ed8', '#93c5fd'], bandBg: '#eff6ff', bandInk: '#1e3a8a',
    labelColor: '#64748b', valueColor: '#0f172a',
    sectionHeader(doc, x, y, w, title) {
      doc.roundedRect(x, y, w, 13, 3).fillColor('#eff6ff').fill();
      doc.rect(x, y + 1.5, 3, 10).fillColor('#2563eb').fill();
      doc.fontSize(7.2).font(this.fonts.bold).fillColor('#1e40af').text(title.toUpperCase(), x + 8, y + 3.5, { width: w - 12, lineBreak: false });
      return y + 16;
    },
    rowLine: null,
    rowBg(doc, x, y, w, h, idx) {
      if (idx % 2 === 0) { doc.roundedRect(x, y - 1.2, w, h, 2).fillColor('#f8fafc').fill(); }
    },
    paymentBg: '#2563eb', paymentInk: '#ffffff', paidColor: '#15803d',
  },
  mono: {
    fonts: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
    nameColor: '#000000', rules: ['#000000', '#9ca3af'], bandBg: '#f3f4f6', bandInk: '#000000',
    labelColor: '#4b5563', valueColor: '#000000',
    sectionHeader(doc, x, y, w, title) {
      doc.rect(x, y, w, 13).fillColor('#000000').fill();
      doc.fontSize(7.2).font(this.fonts.bold).fillColor('#ffffff').text(title.toUpperCase(), x + 5, y + 3.5, { width: w - 10, lineBreak: false });
      return y + 16;
    },
    rowLine(doc, x, y, w) { doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.3).strokeColor('#d1d5db').stroke(); },
    rowBg: null,
    paymentBg: '#374151', paymentInk: '#ffffff', paidColor: '#000000',
  },
};

/* ---------------------------- shared pieces ---------------------------- */
function header(doc, theme = THEMES.modern, hset = null) {
  // hset (from the layout designer) can override text, logo, alignment & color
  const name = hset?.name || SCHOOL_NAME;
  const address = hset?.address || SCHOOL_ADDRESS;
  const line3 = hset?.line3 || '';
  const nameColor = hset?.nameColor || theme.nameColor;
  const align = hset?.align === 'center' ? 'center' : 'left';
  const showLogo = hset ? hset.showLogo !== false : true;
  const logo = showLogo ? getLogoPath() : null;

  const top = 32;
  if (logo && align === 'left') doc.image(logo, L, top, { fit: [52, 52] });
  const tx = logo && align === 'left' ? L + 62 : L;
  const tw = R - tx;
  if (logo && align === 'center') {
    try { doc.image(logo, (L + R) / 2 - 24, top - 4, { fit: [48, 48] }); doc.y = top + 46; } catch {}
  }
  const nameY = logo && align === 'center' ? top + 48 : top + 4;
  doc.fontSize(16).font(theme.fonts.bold).fillColor(nameColor).text(name, tx, nameY, { width: tw, align });
  doc.fontSize(8.5).font(theme.fonts.regular).fillColor(MUTED).text(address, tx, doc.y + 1, { width: tw, align });
  if (line3) doc.fontSize(8.5).font(theme.fonts.regular).fillColor(MUTED).text(line3, tx, doc.y + 1, { width: tw, align });
  const yy = Math.max(doc.y + 6, top + 56);
  doc.moveTo(L, yy).lineTo(R, yy).lineWidth(1.4).strokeColor(hset?.nameColor || theme.rules[0]).stroke();
  doc.moveTo(L, yy + 2.5).lineTo(R, yy + 2.5).lineWidth(0.5).strokeColor(theme.rules[1]).stroke();
  doc.y = yy + 9;
}

function metaBand(doc, cells, theme = THEMES.modern) {
  const top = doc.y;
  const h = 26;
  doc.rect(L, top, R - L, h).fillColor(theme.bandBg).fill();
  const w = (R - L) / cells.length;
  cells.forEach((c, i) => {
    doc.fontSize(6.2).font(theme.fonts.regular).fillColor(MUTED).text(c.label.toUpperCase(), L + 8 + i * w, top + 5, { width: w - 12, lineBreak: false });
    doc.fontSize(8.2).font(theme.fonts.bold).fillColor(theme.bandInk).text(String(c.value || '—'), L + 8 + i * w, top + 13, { width: w - 12, lineBreak: false });
  });
  doc.y = top + h + 8;
}

/** Find an image attachment (jpeg/png) linked to a field whose label matches. */
function findImage(s, data, match) {
  const attachments = s.attachments || [];
  const sections = s.activation?.template?.sections || [];
  for (const sec of sections) {
    for (const f of sec.fields || []) {
      if (f.fieldType === 'file' && match(f.label.toLowerCase())) {
        const v = data[f.id];
        const att = attachments.find((a) => a.id === v?.attachmentId);
        if (att && /jpeg|png/.test(att.mimetype) && att.data) return att.data;
      }
    }
  }
  return null;
}

function displayValue(data, f) {
  const v = data[f.id];
  return Array.isArray(v) ? v.join(', ')
    : v && typeof v === 'object' ? `Attached: ${v.filename || 'file'}`
    : v != null && v !== '' ? String(v) : '—';
}

/* ------------------------- flow-based templates ------------------------- */
function makeFlow(doc, startYs, bottom, theme) {
  const flow = { col: 0, y: startYs[0], startYs, bottom };
  flow.x = () => L + flow.col * (COL_W + GUTTER);
  flow.need = (h) => {
    if (flow.y + h > flow.bottom) {
      if (flow.col === 0) { flow.col = 1; flow.y = flow.startYs[1]; }
      else { doc.addPage({ margin: 30 }); header(doc, theme); flow.col = 0; flow.startYs = [doc.y, doc.y]; flow.y = doc.y; }
    }
  };
  return flow;
}

function drawFlowPdf(doc, s, theme) {
  const data = JSON.parse(s.data || '{}');
  header(doc, theme);
  metaBand(doc, [
    { label: 'Academic Year', value: s.activation?.session?.name },
    { label: 'Class', value: s.activation?.classRoom?.name },
    { label: 'Form Number', value: s.formNo },
    { label: 'Status', value: s.status?.name },
    { label: 'Application Date', value: s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '' },
  ], theme);

  const photoBuf = findImage(s, data, (l) => l.includes('student photo'));
  const sigBuf = findImage(s, data, (l) => l.includes('signature'));

  const stripTop = doc.y;
  doc.fontSize(11).font(theme.fonts.bold).fillColor(theme.valueColor)
    .text(s.activation?.title || 'Application Form', L, stripTop + 3, { width: R - L - 80, lineBreak: false });
  let rightStart = stripTop + 20;
  if (photoBuf) {
    doc.rect(R - 66, stripTop, 62, 76).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    try { doc.image(photoBuf, R - 64, stripTop + 2, { fit: [58, 72], align: 'center', valign: 'center' }); } catch {}
    doc.fontSize(5.8).font(theme.fonts.regular).fillColor(MUTED).text('STUDENT PHOTO', R - 66, stripTop + 78, { width: 62, align: 'center', lineBreak: false });
    rightStart = stripTop + 90;
  }

  const flow = makeFlow(doc, [stripTop + 20, rightStart], 760, theme);

  const sections = (s.activation?.template?.sections || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  for (const sec of sections) {
    flow.need(24);
    flow.y = theme.sectionHeader(doc, flow.x(), flow.y, COL_W, sec.title);

    let idx = 0;
    for (const f of (sec.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
      const display = displayValue(data, f);
      doc.fontSize(6.6).font(theme.fonts.regular);
      const labelH = doc.heightOfString(f.label, { width: COL_W * 0.44 - 6 });
      doc.fontSize(7).font(theme.fonts.bold);
      const valueH = doc.heightOfString(display, { width: COL_W * 0.56 - 6 });
      const rowH = Math.max(labelH, valueH, 8) + 2.6;
      flow.need(rowH);
      if (theme.rowBg) theme.rowBg(doc, flow.x(), flow.y, COL_W, rowH, idx);
      doc.fontSize(6.6).font(theme.fonts.regular).fillColor(theme.labelColor)
        .text(f.label, flow.x() + 3, flow.y, { width: COL_W * 0.44 - 6 });
      doc.fontSize(7).font(theme.fonts.bold).fillColor(theme.valueColor)
        .text(display, flow.x() + COL_W * 0.44, flow.y, { width: COL_W * 0.56 - 6 });
      if (theme.rowLine) theme.rowLine(doc, flow.x(), flow.y + rowH - 1.6, COL_W);
      flow.y += rowH;
      idx += 1;
    }
    flow.y += 3;
  }

  if (Number(s.amount) > 0 || s.paymentStatus === 'paid') {
    const pay = (s.payments || []).find((p) => ['paid', 'mock_paid'].includes(p.status));
    const rows = [
      ['Registration Amount (Rs)', Number(s.amount || 0).toFixed(2)],
      ['Payment Status', s.paymentStatus === 'paid' ? 'PAID' : s.paymentStatus],
      ...(pay ? [['Payment Mode', 'Online'], ['Transaction ID', pay.paymentId || pay.orderId || '—']] : []),
    ];
    flow.need(20 + rows.length * 11);
    doc.rect(flow.x(), flow.y, COL_W, 13).fillColor(theme.paymentBg).fill();
    doc.fontSize(7.2).font(theme.fonts.bold).fillColor(theme.paymentInk).text('PAYMENT DETAILS', flow.x() + 5, flow.y + 3.5, { lineBreak: false });
    flow.y += 16;
    for (const [k, v] of rows) {
      doc.fontSize(6.6).font(theme.fonts.regular).fillColor(theme.labelColor).text(k, flow.x() + 3, flow.y, { width: COL_W * 0.44 - 6, lineBreak: false });
      doc.fontSize(7).font(theme.fonts.bold).fillColor(k === 'Payment Status' && v === 'PAID' ? theme.paidColor : theme.valueColor)
        .text(v, flow.x() + COL_W * 0.44, flow.y, { width: COL_W * 0.56 - 6, lineBreak: false });
      flow.y += 11;
    }
  }

  // Footer: declaration + signatures
  const fy = 770;
  doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.fontSize(6.4).font(theme.fonts.italic).fillColor(MUTED)
    .text('I/We hereby declare that the information provided above is true and correct to the best of my/our knowledge.', L + 145, fy + 10, { width: R - L - 290, align: 'center' });
  if (sigBuf) { try { doc.image(sigBuf, L + 12, fy + 5, { fit: [106, 27] }); } catch {} }
  doc.moveTo(L, fy + 34).lineTo(L + 130, fy + 34).lineWidth(0.7).strokeColor(INK).stroke();
  doc.fontSize(6.8).font(theme.fonts.regular).fillColor(MUTED).text("Parent/Guardian's Signature", L, fy + 37, { width: 130, align: 'center', lineBreak: false });
  doc.moveTo(R - 130, fy + 34).lineTo(R, fy + 34).lineWidth(0.7).strokeColor(INK).stroke();
  doc.text('Authorised Signatory', R - 130, fy + 37, { width: 130, align: 'center', lineBreak: false });
  doc.fontSize(6).fillColor('#9ca3af').text(`Generated on ${new Date().toLocaleString('en-IN')} · ${s.formNo || ''}`, L, fy + 43, { width: R - L, align: 'center', lineBreak: false, height: 7 });
}

/* --------------------------- classic template --------------------------- */
const C_LBL = '#eeeeee';
const C_BORDER = '#8a8a8a';

function classicCell(doc, x, y, w, h, text, { fill = false, bold = false, size = 7 } = {}) {
  if (fill) { doc.rect(x, y, w, h).fillColor(C_LBL).fill(); }
  doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(C_BORDER).stroke();
  doc.fontSize(size).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK)
    .text(text || '', x + 4, y + 3.5, { width: w - 8 });
}

function classicMeasure(doc, text, w, size = 7, bold = false) {
  doc.fontSize(size).font(bold ? 'Helvetica-Bold' : 'Helvetica');
  return doc.heightOfString(String(text || ' '), { width: w - 8 });
}

function drawClassicPdf(doc, s) {
  const data = JSON.parse(s.data || '{}');
  header(doc);
  const photoBuf = findImage(s, data, (l) => l.includes('student photo'));
  const sigBuf = findImage(s, data, (l) => l.includes('signature'));
  const LBL_W = 100;
  const HALF = (R - L) / 2;

  const pageBreak = (need) => {
    if (doc.y + need > 792) { doc.addPage({ margin: 30 }); header(doc); }
  };

  const top = doc.y;
  const PH = 88;
  doc.rect(L, top, 76, PH).lineWidth(0.8).strokeColor(C_BORDER).stroke();
  if (photoBuf) { try { doc.image(photoBuf, L + 2, top + 2, { fit: [72, PH - 4], align: 'center', valign: 'center' }); } catch {} }
  else doc.fontSize(6.5).font('Helvetica').fillColor(MUTED).text('STUDENT\nPHOTO', L, top + 34, { width: 76, align: 'center' });
  const tx = L + 84, tw = R - tx;
  const metaRows = [
    ['Form', s.activation?.title],
    ['Form Number', s.formNo],
    ['Class', `${s.activation?.classRoom?.name || '—'} (${s.activation?.session?.name || '—'})`],
    ['Status', s.status?.name],
    ['Application Date', s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : ''],
  ];
  const mh = PH / metaRows.length;
  metaRows.forEach(([k, v], i) => {
    const ry = top + i * mh;
    classicCell(doc, tx, ry, 105, mh, k, { fill: true });
    classicCell(doc, tx + 105, ry, tw - 105, mh, v, { bold: true });
  });
  doc.y = top + PH + 8;

  const sections = (s.activation?.template?.sections || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  for (const sec of sections) {
    pageBreak(34);
    const ty = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(INK).text(sec.title, L, ty + 2, { lineBreak: false });
    doc.y = ty + 16;

    const items = (sec.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((f) => {
      const v = data[f.id];
      const display = Array.isArray(v) ? v.join(', ')
        : v && typeof v === 'object' ? `Attached: ${v.filename || 'file'}`
        : v != null && v !== '' ? String(v) : '';
      const wide = f.label.length > 42 || String(display).length > 44 || f.fieldType === 'textarea' || f.fieldType === 'checkbox';
      return { label: f.label, value: display, wide };
    });
    let i = 0;
    while (i < items.length) {
      const a = items[i];
      const b = !a.wide && items[i + 1] && !items[i + 1].wide ? items[i + 1] : null;
      if (a.wide || !b) {
        const h = Math.max(13, classicMeasure(doc, a.label, LBL_W) + 7, classicMeasure(doc, a.value, R - L - LBL_W, 7, true) + 7);
        pageBreak(h);
        const y = doc.y;
        classicCell(doc, L, y, LBL_W, h, a.label, { fill: true });
        classicCell(doc, L + LBL_W, y, R - L - LBL_W, h, a.value, { bold: true });
        doc.y = y + h;
        i += 1;
      } else {
        const vw = HALF - LBL_W;
        const h = Math.max(13,
          classicMeasure(doc, a.label, LBL_W) + 7, classicMeasure(doc, a.value, vw, 7, true) + 7,
          classicMeasure(doc, b.label, LBL_W) + 7, classicMeasure(doc, b.value, vw, 7, true) + 7);
        pageBreak(h);
        const y = doc.y;
        classicCell(doc, L, y, LBL_W, h, a.label, { fill: true });
        classicCell(doc, L + LBL_W, y, vw, h, a.value, { bold: true });
        classicCell(doc, L + HALF, y, LBL_W, h, b.label, { fill: true });
        classicCell(doc, L + HALF + LBL_W, y, vw, h, b.value, { bold: true });
        doc.y = y + h;
        i += 2;
      }
    }
    doc.y += 6;
  }

  if (Number(s.amount) > 0 || s.paymentStatus === 'paid') {
    const pay = (s.payments || []).find((p) => ['paid', 'mock_paid'].includes(p.status));
    pageBreak(70);
    const pty = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(INK).text('Payment details', L, pty + 2, { lineBreak: false });
    doc.y = pty + 16;
    const rows = [
      ['Registration Amount (Rs)', Number(s.amount || 0).toFixed(2)],
      ['Payment Status', s.paymentStatus === 'paid' ? 'Paid' : s.paymentStatus],
      ...(pay ? [['Payment Mode', 'Online'], ['Transaction ID', pay.paymentId || pay.orderId || '—'], ['Receipt No.', String(s.id).padStart(5, '0')]] : []),
    ];
    for (const [k, v] of rows) {
      pageBreak(13);
      const ry = doc.y;
      classicCell(doc, L, ry, 160, 13, k, { fill: true });
      classicCell(doc, L + 160, ry, R - L - 160, 13, v, { bold: true });
      doc.y = ry + 13;
    }
  }

  pageBreak(60);
  const fy = Math.max(doc.y + 18, Math.min(770, doc.y + 18));
  if (sigBuf) { try { doc.image(sigBuf, L + 12, fy - 2, { fit: [106, 27] }); } catch {} }
  doc.moveTo(L, fy + 27).lineTo(L + 130, fy + 27).lineWidth(0.7).strokeColor(INK).stroke();
  doc.fontSize(6.8).font('Helvetica').fillColor(MUTED).text("Parent/Guardian's Signature", L, fy + 30, { width: 130, align: 'center', lineBreak: false });
  doc.moveTo(R - 130, fy + 27).lineTo(R, fy + 27).lineWidth(0.7).strokeColor(INK).stroke();
  doc.text('Authorised Signatory', R - 130, fy + 30, { width: 130, align: 'center', lineBreak: false });
}

/* ----------------------- custom (canvas-designed) ----------------------- */
/** Renders the layout designed in Admin → Form Templates → Design PDF Layout.
 *  Canvas coordinates are 1:1 PDF points on an A4 page (595 × 842). */
/** Render one field cell in the chosen label style: above | inline | hidden */
function fieldCell(doc, { x, y, w, h, fs, bold, color, align, labelStyle, underline }, label, display) {
  const vFont = bold ? 'Helvetica-Bold' : 'Helvetica';
  if (labelStyle === 'inline') {
    doc.fontSize(fs).font('Helvetica').fillColor('#6b7280')
      .text(label + ': ', x, y + 1, { width: w, height: h, continued: true, ellipsis: true, align })
      .font(vFont).fillColor(color).text(display, { width: w });
  } else if (labelStyle === 'hidden') {
    doc.fontSize(fs).font(vFont).fillColor(color).text(display, x, y + 1, { width: w, height: h, ellipsis: true, align });
  } else { // above
    let vy = y;
    if (h >= 14) {
      const lfs = Math.max(4.5, fs * 0.7);
      doc.fontSize(lfs).font('Helvetica').fillColor('#6b7280')
        .text(label, x, y + 1, { width: w, height: lfs + 2, ellipsis: true, lineBreak: false, align });
      vy = y + lfs + 3;
    }
    doc.fontSize(fs).font(vFont).fillColor(color).text(display, x, vy, { width: w, height: Math.max(fs + 2, y + h - vy - 2), ellipsis: true, align });
  }
  if (underline) doc.moveTo(x, y + h - 1.5).lineTo(x + w, y + h - 1.5).lineWidth(0.35).strokeColor('#d1d5db').stroke();
}

/** Normalize layout JSON: supports both the old single-design format and the
 *  new multi-design format {versions:[{name,settings,elements}], active}. */
function resolveLayout(raw, designIndex = null) {
  let layout = null;
  try { layout = JSON.parse(raw || 'null'); } catch {}
  if (!layout) return null;
  if (Array.isArray(layout.versions)) {
    const idx = designIndex != null ? designIndex : (layout.active || 0);
    return layout.versions[Math.max(0, Math.min(layout.versions.length - 1, idx))] || null;
  }
  return layout; // old format
}

function drawCustomPdf(doc, s) {
  const layout = resolveLayout(s.activation?.template?.layout, s.__designIndex ?? null);
  if (!layout || !Array.isArray(layout.elements) || !layout.elements.length) {
    return drawFlowPdf(doc, s, THEMES.modern); // nothing designed yet → fallback
  }
  const data = JSON.parse(s.data || '{}');
  const settings = layout.settings || {};
  if (settings.showHeader !== false) header(doc, THEMES.modern, settings.header || null);

  const fieldsById = {};
  for (const sec of s.activation?.template?.sections || []) {
    for (const f of sec.fields || []) fieldsById[f.id] = f;
  }
  const photoBuf = findImage(s, data, (l) => l.includes('student photo'));
  const sigBuf = findImage(s, data, (l) => l.includes('signature'));

  const meta = {
    form_no: s.formNo || '', status: s.status?.name || '',
    class: s.activation?.classRoom?.name || '', session: s.activation?.session?.name || '',
    form: s.activation?.title || '',
    date: s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('en-IN') : '',
    applicant_phone: s.applicant?.phone || '', applicant_name: s.applicant?.name || '',
  };

  // Two-page support: render page-1 elements, then page-2 on a fresh sheet
  const page1 = layout.elements.filter((e) => (e.page || 1) === 1);
  const page2 = layout.elements.filter((e) => (e.page || 1) === 2);
  renderCustomElements(doc, s, page1, data, settings);
  if (page2.length) {
    doc.addPage({ size: 'A4', margins: { top: 24, bottom: 20, left: 36, right: 36 } });
    if (settings.headerPage2) header(doc, THEMES.modern, settings.header || null);
    renderCustomElements(doc, s, page2, data, settings);
  }
}

function renderCustomElements(doc, s, elements, data, settings) {
  const fieldsById = {};
  for (const sec of s.activation?.template?.sections || []) {
    for (const f of sec.fields || []) fieldsById[f.id] = f;
  }
  const photoBuf = findImage(s, data, (l) => l.includes('student photo'));
  const sigBuf = findImage(s, data, (l) => l.includes('signature'));
  const meta = {
    form_no: s.formNo || '', status: s.status?.name || '',
    class: s.activation?.classRoom?.name || '', session: s.activation?.session?.name || '',
    form: s.activation?.title || '',
    date: s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('en-IN') : '',
    applicant_phone: s.applicant?.phone || '', applicant_name: s.applicant?.name || '',
  };

  for (const el of elements) {
    const x = Number(el.x) || 0, y = Number(el.y) || 0;
    const w = Math.max(10, Number(el.w) || 100), h = Math.max(8, Number(el.h) || 20);
    if (y > 815) continue; // keep on the single designed page
    const fs = Math.max(5, Number(el.fontSize) || 8);
    const color = el.color || '#111827';
    const font = el.bold ? 'Helvetica-Bold' : 'Helvetica';
    const align = el.align || 'left';

    if (el.kind === 'group') {
      // A whole form section as one resizable block: title + fields reflowed inside
      const sec = (s.activation?.template?.sections || []).find((x) => x.id === el.sectionId);
      if (!sec) continue;
      const fields = (sec.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      const titleH = fs + 8;
      doc.fontSize(fs + 1).font('Helvetica-Bold').fillColor(el.color || '#1e3a8a')
        .text(el.title || sec.title, x + 1, y, { width: w - 2, height: titleH, ellipsis: true, lineBreak: false, align });
      doc.moveTo(x, y + titleH - 3).lineTo(x + w, y + titleH - 3).lineWidth(0.6).strokeColor(el.color || '#1e3a8a').stroke();
      if (!fields.length) continue;
      const cols = Math.max(1, Math.min(3, Number(el.cols) || 1));
      const rows = Math.ceil(fields.length / cols);
      const rowH = Math.max(9, (h - titleH) / rows);
      const cellW = w / cols;
      const gStyle = el.labelStyle || (el.showLabels === false ? 'hidden' : 'above');
      fields.forEach((f, idx) => {
        const col = Math.floor(idx / rows), row = idx % rows;
        const fx = x + col * cellW + 1, fy = y + titleH + row * rowH, fw = cellW - 8;
        if (fy + rowH > 820) return;
        const v = data[f.id];
        const display = Array.isArray(v) ? v.join(', ')
          : v && typeof v === 'object' ? `Attached: ${v.filename || 'file'}`
          : v != null && v !== '' ? String(v) : '—';
        fieldCell(doc, { x: fx, y: fy, w: fw, h: rowH, fs, bold: el.bold, color: '#111827', align: el.align || 'left', labelStyle: gStyle, underline: el.underline !== false }, f.label, display);
      });
    } else if (el.kind === 'field') {
      const f = fieldsById[el.fieldId];
      if (!f) continue;
      const v = data[el.fieldId];
      const display = Array.isArray(v) ? v.join(', ')
        : v && typeof v === 'object' ? `Attached: ${v.filename || 'file'}`
        : v != null && v !== '' ? String(v) : '—';
      const fStyle = el.labelStyle || (el.showLabel === false ? 'hidden' : 'above');
      fieldCell(doc, { x: x + 1, y, w: w - 2, h, fs, bold: el.bold, color, align, labelStyle: fStyle, underline: !!el.underline }, el.labelText || f.label, display);
    } else if (el.kind === 'payment') {
      // Payment information block (amount, status, mode, transaction id)
      const pay = (s.payments || []).find((p) => ['paid', 'mock_paid'].includes(p.status));
      const rows = [
        ['Registration Amount (Rs)', Number(s.amount || 0).toFixed(2)],
        ['Payment Status', s.paymentStatus === 'paid' ? 'PAID' : (s.paymentStatus || '—')],
        ['Payment Mode', pay ? 'Online' : '—'],
        ['Transaction ID', pay ? (pay.paymentId || pay.orderId || '—') : '—'],
        ['Receipt No.', s.id ? String(s.id).padStart(5, '0') : '—'],
      ];
      const barH = fs + 6;
      doc.rect(x, y, w, barH).fillColor(color).fill();
      doc.fontSize(fs).font('Helvetica-Bold').fillColor('#ffffff').text(el.text || 'PAYMENT DETAILS', x + 5, y + 3, { width: w - 10, lineBreak: false, align });
      const rowH = Math.max(9, (h - barH - 2) / rows.length);
      rows.forEach(([k, v], i) => {
        const ry = y + barH + 2 + i * rowH;
        if (ry + rowH > 820) return;
        doc.fontSize(Math.max(5, fs - 0.5)).font('Helvetica').fillColor('#6b7280').text(k, x + 3, ry + 1, { width: w * 0.5 - 6, lineBreak: false, ellipsis: true });
        doc.fontSize(fs).font('Helvetica-Bold').fillColor(k === 'Payment Status' && v === 'PAID' ? '#15803d' : '#111827')
          .text(v, x + w * 0.5, ry + 1, { width: w * 0.5 - 4, lineBreak: false, ellipsis: true });
        doc.moveTo(x, ry + rowH).lineTo(x + w, ry + rowH).lineWidth(0.3).strokeColor('#e5e7eb').stroke();
      });
    } else if (el.kind === 'text') {
      const text = String(el.text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => meta[k] ?? '');
      doc.fontSize(fs).font(font).fillColor(color).text(text, x + 1, y, { width: w - 2, height: h, ellipsis: true, align });
    } else if (el.kind === 'line') {
      doc.moveTo(x, y + 1).lineTo(x + w, y + 1).lineWidth(Math.max(0.5, h / 10)).strokeColor(color).stroke();
    } else if (el.kind === 'box') {
      doc.rect(x, y, w, h).lineWidth(0.8).strokeColor(color).stroke();
    } else if (el.kind === 'photo') {
      doc.rect(x, y, w, h).lineWidth(0.8).strokeColor('#9ca3af').stroke();
      if (photoBuf) { try { doc.image(photoBuf, x + 1, y + 1, { fit: [w - 2, h - 2], align: 'center', valign: 'center' }); } catch {} }
    } else if (el.kind === 'signature') {
      if (sigBuf) { try { doc.image(sigBuf, x + 2, y + 2, { fit: [w - 4, h - 12] }); } catch {} }
      doc.moveTo(x, y + h - 9).lineTo(x + w, y + h - 9).lineWidth(0.6).strokeColor('#111827').stroke();
      doc.fontSize(6).font('Helvetica').fillColor('#6b7280').text(el.text || 'Signature', x, y + h - 7, { width: w, align: 'center', lineBreak: false });
    }
  }
}

/* ------------------------------ dispatcher ------------------------------ */
function drawSubmissionPdf(doc, s) {
  const style = s.activation?.pdfTemplate || process.env.PDF_TEMPLATE || 'modern';
  if (style === 'classic') return drawClassicPdf(doc, s);
  if (style === 'custom') return drawCustomPdf(doc, s);
  return drawFlowPdf(doc, s, THEMES[style] || THEMES.modern);
}

/* ------------------------------- receipt ------------------------------- */
function drawReceiptPdf(doc, s) {
  const pay = (s.payments || []).find((p) => ['paid', 'mock_paid'].includes(p.status)) || {};
  header(doc);

  doc.y += 8;
  doc.fontSize(14).font('Helvetica-Bold').fillColor(INK).text('PAYMENT RECEIPT', L, doc.y, { width: R - L, align: 'center' });
  doc.y += 12;

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
  ];
  let y = boxTop + 16;
  for (const [label, value] of rows) {
    doc.fontSize(9.5).font('Helvetica').fillColor(MUTED).text(label, L + 22, y, { width: 170, lineBreak: false });
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(INK).text(String(value), L + 210, y, { width: R - L - 240, lineBreak: false });
    y += 22;
  }
  doc.rect(L + 1, y + 2, R - L - 2, 26).fillColor(BAND).fill();
  doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text('Amount Paid', L + 22, y + 9, { lineBreak: false });
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#15803d').text(`Rs. ${Number(s.amount || 0).toFixed(2)}`, L + 210, y + 7, { lineBreak: false });
  y += 34;
  doc.rect(L, boxTop, R - L, y - boxTop).lineWidth(0.9).strokeColor('#cbd5e1').stroke();

  doc.save();
  doc.rotate(-8, { origin: [R - 110, boxTop + 30] });
  doc.rect(R - 165, boxTop + 12, 110, 36).lineWidth(2).strokeColor('#16a34a').stroke();
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#16a34a').text('PAID', R - 165, boxTop + 20, { width: 110, align: 'center', lineBreak: false });
  doc.restore();

  doc.fontSize(8.5).font('Helvetica').fillColor(MUTED)
    .text('This is a computer-generated receipt and does not require a physical signature.', L, y + 14, { width: R - L, align: 'center', lineBreak: false });
}

module.exports = { drawSubmissionPdf, drawReceiptPdf };
