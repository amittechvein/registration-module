const express = require('express');
const {
  sequelize, AcademicSession, ClassRoom,
  FormTemplate, FormSection, FormField, FormActivation, FormStatus,
  Applicant, Submission, Payment, Communication, StatusLog,
} = require('../models');
const { sign, applicantAuth } = require('../middleware/auth');
const { validateSubmission } = require('../services/validate');
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
  res.json({
    slug: a.slug, title: a.title, price: Number(a.price), onlinePaymentEnabled: a.onlinePaymentEnabled,
    instructionsHtml: a.instructionsHtml, session: a.session?.name, className: a.classRoom?.name,
    dob: a.dobValidationEnabled ? { min: a.dobMin, max: a.dobMax } : null,
    razorpayKeyId: payment.MOCK ? null : payment.keyId, mockPayment: payment.MOCK,
    template: a.template,
  });
});

// ---------- Applicant auth (auto user id by phone) ----------
router.post('/auth/request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!/^[6-9]\d{9}$/.test(phone || '')) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const [applicant] = await Applicant.findOrCreate({ where: { phone }, defaults: { phone } });
  await applicant.update({ otp, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) });
  const { sendSms } = require('../services/notify');
  await sendSms(phone, `Your admission portal OTP is ${otp}. Valid for 10 minutes.`);
  const devShow = String(process.env.DEV_SHOW_OTP || 'true') === 'true';
  res.json({ ok: true, ...(devShow ? { devOtp: otp } : {}) });
});

router.post('/auth/verify-otp', async (req, res) => {
  const { phone, otp, name, email } = req.body;
  const applicant = await Applicant.findOne({ where: { phone } });
  if (!applicant || applicant.otp !== otp || new Date() > new Date(applicant.otpExpiresAt)) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }
  await applicant.update({ otp: null, ...(name ? { name } : {}), ...(email ? { email } : {}) });
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

// ---------- Draft (save half-filled, edit before submission) ----------
router.post('/forms/:slug/draft', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug } });
  if (!a || !isOpen(a)) return res.status(403).json({ error: 'Form closed' });
  let sub = await Submission.findOne({ where: { activationId: a.id, applicantId: req.applicant.id } });
  if (sub && !sub.isDraft) return res.status(400).json({ error: 'Form already submitted' });
  if (sub) await sub.update({ data: JSON.stringify(req.body.data || {}) });
  else sub = await Submission.create({ activationId: a.id, applicantId: req.applicant.id, data: JSON.stringify(req.body.data || {}), isDraft: true });
  res.json({ ok: true, id: sub.id });
});

router.get('/forms/:slug/draft', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug } });
  if (!a) return res.status(404).json({ error: 'Not found' });
  const sub = await Submission.findOne({ where: { activationId: a.id, applicantId: req.applicant.id } });
  res.json(sub ? { id: sub.id, isDraft: sub.isDraft, data: JSON.parse(sub.data || '{}'), formNo: sub.formNo, paymentStatus: sub.paymentStatus } : null);
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

  let sub = await Submission.findOne({ where: { activationId: a.id, applicantId: req.applicant.id } });
  if (sub && !sub.isDraft) return res.status(400).json({ error: 'Form already submitted' });
  const data = req.body.data || {};
  const errors = await validateSubmission(a, data);
  if (errors.length) return res.status(400).json({ errors });

  if (sub) await sub.update({ data: JSON.stringify(data) });
  else sub = await Submission.create({ activationId: a.id, applicantId: req.applicant.id, data: JSON.stringify(data), isDraft: true });

  const price = Number(a.price || 0);
  if (price > 0 && a.onlinePaymentEnabled) {
    // create payment order; submission completes after payment verification
    const order = await payment.createOrder(price, `sub_${sub.id}`);
    await Payment.create({ submissionId: sub.id, orderId: order.id, amount: price, status: 'created' });
    await sub.update({ amount: price, paymentStatus: 'pending' });
    return res.json({ requiresPayment: true, order, keyId: payment.MOCK ? null : payment.keyId, mock: payment.MOCK, submissionId: sub.id });
  }

  await sub.update({ amount: price, paymentStatus: price > 0 ? 'pending' : 'na' });
  await assignFormNoAndFirstStatus(sub, a);
  res.json({ ok: true, formNo: sub.formNo });
});

router.post('/forms/:slug/payment/verify', async (req, res) => {
  const a = await FormActivation.findOne({ where: { slug: req.params.slug } });
  if (!a) return res.status(404).json({ error: 'Not found' });
  const sub = await Submission.findOne({ where: { activationId: a.id, applicantId: req.applicant.id } });
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  const { orderId, paymentId, signature } = req.body;
  const pay = await Payment.findOne({ where: { submissionId: sub.id, orderId } });
  if (!pay) return res.status(400).json({ error: 'Payment order not found' });

  if (!payment.verifySignature({ orderId, paymentId, signature })) {
    await pay.update({ status: 'failed' });
    await sub.update({ paymentStatus: 'failed' });
    return res.status(400).json({ error: 'Payment verification failed' });
  }
  await pay.update({ status: payment.MOCK ? 'mock_paid' : 'paid', paymentId: paymentId || 'mock', signature: signature || null });
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

router.post('/my-submissions/:id/communications', async (req, res) => {
  const sub = await Submission.findOne({ where: { id: req.params.id, applicantId: req.applicant.id } });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!req.body.message) return res.status(400).json({ error: 'Message required' });
  res.json(await Communication.create({ submissionId: sub.id, sender: 'applicant', channel: 'portal', message: req.body.message }));
});

module.exports = router;
