const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const {
  sequelize, AcademicSession, ClassRoom, AdminUser,
  FormTemplate, FormSection, FormField, FormActivation, FormStatus,
  Applicant, Attachment, Submission, Payment, Communication, StatusLog,
} = require('../models');
const { sign, verify, applicantAuth } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { validateSubmission } = require('../services/validate');
const { scoreSubmission, detectDuplicates } = require('../services/scoring');
const payment = require('../services/payment');
const { notifyStatusChange } = require('../services/notify');

const router = express.Router();

const formInclude = [
  { model: FormTemplate, as: 'template', include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }] },
  { model: AcademicSession, as: 'session' },
  { model: ClassRoom, as: 'classRoom' },
  { model: FormStatus, as: 'statuses' },
];

function isOpen(a) {
  if (!a.active) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (a.startDate && today < a.startDate) return false;
  if (a.endDate && today > a.endDate) return false;
  return true;
}

// List open forms (for a public landing/index)
router.get('/forms', async (_req, res) => {
  const all = await FormActivation.findAll({ include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }] });
  res.json(all.filter(isOpen).map((a) => ({ slug: a.slug, title: a.title, className: a.classRoom?.name, session: a.session?.name, price: a.price })));
});

// Public form definition
router.get('/forms/:slug', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug }, include: formInclude });
  if (!a) return res.status(404).json({ error: 'Form not found' });
  if (!isOpen(a)) return res.status(403).json({ error: 'This form is currently closed', closed: true, title: a.title });
  const gw = await payment.getGateway();
  res.json({
    slug: a.slug, title: a.title, price: Number(a.price), onlinePaymentEnabled: a.onlinePaymentEnabled,
    instructionsHtml: a.instructionsHtml, session: a.session?.name, className: a.classRoom?.name,
    dob: a.dobValidationEnabled ? { min: a.dobMin, max: a.dobMax } : null,
    razorpayKeyId: gw.mock ? null : gw.keyId, mockPayment: gw.mock,
    template: a.template,
  });
});

// School identity for the portal chrome
router.get('/school-info', (_req, res) => {
  res.json({
    name: process.env.SCHOOL_NAME || 'Nirmala Convent School, Siliguri',
    address: process.env.SCHOOL_ADDRESS || '3rd Mile, Sevoke Road, Ward 42, Siliguri, West Bengal 734008',
  });
});

// School logo (public — shown on portal & designer preview)
router.get('/logo', (_req, res) => {
  const fs = require('fs');
  const path = require('path');
  for (const n of ['logo.png', 'logo.jpg']) {
    const p = path.join(__dirname, '..', 'assets', n);
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', n.endsWith('png') ? 'image/png' : 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(fs.readFileSync(p));
    }
  }
  res.status(404).end();
});

// ---------- Applicant auth (auto user id by phone) ----------
// Public login configuration (e.g. whether Google sign-in is available)
router.get('/auth/config', async (_req, res) => {
  const { getConfig } = require('../services/settings');
  const cfg = await getConfig();
  res.json({
    googleClientId: cfg.GOOGLE_CLIENT_ID || null,
    // With a client secret configured we use the reliable full-page redirect
    // flow (no popups / third-party cookies). Without it, the JS button is used.
    redirectFlow: !!(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET),
  });
});

// ---------- Google Sign-In via OAuth redirect flow (most reliable) ----------
function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

// Step 1: browser is sent to Google's account chooser (full page, no popup)
router.get('/auth/google/start', async (req, res) => {
  const { getConfig } = require('../services/settings');
  const cfg = await getConfig();
  if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET) {
    return res.status(400).send('Google login is not configured (Client ID + Client Secret needed in Settings)');
  }
  const role = req.query.role === 'admin' ? 'admin' : 'applicant';
  let next = String(req.query.next || '');
  if (!next.startsWith('/') || next.startsWith('//')) next = role === 'admin' ? '/admin' : '/';
  const state = sign({ g: 1, role, next }); // signed → tamper-proof CSRF protection
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: cfg.GOOGLE_CLIENT_ID,
    redirect_uri: baseUrl(req) + '/api/public/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString();
  res.redirect(url);
});

// Step 2: Google redirects back here with a one-time code; we exchange it
// server-to-server for the user's verified identity.
router.get('/auth/google/callback', async (req, res) => {
  const fail = (message) =>
    res.redirect('/google-done#' + Buffer.from(JSON.stringify({ error: message })).toString('base64url'));
  try {
    const { getConfig } = require('../services/settings');
    const cfg = await getConfig();
    if (req.query.error) return fail('Google sign-in was cancelled (' + req.query.error + ')');
    let st;
    try { st = verify(String(req.query.state || '')); if (!st.g) throw new Error(); }
    catch { return fail('Sign-in session expired — please try again'); }

    // Exchange the code for tokens (requires the client secret; never exposed to the browser)
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code || ''),
        client_id: cfg.GOOGLE_CLIENT_ID,
        client_secret: cfg.GOOGLE_CLIENT_SECRET,
        redirect_uri: baseUrl(req) + '/api/public/auth/google/callback',
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokens = await tr.json();
    if (!tr.ok || !tokens.id_token) {
      console.error('[google] token exchange failed:', JSON.stringify(tokens).slice(0, 300));
      return fail('Google verification failed: ' + (tokens.error_description || tokens.error || 'token exchange error'));
    }
    const vr = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokens.id_token));
    const info = await vr.json();
    if (!vr.ok || info.aud !== cfg.GOOGLE_CLIENT_ID || info.email_verified !== 'true') {
      return fail('Google account could not be verified');
    }

    let payload;
    if (st.role === 'admin') {
      const user = await AdminUser.findOne({ where: { email: info.email } });
      if (!user || !user.active) return fail(`No admin user exists for ${info.email}. Ask the owner to create one in Users.`);
      let perms = {}; try { perms = JSON.parse(user.permissions || '{}'); } catch {}
      await audit(req, 'login', { entity: 'AdminUser', entityId: user.id, summary: `${user.name} logged in (Google)`, actor: { id: user.id, name: user.name, type: 'admin' } });
      payload = {
        role: 'admin', next: st.next || '/admin',
        token: sign({ role: 'admin', id: user.id, name: user.name, adminRole: user.role || 'owner', perms }),
        name: user.name, adminRole: user.role || 'owner', perms,
      };
    } else {
      let applicant = await Applicant.findOne({ where: { googleId: info.sub } });
      if (!applicant) applicant = await Applicant.findOne({ where: { email: info.email } });
      if (!applicant) applicant = await Applicant.create({ email: info.email, name: info.name || '', googleId: info.sub });
      else await applicant.update({ googleId: info.sub, ...(applicant.name ? {} : { name: info.name || '' }) });
      payload = {
        role: 'applicant', next: st.next || '/',
        token: sign({ role: 'applicant', id: applicant.id, phone: applicant.phone || '' }),
        applicant: { id: applicant.id, phone: applicant.phone, name: applicant.name, email: applicant.email },
      };
    }
    res.redirect('/google-done#' + Buffer.from(JSON.stringify(payload)).toString('base64url'));
  } catch (e) {
    console.error('[google] callback error:', e.message);
    fail('Google sign-in failed: ' + e.message);
  }
});

// Google sign-in for applicants (account auto-created from the Google email)
router.post('/auth/google', async (req, res) => {
  try {
    const { getConfig } = require('../services/settings');
    const cfg = await getConfig();
    if (!cfg.GOOGLE_CLIENT_ID) return res.status(400).json({ error: 'Google login is not configured' });
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.body.credential || ''));
    const info = await r.json();
    if (!r.ok || info.aud !== cfg.GOOGLE_CLIENT_ID || info.email_verified !== 'true') {
      return res.status(401).json({ error: 'Google verification failed' });
    }
    let applicant = await Applicant.findOne({ where: { googleId: info.sub } });
    if (!applicant) applicant = await Applicant.findOne({ where: { email: info.email } });
    if (!applicant) applicant = await Applicant.create({ email: info.email, name: info.name || '', googleId: info.sub });
    else await applicant.update({ googleId: info.sub, ...(applicant.name ? {} : { name: info.name || '' }) });
    res.json({
      token: sign({ role: 'applicant', id: applicant.id, phone: applicant.phone || '' }),
      applicant: { id: applicant.id, phone: applicant.phone, name: applicant.name, email: applicant.email },
    });
  } catch (e) {
    res.status(500).json({ error: 'Google login failed: ' + e.message });
  }
});

router.post('/auth/request-otp', async (req, res) => {
  const { phone, email } = req.body;
  if (!/^[6-9]\d{9}$/.test(phone || '')) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  // Cryptographically secure OTP, stored only as a bcrypt hash
  const otp = String(crypto.randomInt(100000, 1000000));
  const [applicant] = await Applicant.findOrCreate({ where: { phone }, defaults: { phone } });
  const cleanEmail = String(email || '').trim();
  await applicant.update({
    otp: bcrypt.hashSync(otp, 8), otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000), otpAttempts: 0,
    ...(cleanEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ? { email: cleanEmail } : {}),
  });
  const { sendSms, sendEmail } = require('../services/notify');
  const { getConfig } = require('../services/settings');
  const cfg = await getConfig();
  // OTP SMS text must match your DLT-registered template for delivery in India.
  const otpTemplate = cfg.OTP_SMS_TEMPLATE ||
    'The one time password for your account is {{otp}}.Please use the password to verify the account. Thanks!TECHVEIN IT SOLUTIONS PVT LTD';
  // Send to BOTH channels: SMS + email (when an email is known for this applicant)
  const jobs = [sendSms(phone, otpTemplate.replace('{{otp}}', otp))];
  if (applicant.email) {
    jobs.push(sendEmail(applicant.email, 'Your admission portal OTP', `Your one time password is ${otp}. It is valid for 10 minutes. Do not share it with anyone.`));
  }
  await Promise.all(jobs);
  const devShow = String(cfg.DEV_SHOW_OTP || 'true') === 'true';
  res.json({ ok: true, sentToEmail: !!applicant.email, ...(devShow ? { devOtp: otp } : {}) });
});

router.post('/auth/verify-otp', async (req, res) => {
  const { phone, otp, name, email } = req.body;
  const applicant = await Applicant.findOne({ where: { phone } });
  if (!applicant || !applicant.otp || new Date() > new Date(applicant.otpExpiresAt)) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }
  if (applicant.otpAttempts >= 5) {
    return res.status(429).json({ error: 'Too many wrong attempts. Request a new OTP.' });
  }
  if (!bcrypt.compareSync(String(otp || ''), applicant.otp)) {
    await applicant.update({ otpAttempts: applicant.otpAttempts + 1 });
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }
  await applicant.update({ otp: null, otpAttempts: 0, ...(name ? { name: String(name).slice(0, 100) } : {}), ...(email ? { email: String(email).slice(0, 150) } : {}) });
  res.json({ token: sign({ role: 'applicant', id: applicant.id, phone }), applicant: { id: applicant.id, phone, name: applicant.name, email: applicant.email } });
});

router.use(applicantAuth);

router.get('/me', async (req, res) => {
  const a = await Applicant.findByPk(req.applicant.id);
  res.json(a);
});
router.post('/me', async (req, res) => {
  const a = await Applicant.findByPk(req.applicant.id);
  await a.update({ name: req.body.name ?? a.name, email: req.body.email ?? a.email });
  res.json(a);
});

// ---------- Secure file uploads (attachments) ----------
const ALLOWED_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5 MB max, per the form rules
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP or PDF files are allowed'));
  },
});

router.post('/uploads', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    // Sanitize filename: strip paths/special chars, force a safe extension from the real mimetype
    const base = (req.file.originalname || 'document').replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'document';
    const att = await Attachment.create({
      applicantId: req.applicant.id,
      filename: base + ALLOWED_MIME[req.file.mimetype],
      mimetype: req.file.mimetype,
      sizeBytes: req.file.size,
      sha256: require('crypto').createHash('sha256').update(req.file.buffer).digest('hex'),
      data: req.file.buffer,
    });
    res.json({ id: att.id, filename: att.filename, sizeBytes: att.sizeBytes });
  });
});

// Applicant can view their own uploaded file (ownership enforced)
router.get('/uploads/:id', async (req, res) => {
  const att = await Attachment.findOne({ where: { id: req.params.id, applicantId: req.applicant.id } });
  if (!att) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', att.mimetype);
  res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(att.data);
});

// ---------- Draft (save half-filled, edit before submission) ----------
// Link any uploaded attachments referenced in the form data to this submission
async function linkAttachments(sub, data, applicantId) {
  const ids = Object.values(data || {})
    .filter((v) => v && typeof v === 'object' && v.attachmentId)
    .map((v) => v.attachmentId);
  if (ids.length) await Attachment.update({ submissionId: sub.id }, { where: { id: ids, applicantId } });
}

// One applicant (phone number) can submit MULTIPLE applications (e.g. for
// more than one child). Only ONE in-progress draft is kept per form at a time;
// once submitted, a new draft can be started.
router.post('/forms/:slug/draft', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug } });
  if (!a || !isOpen(a)) return res.status(403).json({ error: 'Form closed' });
  let sub = await Submission.findOne({ where: { activationId: a.id, applicantId: req.applicant.id, isDraft: true } });
  if (sub) await sub.update({ data: JSON.stringify(req.body.data || {}) });
  else sub = await Submission.create({ activationId: a.id, applicantId: req.applicant.id, data: JSON.stringify(req.body.data || {}), isDraft: true });
  await linkAttachments(sub, req.body.data, req.applicant.id);
  res.json({ ok: true, id: sub.id });
});

router.get('/forms/:slug/draft', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug } });
  if (!a) return res.status(404).json({ error: 'Not found' });
  const subs = await Submission.findAll({
    where: { activationId: a.id, applicantId: req.applicant.id },
    order: [['createdAt', 'DESC']],
  });
  const draft = subs.find((x) => x.isDraft);
  res.json({
    draft: draft ? { id: draft.id, data: JSON.parse(draft.data || '{}') } : null,
    submitted: subs.filter((x) => !x.isDraft).map((x) => ({
      id: x.id, formNo: x.formNo, paymentStatus: x.paymentStatus, submittedAt: x.submittedAt,
    })),
  });
});

// ---------- Submit (with payment when enabled) ----------
async function assignFormNoAndFirstStatus(sub, a) {
  const firstStatus = await FormStatus.findOne({ where: { activationId: a.id, isFirst: true } });
  const tx = await sequelize.transaction();
  try {
    const act = await FormActivation.findByPk(a.id, { transaction: tx, lock: tx.LOCK ? tx.LOCK.UPDATE : undefined });
    const num = act.formNoNext;
    await act.update({ formNoNext: num + 1 }, { transaction: tx });
    const formNo = `${act.formNoPrefix || ''}${String(num).padStart(act.formNoPad || 4, '0')}${act.formNoSuffix || ''}`;
    await sub.update({ formNo, isDraft: false, submittedAt: new Date(), statusId: firstStatus?.id || null }, { transaction: tx });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  await StatusLog.create({ submissionId: sub.id, fromStatus: null, toStatus: firstStatus?.name || 'Submitted', changedBy: 'system' });
  if (firstStatus) {
    const applicant = await Applicant.findByPk(sub.applicantId);
    const full = await FormActivation.findByPk(a.id, { include: [{ model: ClassRoom, as: 'classRoom' }] });
    await notifyStatusChange({ submission: sub, applicant, status: firstStatus, activation: full, className: full.classRoom?.name });
  }
  return sub;
}

router.post('/forms/:slug/submit', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug } });
  if (!a || !isOpen(a)) return res.status(403).json({ error: 'Form closed' });

  // Use the current draft if one exists; otherwise start a new submission —
  // one phone number may submit multiple forms (e.g. for multiple children).
  let sub = await Submission.findOne({ where: { activationId: a.id, applicantId: req.applicant.id, isDraft: true } });
  const data = req.body.data || {};
  const errors = await validateSubmission(a, data);
  if (errors.length) return res.status(400).json({ errors });

  if (sub) await sub.update({ data: JSON.stringify(data) });
  else sub = await Submission.create({ activationId: a.id, applicantId: req.applicant.id, data: JSON.stringify(data), isDraft: true });
  await linkAttachments(sub, data, req.applicant.id);

  // Automatic screening: score the application and detect duplicates
  try {
    const [{ score, details }, flags] = await Promise.all([
      scoreSubmission(a, data),
      detectDuplicates(a, data, sub.id),
    ]);
    await sub.update({ score, scoreDetails: JSON.stringify(details), flags: JSON.stringify(flags) });
  } catch (e) { console.error('[scoring]', e.message); }

  const price = Number(a.price || 0);
  if (price > 0 && a.onlinePaymentEnabled) {
    // create payment order; submission completes after payment verification
    const order = await payment.createOrder(price, `sub_${sub.id}`);
    await Payment.create({ submissionId: sub.id, orderId: order.id, amount: price, status: 'created' });
    await sub.update({ amount: price, paymentStatus: 'pending' });
    return res.json({ requiresPayment: true, order, keyId: order.keyId, mock: order.mock, submissionId: sub.id });
  }

  await sub.update({ amount: price, paymentStatus: price > 0 ? 'pending' : 'na' });
  await assignFormNoAndFirstStatus(sub, a);
  res.json({ ok: true, formNo: sub.formNo });
});

router.post('/forms/:slug/payment/verify', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug } });
  if (!a) return res.status(404).json({ error: 'Not found' });
  const { orderId, paymentId, signature } = req.body;
  // Resolve the submission via the payment order (an applicant can have
  // several submissions on the same form, so order id is the reliable link)
  const pay = await Payment.findOne({ where: { orderId } });
  if (!pay) return res.status(400).json({ error: 'Payment order not found' });
  const sub = await Submission.findOne({ where: { id: pay.submissionId, activationId: a.id, applicantId: req.applicant.id } });
  if (!sub) return res.status(404).json({ error: 'Submission not found' });

  const gw = await payment.getGateway();
  if (!(await payment.verifySignature({ orderId, paymentId, signature }))) {
    await pay.update({ status: 'failed' });
    await sub.update({ paymentStatus: 'failed' });
    return res.status(400).json({ error: 'Payment verification failed' });
  }
  await pay.update({ status: gw.mock ? 'mock_paid' : 'paid', paymentId: paymentId || 'mock', signature: signature || null });
  await sub.update({ paymentStatus: 'paid' });
  if (sub.isDraft) await assignFormNoAndFirstStatus(sub, a);
  res.json({ ok: true, formNo: sub.formNo });
});

// ---------- Track my applications ----------
router.get('/my-submissions', async (req, res) => {
  const rows = await Submission.findAll({
    where: { applicantId: req.applicant.id },
    include: [
      { model: FormActivation, as: 'activation', include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }] },
      { model: FormStatus, as: 'status' },
      { model: Communication, as: 'communications' },
      { model: StatusLog, as: 'statusLogs' },
    ],
    order: [['updatedAt', 'DESC']],
  });
  res.json(rows.map((r) => ({
    id: r.id, formNo: r.formNo, isDraft: r.isDraft, paymentStatus: r.paymentStatus, amount: r.amount,
    submittedAt: r.submittedAt, form: r.activation?.title, slug: r.activation?.slug,
    className: r.activation?.classRoom?.name, session: r.activation?.session?.name,
    status: r.status ? { name: r.status.name, color: r.status.color } : null,
    statusLogs: r.statusLogs, communications: r.communications,
  })));
});

// ---------- Applicant downloads: form PDF & payment receipt ----------
const { drawSubmissionPdf, drawReceiptPdf } = require('../services/pdf');
const myPdfInclude = [
  { model: FormActivation, as: 'activation', include: [
    { model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' },
    { model: FormTemplate, as: 'template', include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }] },
  ]},
  { model: Applicant, as: 'applicant' },
  { model: FormStatus, as: 'status' },
  { model: Payment, as: 'payments' },
  { model: Attachment, as: 'attachments' },
];

router.get('/my-submissions/:id/pdf', async (req, res) => {
  const s = await Submission.findOne({ where: { id: req.params.id, applicantId: req.applicant.id }, include: myPdfInclude });
  if (!s || s.isDraft) return res.status(404).json({ error: 'Not found' });
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 24, bottom: 20, left: 36, right: 36 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="application-${s.formNo || s.id}.pdf"`);
  doc.pipe(res);
  drawSubmissionPdf(doc, s);
  doc.end();
});

router.get('/my-submissions/:id/receipt', async (req, res) => {
  const s = await Submission.findOne({ where: { id: req.params.id, applicantId: req.applicant.id }, include: myPdfInclude });
  if (!s || s.isDraft) return res.status(404).json({ error: 'Not found' });
  if (s.paymentStatus !== 'paid') return res.status(400).json({ error: 'No successful payment found for this form' });
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 24, bottom: 20, left: 36, right: 36 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${s.formNo || s.id}.pdf"`);
  doc.pipe(res);
  drawReceiptPdf(doc, s);
  doc.end();
});

router.post('/my-submissions/:id/communications', async (req, res) => {
  const sub = await Submission.findOne({ where: { id: req.params.id, applicantId: req.applicant.id } });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!req.body.message) return res.status(400).json({ error: 'Message required' });
  res.json(await Communication.create({ submissionId: sub.id, sender: 'applicant', channel: 'portal', message: req.body.message }));
});

module.exports = router;
