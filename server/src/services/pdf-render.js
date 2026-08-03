/**
 * Safe PDF rendering supervisor.
 * Renders in a worker thread (pdf-worker.js) with a hard timeout: if a render
 * misbehaves — infinite loop, quadratic blow-up, OOM-sized data — the worker
 * is terminated and a small, valid "error PDF" is returned instead. The main
 * server NEVER blocks and can never be frozen by a PDF again.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const PDFDocument = require('pdfkit');

function errorPdfBuffer(label, message) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#dc2626').text('PDF generation error', 40, 60);
    doc.fontSize(10).font('Helvetica').fillColor('#111827')
      .text(`Item: ${label || '—'}\nReason: ${message}\n\nPlease report this to support — details are in the server log.`, 40, 84, { width: 500 });
    doc.end();
  });
}

/**
 * @param {Array<object>} subs plain submission objects (use s.toJSON())
 * @param {object} opts { timeoutMs, label }
 * @returns {Promise<Buffer>} always resolves with a valid PDF buffer
 */
function renderPdfBuffer(subs, { timeoutMs = 20000, label = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let worker;
    const finish = (buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (worker) worker.terminate().catch(() => {});
      resolve(buf);
    };
    const fail = (why) => {
      console.error(`[pdf] render failed for ${label || subs.map((s) => s.formNo || s.id).join(',')}: ${why}`);
      errorPdfBuffer(label, why).then(finish);
    };
    const timer = setTimeout(() => fail(`timed out after ${Math.round(timeoutMs / 1000)}s — submission data may be too large; the render was safely cancelled`), timeoutMs);
    try {
      worker = new Worker(path.join(__dirname, 'pdf-worker.js'));
    } catch (e) { return fail(e.message); }
    worker.once('message', (m) => (m.ok ? finish(Buffer.from(m.buf)) : fail(m.error)));
    worker.once('error', (e) => fail(e.message));
    worker.once('exit', (code) => { if (!settled && code !== 0) fail(`render worker exited unexpectedly (code ${code})`); });
    try {
      worker.postMessage({ subs });
    } catch (e) { fail(e.message); }
  });
}

module.exports = { renderPdfBuffer };
