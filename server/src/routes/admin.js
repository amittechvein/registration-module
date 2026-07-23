const express = require('express');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize, AdminUser, ADMIN_PERMISSIONS, AcademicSession, ClassRoom,
  FormTemplate, FormSection, FormField, FormActivation, FormStatus,
  Applicant, Attachment, Submission, Payment, Communication, StatusLog, Student, STUDENT_FIELDS,
} = require('../models');
const sanitizeHtml = require('sanitize-html');
const { sign, adminAuth, requirePerm } = require('../middleware/auth');
const { notifyStatusChange } = require('../services/notify');
const { allotStudent } = require('../services/allotment');

const router = express.Router();

function adminToken(user) {
  let perms = {};
  try { perms = JSON.parse(user.permissions || '{}'); } catch {}
  return {
    token: sign({ role: 'admin', id: user.id, name: user.name, adminRole: user.role || 'owner', perms }),
    name: user.name, adminRole: user.role || 'owner', perms,
  };
}

// ---------- Auth ----------
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await AdminUser.findOne({ where: { email } });
  if (!user || !user.active || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json(adminToken(user));
});

// Google sign-in for admins: the Google account email must belong to an existing user
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
    const user = await AdminUser.findOne({ where: { email: info.email } });
    if (!user || !user.active) return res.status(403).json({ error: `No admin user exists for ${info.email}. Ask the owner to create one.` });
    res.json(adminToken(user));
  } catch (e) {
    res.status(500).json({ error: 'Google login failed: ' + e.message });
  }
});

router.use(adminAuth);

// ---------- User management (with privileges) ----------
router.get('/users', requirePerm('users'), async (_req, res) => {
  const users = await AdminUser.findAll({ attributes: ['id', 'name', 'email', 'role', 'permissions', 'active', 'createdAt'], order: [['createdAt', 'ASC']] });
  res.json({ users, allPermissions: ADMIN_PERMISSIONS });
});

router.post('/users', requirePerm('users'), async (req, res) => {
  const { name, email, password, role = 'staff', permissions = {} } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await AdminUser.findOne({ where: { email } })) return res.status(400).json({ error: 'A user with this email already exists' });
  const user = await AdminUser.create({
    name, email, passwordHash: bcrypt.hashSync(password, 10),
    role: role === 'owner' ? 'owner' : 'staff',
    permissions: JSON.stringify(permissions),
  });
  res.json({ ok: true, id: user.id });
});

router.post('/users/:id', requirePerm('users'), async (req, res) => {
  const user = await AdminUser.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { name, password, role, permissions, active } = req.body;
  if (role && role !== 'owner' && user.role === 'owner') {
    const owners = await AdminUser.count({ where: { role: 'owner', active: true } });
    if (owners <= 1) return res.status(400).json({ error: 'Cannot demote the last owner' });
  }
  if (active === false && user.id === req.admin.id) return res.status(400).json({ error: 'You cannot deactivate yourself' });
  await user.update({
    ...(name ? { name } : {}),
    ...(password ? { passwordHash: bcrypt.hashSync(password, 10) } : {}),
    ...(role ? { role: role === 'owner' ? 'owner' : 'staff' } : {}),
    ...(permissions ? { permissions: JSON.stringify(permissions) } : {}),
    ...(active != null ? { active } : {}),
  });
  res.json({ ok: true });
});

router.delete('/users/:id', requirePerm('users'), async (req, res) => {
  const user = await AdminUser.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.id === req.admin.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  if (user.role === 'owner') {
    const owners = await AdminUser.count({ where: { role: 'owner' } });
    if (owners <= 1) return res.status(400).json({ error: 'Cannot delete the last owner' });
  }
  await user.destroy();
  res.json({ ok: true });
});

// Any logged-in admin can change their own password
router.post('/users/me/password', async (req, res) => {
  const { current, next } = req.body;
  const user = await AdminUser.findByPk(req.admin.id);
  if (!user || !bcrypt.compareSync(current || '', user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!next || next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  await user.update({ passwordHash: bcrypt.hashSync(next, 10) });
  res.json({ ok: true });
});

// ---------- Meta ----------
router.get('/meta', requirePerm('forms', 'submissions'), async (_req, res) => {
  const [sessions, classes, templates] = await Promise.all([
    AcademicSession.findAll({ order: [['name', 'DESC']] }),
    ClassRoom.findAll({ order: [['sortOrder', 'ASC']] }),
    FormTemplate.findAll({ where: { active: true }, order: [['name', 'ASC']] }),
  ]);
  res.json({ sessions, classes, templates, studentFields: STUDENT_FIELDS });
});

router.post('/sessions', requirePerm('forms'), async (req, res) => res.json(await AcademicSession.create(req.body)));
router.post('/classes', requirePerm('forms'), async (req, res) => res.json(await ClassRoom.create(req.body)));

// ---------- Form templates (dynamic builder) ----------
router.get('/templates', requirePerm('forms'), async (_req, res) => {
  const templates = await FormTemplate.findAll({
    include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }],
    order: [['createdAt', 'DESC'], [{ model: FormSection, as: 'sections' }, 'sortOrder', 'ASC'], [{ model: FormSection, as: 'sections' }, { model: FormField, as: 'fields' }, 'sortOrder', 'ASC']],
  });
  res.json(templates);
});

router.get('/templates/:id', requirePerm('forms'), async (req, res) => {
  const t = await FormTemplate.findByPk(req.params.id, {
    include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }],
    order: [[{ model: FormSection, as: 'sections' }, 'sortOrder', 'ASC'], [{ model: FormSection, as: 'sections' }, { model: FormField, as: 'fields' }, 'sortOrder', 'ASC']],
  });
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// Save whole template (name + sections + fields) in one call
router.post('/templates', requirePerm('forms'), async (req, res) => {
  const { id, name, description, active = true, sections = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Form name is required' });
  const tx = await sequelize.transaction();
  try {
    let template;
    if (id) {
      template = await FormTemplate.findByPk(id, { transaction: tx });
      if (!template) throw new Error('Template not found');
      await template.update({ name, description, active }, { transaction: tx });
      const oldSections = await FormSection.findAll({ where: { templateId: id }, transaction: tx });
      await FormField.destroy({ where: { sectionId: oldSections.map((s) => s.id) }, transaction: tx });
      await FormSection.destroy({ where: { templateId: id }, transaction: tx });
    } else {
      template = await FormTemplate.create({ name, description, active }, { transaction: tx });
    }
    for (let si = 0; si < sections.length; si++) {
      const s = sections[si];
      const section = await FormSection.create(
        { templateId: template.id, title: s.title || `Section ${si + 1}`, sortOrder: si },
        { transaction: tx }
      );
      for (let fi = 0; fi < (s.fields || []).length; fi++) {
        const f = s.fields[fi];
        await FormField.create(
          {
            sectionId: section.id,
            label: f.label || `Field ${fi + 1}`,
            fieldType: f.fieldType || 'text',
            options: typeof f.options === 'string' ? f.options : JSON.stringify(f.options || []),
            required: !!f.required,
            studentField: f.studentField || null,
            validation: typeof f.validation === 'string' ? f.validation : JSON.stringify(f.validation || {}),
            sortOrder: fi,
          },
          { transaction: tx }
        );
      }
    }
    await tx.commit();
    res.json({ ok: true, id: template.id });
  } catch (e) {
    await tx.rollback();
    res.status(400).json({ error: e.message });
  }
});

// Save the canvas-designed PDF layout for a template
router.post('/templates/:id/layout', requirePerm('forms'), async (req, res) => {
  const t = await FormTemplate.findByPk(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  await t.update({ layout: JSON.stringify(req.body.layout || null) });
  res.json({ ok: true });
});

// Live preview of the designed layout with sample data (opens inline)
router.get('/templates/:id/preview-pdf', requirePerm('forms'), async (req, res) => {
  const t = await FormTemplate.findByPk(req.params.id, {
    include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }],
  });
  if (!t) return res.status(404).json({ error: 'Not found' });
  const sample = {};
  for (const sec of t.sections) {
    for (const f of sec.fields) {
      let opts = []; try { opts = JSON.parse(f.options || '[]'); } catch {}
      sample[f.id] =
        f.fieldType === 'date' ? '2021-06-15'
        : f.fieldType === 'number' ? '3'
        : f.fieldType === 'email' ? 'parent@example.com'
        : f.fieldType === 'phone' ? '9876543210'
        : f.fieldType === 'file' ? { attachmentId: 0, filename: 'document.jpg' }
        : ['select', 'radio', 'checkbox'].includes(f.fieldType) ? (f.fieldType === 'checkbox' ? [opts[0] || 'Yes'] : (opts[0] || 'Sample'))
        : 'Sample ' + f.label.split(' ').slice(0, 2).join(' ');
    }
  }
  const s = {
    id: 0, data: JSON.stringify(sample), formNo: 'PREVIEW-0001', submittedAt: new Date(),
    amount: 1000, paymentStatus: 'paid',
    payments: [{ status: 'paid', orderId: 'order_sample', paymentId: 'pay_sample', updatedAt: new Date() }],
    attachments: [],
    applicant: { name: 'Sample Parent', phone: '9876543210', email: 'parent@example.com' },
    status: { name: 'Submitted', color: '#2563eb' },
    activation: {
      title: t.name, pdfTemplate: req.query.style || 'custom', template: t,
      classRoom: { name: 'Nursery' }, session: { name: '2026-27' }, price: 1000,
    },
  };
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 24, bottom: 20, left: 36, right: 36 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="layout-preview.pdf"');
  doc.pipe(res);
  drawSubmissionPdf(doc, s);
  doc.end();
});

router.delete('/templates/:id', requirePerm('forms'), async (req, res) => {
  const used = await FormActivation.count({ where: { templateId: req.params.id } });
  if (used) return res.status(400).json({ error: 'Template is used by an active form; deactivate instead' });
  await FormTemplate.destroy({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Form activations ----------
const activationInclude = [
  { model: FormTemplate, as: 'template' },
  { model: AcademicSession, as: 'session' },
  { model: ClassRoom, as: 'classRoom' },
  { model: FormStatus, as: 'statuses' },
];

router.get('/activations', requirePerm('forms', 'submissions'), async (_req, res) => {
  const list = await FormActivation.findAll({ include: activationInclude, order: [['createdAt', 'DESC']] });
  res.json(list);
});

router.get('/activations/:id', requirePerm('forms'), async (req, res) => {
  const a = await FormActivation.findByPk(req.params.id, { include: activationInclude });
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Save activation + statuses table in one call
router.post('/activations', requirePerm('forms'), async (req, res) => {
  const { id, statuses = [], ...body } = req.body;
  if (!body.title || !body.templateId || !body.sessionId || !body.classId) {
    return res.status(400).json({ error: 'Title, academic session, class and form template are required' });
  }
  const firstCount = statuses.filter((s) => s.isFirst).length;
  if (statuses.length && firstCount !== 1) {
    return res.status(400).json({ error: 'Exactly one status must be marked as the First Status of the form' });
  }
  // Prevent stored XSS: instructions HTML is sanitized server-side
  body.instructionsHtml = sanitizeHtml(body.instructionsHtml || '', {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'a', 'span', 'div', 'hr', 'table', 'tr', 'td', 'th', 'thead', 'tbody'],
    allowedAttributes: { a: ['href', 'target'], '*': ['style'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  });
  const tx = await sequelize.transaction();
  try {
    let act;
    if (id) {
      act = await FormActivation.findByPk(id, { transaction: tx });
      if (!act) throw new Error('Not found');
      await act.update(body, { transaction: tx });
    } else {
      body.slug = slugify(body.title) + '-' + Math.random().toString(36).slice(2, 7);
      act = await FormActivation.create(body, { transaction: tx });
    }
    // Upsert statuses; keep existing ids so submissions don't lose their status
    const keepIds = [];
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i];
      const payload = {
        activationId: act.id, name: s.name, color: s.color || '#2563eb',
        isFirst: !!s.isFirst, isAllotted: !!s.isAllotted,
        sendNotification: !!s.sendNotification, notifySms: !!s.notifySms,
        notifyEmail: !!s.notifyEmail, notifyWhatsapp: !!s.notifyWhatsapp,
        messageTemplate: s.messageTemplate || '', sortOrder: i,
      };
      if (s.id) {
        await FormStatus.update(payload, { where: { id: s.id, activationId: act.id }, transaction: tx });
        keepIds.push(s.id);
      } else {
        const created = await FormStatus.create(payload, { transaction: tx });
        keepIds.push(created.id);
      }
    }
    await FormStatus.destroy({ where: { activationId: act.id, id: { [Op.notIn]: keepIds.length ? keepIds : [0] } }, transaction: tx });
    await tx.commit();
    res.json({ ok: true, id: act.id, slug: act.slug });
  } catch (e) {
    await tx.rollback();
    res.status(400).json({ error: e.message });
  }
});

// Quick switch of the PDF download template from the list page
router.post('/activations/:id/pdf-template', requirePerm('forms'), async (req, res) => {
  const VALID = ['modern', 'classic', 'elegant', 'card', 'mono', 'custom'];
  if (!VALID.includes(req.body.pdfTemplate)) return res.status(400).json({ error: 'Invalid template' });
  const a = await FormActivation.findByPk(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  await a.update({ pdfTemplate: req.body.pdfTemplate });
  res.json({ ok: true, pdfTemplate: a.pdfTemplate });
});

router.post('/activations/:id/toggle', requirePerm('forms'), async (req, res) => {
  const a = await FormActivation.findByPk(req.params.id, { include: [{ model: FormStatus, as: 'statuses' }] });
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!a.active && !a.statuses.some((s) => s.isFirst)) {
    return res.status(400).json({ error: 'Set a First Status before activating the form' });
  }
  await a.update({ active: !a.active });
  res.json({ ok: true, active: a.active });
});

// ---------- Submissions ----------
function buildSubmissionWhere(q) {
  const where = { isDraft: q.includeDrafts === 'true' ? { [Op.in]: [true, false] } : false };
  if (q.activationId) where.activationId = q.activationId;
  if (q.statusId) where.statusId = q.statusId;
  if (q.paymentStatus) where.paymentStatus = q.paymentStatus;
  if (q.formNo) where.formNo = { [Op.like]: `%${q.formNo}%` };
  if (q.from) where.submittedAt = { ...(where.submittedAt || {}), [Op.gte]: new Date(q.from) };
  if (q.to) where.submittedAt = { ...(where.submittedAt || {}), [Op.lte]: new Date(q.to + 'T23:59:59') };
  return where;
}

async function findSubmissions(q) {
  const where = buildSubmissionWhere(q);
  const include = [
    { model: FormActivation, as: 'activation', include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }, { model: FormTemplate, as: 'template' }] },
    { model: Applicant, as: 'applicant' },
    { model: FormStatus, as: 'status' },
  ];
  if (q.sessionId || q.classId) {
    include[0].where = {};
    if (q.sessionId) include[0].where.sessionId = q.sessionId;
    if (q.classId) include[0].where.classId = q.classId;
  }
  let rows = await Submission.findAll({ where, include, order: [['submittedAt', 'DESC'], ['updatedAt', 'DESC']] });
  // free-text search across applicant + form data values
  if (q.search) {
    const needle = q.search.toLowerCase();
    rows = rows.filter((r) => {
      const hay = [r.formNo, r.applicant?.phone, r.applicant?.name, r.applicant?.email, r.data]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  return rows;
}

router.get('/submissions', requirePerm('submissions'), async (req, res) => res.json(await findSubmissions(req.query)));

router.get('/submissions/:id', requirePerm('submissions'), async (req, res) => {
  const s = await Submission.findByPk(req.params.id, {
    include: [
      { model: FormActivation, as: 'activation', include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }, { model: FormTemplate, as: 'template', include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }] }, { model: FormStatus, as: 'statuses' }] },
      { model: Applicant, as: 'applicant' },
      { model: FormStatus, as: 'status' },
      { model: Payment, as: 'payments' },
      { model: Communication, as: 'communications' },
      { model: StatusLog, as: 'statusLogs' },
    ],
    order: [[{ model: Communication, as: 'communications' }, 'createdAt', 'ASC']],
  });
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

async function changeStatus(submissionId, statusId, note, adminName) {
  const s = await Submission.findByPk(submissionId, {
    include: [
      { model: FormActivation, as: 'activation', include: [{ model: ClassRoom, as: 'classRoom' }] },
      { model: Applicant, as: 'applicant' },
      { model: FormStatus, as: 'status' },
    ],
  });
  if (!s) throw new Error('Submission not found');
  const newStatus = await FormStatus.findOne({ where: { id: statusId, activationId: s.activationId } });
  if (!newStatus) throw new Error('Status does not belong to this form');
  const fromName = s.status?.name || null;
  await s.update({ statusId: newStatus.id });
  await StatusLog.create({ submissionId: s.id, fromStatus: fromName, toStatus: newStatus.name, note: note || null, changedBy: adminName || 'admin' });
  if (newStatus.isAllotted) {
    await allotStudent({ submission: s, activation: s.activation, applicant: s.applicant });
  }
  await notifyStatusChange({ submission: s, applicant: s.applicant, status: newStatus, activation: s.activation, className: s.activation?.classRoom?.name });
  return { id: s.id, status: newStatus.name };
}

router.post('/submissions/:id/status', requirePerm('status'), async (req, res) => {
  try {
    res.json(await changeStatus(req.params.id, req.body.statusId, req.body.note, req.admin.name));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/submissions/bulk-status', requirePerm('status'), async (req, res) => {
  const { ids = [], statusId, note } = req.body;
  const results = [];
  for (const id of ids) {
    try { results.push(await changeStatus(id, statusId, note, req.admin.name)); }
    catch (e) { results.push({ id, error: e.message }); }
  }
  res.json(results);
});

// Communication with applicant
router.post('/submissions/:id/communications', requirePerm('communicate'), async (req, res) => {
  const s = await Submission.findByPk(req.params.id, { include: [{ model: Applicant, as: 'applicant' }] });
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { message, channel = 'portal' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const comm = await Communication.create({ submissionId: s.id, sender: 'admin', channel, message });
  const { sendSms, sendEmail } = require('../services/notify');
  if (channel === 'sms') await sendSms(s.applicant?.phone, message);
  if (channel === 'email') await sendEmail(s.applicant?.email, 'Message regarding your application', message);
  res.json(comm);
});

// Bulk communication: send one message to many applicants (portal + SMS + Email)
router.post('/submissions/bulk-communications', requirePerm('communicate'), async (req, res) => {
  const { ids = [], message, channels = ['portal'] } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  if (!ids.length) return res.status(400).json({ error: 'No applicants selected' });
  const { sendSms, sendEmail } = require('../services/notify');
  const subs = await Submission.findAll({ where: { id: ids }, include: [{ model: Applicant, as: 'applicant' }] });
  const results = [];
  for (const s of subs) {
    const detail = [];
    await Communication.create({ submissionId: s.id, sender: 'admin', channel: channels.join('+') || 'portal', message });
    detail.push('portal');
    if (channels.includes('sms')) {
      const ok = await sendSms(s.applicant?.phone, message);
      detail.push('sms:' + (ok ? 'sent' : 'failed'));
    }
    if (channels.includes('email')) {
      const ok = await sendEmail(s.applicant?.email, 'Message regarding your application', message);
      detail.push('email:' + (s.applicant?.email ? (ok ? 'sent' : 'failed') : 'no-address'));
    }
    results.push({ id: s.id, formNo: s.formNo, detail });
  }
  res.json({ ok: true, count: results.length, results });
});

// ---------- Attachments (secure download, admin only) ----------
router.get('/attachments/:id', requirePerm('submissions'), async (req, res) => {
  const att = await Attachment.findByPk(req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', att.mimetype);
  res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(att.data);
});

// ---------- Exports ----------
router.get('/export/excel', requirePerm('export'), async (req, res) => {
  const rows = await findSubmissions(req.query);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Submissions');

  // union of all field labels across involved templates
  const templateIds = [...new Set(rows.map((r) => r.activation?.templateId).filter(Boolean))];
  const sections = await FormSection.findAll({ where: { templateId: templateIds.length ? templateIds : [0] }, include: [{ model: FormField, as: 'fields' }], order: [['sortOrder', 'ASC']] });
  const fieldCols = [];
  for (const sec of sections) for (const f of sec.fields) fieldCols.push({ id: f.id, label: `${f.label}` });

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
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

const { drawSubmissionPdf } = require('../services/pdf');

const submissionPdfInclude = [
  { model: FormActivation, as: 'activation', include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }, { model: FormTemplate, as: 'template', include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }] }] },
  { model: Applicant, as: 'applicant' },
  { model: FormStatus, as: 'status' },
  { model: Payment, as: 'payments' },
  { model: Attachment, as: 'attachments' },
];

router.get('/submissions/:id/pdf', requirePerm('export'), async (req, res) => {
  const s = await Submission.findByPk(req.params.id, { include: submissionPdfInclude });
  if (!s) return res.status(404).json({ error: 'Not found' });
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 24, bottom: 20, left: 36, right: 36 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="form-${s.formNo || s.id}.pdf"`);
  doc.pipe(res);
  drawSubmissionPdf(doc, s);
  doc.end();
});

router.get('/export/pdf', requirePerm('export'), async (req, res) => {
  const rows = await findSubmissions(req.query);
  const full = await Submission.findAll({ where: { id: rows.map((r) => r.id).length ? rows.map((r) => r.id) : [0] }, include: submissionPdfInclude });
  const byId = new Map(full.map((f) => [f.id, f]));
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 24, bottom: 20, left: 36, right: 36 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="all-submissions.pdf"');
  doc.pipe(res);
  rows.forEach((r, i) => {
    if (i > 0) doc.addPage();
    drawSubmissionPdf(doc, byId.get(r.id) || r);
  });
  if (!rows.length) doc.fontSize(12).text('No submissions match the selected filters.');
  doc.end();
});

// ---------- Settings (SMS / Email / Razorpay) ----------
const settingsService = require('../services/settings');

router.get('/settings', requirePerm('settings'), async (_req, res) => {
  res.json(await settingsService.listForAdmin());
});

router.post('/settings', requirePerm('settings'), async (req, res) => {
  await settingsService.saveFromAdmin(req.body.settings || {});
  const { getGateway } = require('../services/payment');
  const gw = await getGateway();
  res.json({ ok: true, razorpayMode: gw.mock ? 'mock' : (gw.keyId || '').startsWith('rzp_live') ? 'live' : 'test' });
});

router.post('/settings/test-sms', requirePerm('settings'), async (req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  const { sendSms } = require('../services/notify');
  const ok = await sendSms(phone, 'Test message from your admission portal settings. If you received this, SMS is working.');
  const cfg = await settingsService.getConfig();
  const provider = cfg.INFOBIP_USERNAME ? 'Infobip' : cfg.MSG91_AUTH_KEY ? 'MSG91' : 'console (no provider configured)';
  res.json({ ok, provider, note: ok ? `Sent via ${provider}` : `Failed via ${provider} — check credentials / server logs` });
});

router.post('/settings/test-email', requirePerm('settings'), async (req, res) => {
  const to = String(req.body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid email address' });
  const { sendEmail } = require('../services/notify');
  const ok = await sendEmail(to, 'Test email from admission portal', 'If you received this, email settings are working.');
  const cfg = await settingsService.getConfig();
  const provider = cfg.SMTP_HOST ? `SMTP (${cfg.SMTP_HOST})` : 'console (no SMTP configured)';
  res.json({ ok, provider, note: ok ? `Sent via ${provider}` : `Failed via ${provider} — check credentials / server logs` });
});

router.get('/settings/status', requirePerm('settings'), async (_req, res) => {
  const { getGateway } = require('../services/payment');
  const gw = await getGateway();
  const cfg = await settingsService.getConfig();
  res.json({
    razorpay: gw.mock ? { mode: 'mock' } : { mode: (gw.keyId || '').startsWith('rzp_live') ? 'live' : 'test', keyId: gw.keyId },
    sms: cfg.INFOBIP_USERNAME ? 'Infobip' : cfg.MSG91_AUTH_KEY ? 'MSG91' : 'not configured (console)',
    email: cfg.SMTP_HOST ? `SMTP: ${cfg.SMTP_HOST}` : 'not configured (console)',
    devShowOtp: String(cfg.DEV_SHOW_OTP || 'true') === 'true',
  });
});

// ---------- Dashboard summary ----------
router.get('/dashboard', async (_req, res) => {
  const [totalSubmitted, totalDrafts, paid, students] = await Promise.all([
    Submission.count({ where: { isDraft: false } }),
    Submission.count({ where: { isDraft: true } }),
    Submission.sum('amount', { where: { isDraft: false, paymentStatus: 'paid' } }),
    Student.count(),
  ]);
  const activations = await FormActivation.findAll({
    include: [
      { model: ClassRoom, as: 'classRoom' },
      { model: AcademicSession, as: 'session' },
      { model: FormStatus, as: 'statuses' },
      { model: Submission, as: 'submissions', include: [{ model: FormStatus, as: 'status' }] },
    ],
  });
  const perForm = activations.map((a) => {
    const subs = a.submissions.filter((s) => !s.isDraft);
    const byStatus = {};
    for (const st of a.statuses) byStatus[st.name] = { count: 0, color: st.color };
    for (const s of subs) if (s.status) (byStatus[s.status.name] ||= { count: 0, color: s.status.color }).count++;
    return {
      id: a.id, title: a.title, active: a.active, slug: a.slug,
      className: a.classRoom?.name, session: a.session?.name,
      submitted: subs.length,
      drafts: a.submissions.length - subs.length,
      collected: subs.filter((s) => s.paymentStatus === 'paid').reduce((t, s) => t + Number(s.amount || 0), 0),
      byStatus,
    };
  });
  const recent = await Submission.findAll({
    where: { isDraft: false }, limit: 10, order: [['submittedAt', 'DESC']],
    include: [{ model: Applicant, as: 'applicant' }, { model: FormStatus, as: 'status' }, { model: FormActivation, as: 'activation' }],
  });
  res.json({ totals: { totalSubmitted, totalDrafts, feeCollected: Number(paid || 0), studentsAllotted: students }, perForm, recent });
});

// Students created via allotment
router.get('/students', requirePerm('students'), async (_req, res) => {
  const list = await Student.findAll({ include: [{ model: ClassRoom, as: 'classRoom' }, { model: AcademicSession, as: 'session' }], order: [['createdAt', 'DESC']] });
  res.json(list);
});

module.exports = router;
