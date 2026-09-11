/**
 * Notice / letter PDF (e.g. "selected for provisional admission", "not
 * selected") — one A4 page per student, drawn from an email template's HTML.
 *
 * Runs INSIDE the pdf worker (pdf-worker.js) — never call from the main
 * thread directly; go through renderNoticePdfs() in pdf-render.js.
 *
 * Rule 5.3 (HANDOVER): every string is clamped and every width is positive.
 */
const fs = require('fs');
const path = require('path');

const SCHOOL_NAME = process.env.SCHOOL_NAME || 'Nirmala Convent School, Siliguri';
const SCHOOL_ADDRESS = process.env.SCHOOL_ADDRESS || '3rd Mile, Sevoke Road, Ward 42, Siliguri, West Bengal 734008';
const MAX_HTML = 20000;

function getLogoPath() {
  for (const n of ['logo.png', 'logo.jpg']) {
    const p = path.join(__dirname, '..', 'assets', n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function decode(s) {
  return String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
}

/**
 * Tiny HTML → block/run model. Supports what the template editor produces:
 * p/div/h1-4/li/br blocks; b/strong/i/em/u/a/span/font inline; inline
 * style color / background (highlight). Unknown tags are ignored (text kept).
 */
function parseHtml(html) {
  const src = String(html || '').slice(0, MAX_HTML);
  const blocks = [];
  let cur = null; // { kind, runs: [] }
  const stack = []; // inline style stack
  const style = () => Object.assign({}, ...stack);
  const open = (kind) => { cur = { kind, runs: [] }; blocks.push(cur); };
  const ensure = () => { if (!cur) open('p'); };
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) {
      const text = decode(m[3]);
      if (!text.trim() && !cur) continue;
      ensure();
      cur.runs.push({ text, ...style() });
      continue;
    }
    const tag = m[1].toLowerCase();
    const closing = m[0][1] === '/';
    const attrs = m[2] || '';
    if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'ul', 'ol', 'tr', 'table'].includes(tag)) {
      if (closing) { cur = null; continue; }
      if (tag === 'ul' || tag === 'ol' || tag === 'table') { cur = null; continue; }
      open(tag === 'li' ? 'li' : /^h[1-4]$/.test(tag) ? 'h' : 'p');
      continue;
    }
    if (tag === 'br') { ensure(); cur.runs.push({ text: '\n', ...style() }); continue; }
    if (tag === 'hr') { blocks.push({ kind: 'hr', runs: [] }); cur = null; continue; }
    // inline
    if (closing) { stack.pop(); continue; }
    const st = {};
    if (tag === 'b' || tag === 'strong') st.bold = true;
    if (tag === 'i' || tag === 'em') st.italic = true;
    if (tag === 'u') st.underline = true;
    if (tag === 'a') { const h = attrs.match(/href="([^"]*)"/i); if (h) { st.link = decode(h[1]); st.underline = true; st.color = '#1a56db'; } }
    if (tag === 'font') { const c = attrs.match(/color="([^"]*)"/i); if (c) st.color = c[1]; }
    const styleAttr = attrs.match(/style="([^"]*)"/i);
    if (styleAttr) {
      const css = styleAttr[1];
      const col = css.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i); if (col) st.color = col[1].trim();
      const bg = css.match(/background(?:-color)?\s*:\s*([^;]+)/i); if (bg && !/transparent|white|#fff/i.test(bg[1])) st.highlight = true;
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(css)) st.bold = true;
      if (/text-decoration\s*:[^;]*underline/i.test(css)) st.underline = true;
    }
    stack.push(st);
  }
  return blocks;
}

function toHex(c) {
  const s = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  const rgb = s.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  const named = { red: '#c00000', blue: '#1a56db', green: '#15803d', black: '#111111' };
  return named[s.toLowerCase()] || '#111111';
}

/** Draw one notice on the current page. `n` = { formNo, studentName, parentName, className, session, form, title, html, date } */
function drawNoticePdf(doc, n) {
  const L = 48, R = 547, W = R - L;
  let y = 40;
  const logo = getLogoPath();
  if (logo) { try { doc.image(logo, L, y, { fit: [54, 54] }); } catch {} }
  const tx = logo ? L + 66 : L;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f2a5a').text(SCHOOL_NAME, tx, y + 4, { width: R - tx, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(SCHOOL_ADDRESS, tx, y + 26, { width: R - tx, lineBreak: false, ellipsis: true });
  doc.moveTo(L, y + 62).lineTo(R, y + 62).lineWidth(1.2).strokeColor('#0f2a5a').stroke();
  y += 74;

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text(String(n.title || 'NOTICE').slice(0, 120).toUpperCase(), L, y, { width: W, align: 'center' });
  y = doc.y + 8;

  // meta band
  const cells = [
    ['Form No', n.formNo], ['Student', n.studentName], ['Class / Session', [n.className, n.session].filter(Boolean).join(' · ')], ['Date', n.date],
  ].filter(([, v]) => v);
  const cw = Math.max(60, W / Math.max(1, cells.length));
  doc.rect(L, y, W, 34).fillColor('#f1f5f9').fill();
  cells.forEach(([k, v], i) => {
    const x = L + i * cw + 8;
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(k.toUpperCase(), x, y + 6, { width: cw - 12, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(String(v).slice(0, 80), x, y + 17, { width: cw - 12, lineBreak: false, ellipsis: true });
  });
  y += 46;

  // body
  doc.x = L; doc.y = y;
  const blocks = parseHtml(n.html);
  for (const b of blocks) {
    if (b.kind === 'hr') { doc.moveTo(L, doc.y + 4).lineTo(R, doc.y + 4).lineWidth(0.5).strokeColor('#cbd5e1').stroke(); doc.y += 10; continue; }
    const runs = b.runs.filter((r) => r.text.length);
    if (!runs.length) { doc.y += 6; continue; }
    const size = b.kind === 'h' ? 12 : 10.5;
    const indent = b.kind === 'li' ? 14 : 0;
    if (b.kind === 'li') { doc.font('Helvetica').fontSize(size).fillColor('#111111').text('•', L, doc.y, { lineBreak: false }); }
    doc.x = L + indent;
    // split on <br> runs: each line is a chain of `continued` runs ending with continued:false
    const lines = [[]];
    for (const r of runs) { if (r.text === '\n') lines.push([]); else lines[lines.length - 1].push(r); }
    for (const line of lines) {
      if (!line.length) { doc.y += size + 2; continue; }
      doc.x = L + indent;
      line.forEach((r, i) => {
        const last = i === line.length - 1;
        const font = r.bold && r.italic ? 'Helvetica-BoldOblique' : r.bold || b.kind === 'h' ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica';
        doc.font(font).fontSize(size).fillColor(r.highlight ? '#7c2d12' : toHex(r.color));
        const opts = { width: W - indent, continued: !last, underline: !!r.underline || !!r.highlight, lineGap: 2 };
        if (r.link) opts.link = String(r.link).slice(0, 500);
        doc.text(r.text.slice(0, 4000), opts);
      });
    }
    doc.y += b.kind === 'h' ? 6 : 8;
    doc.x = L;
  }

  // footer
  doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
    .text(`Generated by ${SCHOOL_NAME} admissions portal · ${n.date || ''} · Form No ${n.formNo || ''}`, L, 786, { width: W, align: 'center', lineBreak: false });
}

module.exports = { drawNoticePdf, parseHtml };
