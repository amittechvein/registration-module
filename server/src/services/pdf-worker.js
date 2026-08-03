/**
 * Worker thread that renders submission PDFs OFF the main event loop.
 * Why: pdfkit rendering is synchronous — pathological data (huge values,
 * layout edge cases) used to freeze the whole server (504s, OOM kills).
 * Inside a worker, the main server keeps serving; the parent kills us if we
 * take too long. See pdf-render.js for the timeout supervisor.
 */
const { parentPort } = require('worker_threads');
const PDFDocument = require('pdfkit');
const { drawSubmissionPdf } = require('./pdf');

parentPort.on('message', ({ subs }) => {
  try {
    // Buffers become Uint8Array across the thread boundary — restore them so
    // doc.image() accepts attachment photos/signatures.
    for (const s of subs) {
      for (const a of s.attachments || []) {
        if (a && a.data && !Buffer.isBuffer(a.data)) {
          try { a.data = Buffer.from(a.data.data || a.data); } catch { a.data = null; }
        }
      }
    }
    const doc = new PDFDocument({ size: 'A4', margins: { top: 24, bottom: 20, left: 36, right: 36 } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => parentPort.postMessage({ ok: true, buf: Buffer.concat(chunks) }));
    subs.forEach((s, i) => {
      if (i > 0) doc.addPage();
      drawSubmissionPdf(doc, s);
    });
    if (!subs.length) doc.fontSize(12).font('Helvetica').text('No submissions match the selected filters.', 40, 60);
    doc.end();
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e.message });
  }
});
