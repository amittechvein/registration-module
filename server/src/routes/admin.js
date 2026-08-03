const express = require('express');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize, AdminUser, ADMIN_PERMISSIONS, AuditLog, AcademicSession, ClassRoom,
  FormTemplate, FormSection, FormField, FormActivation, FormStatus,
  Applicant, Attachment, Submission, Payment, Communication, StatusLog, Student, STUDENT_FIELDS,
} = require('../models');
const sanitizeHtml = require('sanitize-html');
const { sign, adminAuth, requirePerm } = require('../middleware/auth');
const { notifyStatusChange } = require('../services/notify');
const { allotStudent } = require('../services/allotment');
const { audit } = require('../services/audit');

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
    await audit(req, 'login.failed', { entity: 'AdminUser', summary: `Failed login attempt for ${email || '(no email)'}`, actor: { id: null, name: email || 'unknown', type: 'admin' } });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  await audit(req, 'login', { entity: 'AdminUser', entityId: user.id, summary: `${user.name} logged in (password)`, actor: { id: user.id, name: user.name, type: 'admin' } });
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
    await audit(req, 'login', { entity: 'AdminUser', entityId: user.id, summary: `${user.name} logged in (Google)`, actor: { id: user.id, name: user.name, type: 'admin' } });
    res.json(adminToken(user));
  } catch (e) {
    res.status(500).json({ error: 'Google login failed: ' + e.message });
  }
});

router.use(adminAuth);

// ---------- Notifications (bell in the admin top bar) ----------
// New submissions + new messages from applicants, with an unseen count per admin.
router.get('/notifications', async (req, res) => {
  const me = await AdminUser.findByPk(req.admin.id, { attributes: ['id', 'notifSeenAt'] });
  const seenAt = me?.notifSeenAt ? new Date(me.notifSeenAt) : new Date(0);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000); // last 30 days

  const [subs, msgs] = await Promise.all([
    Submission.findAll({
      where: { isDraft: false, submittedAt: { [Op.gte]: since } },
      include: [{ model: Applicant, as: 'applicant' }, { model: FormActivation, as: 'activation' }],
      order: [['submittedAt', 'DESC']], limit: 15,
    }),
    Communication.findAll({
      where: { sender: 'applicant', createdAt: { [Op.gte]: since } },
      include: [{ model: Submission, include: [{ model: Applicant, as: 'applicant' }] }],
      order: [['createdAt', 'DESC']], limit: 15,
    }),
  ]);

  const items = [
    ...subs.map((s) => ({
      type: 'submission', at: s.submittedAt, submissionId: s.id,
      title: `New submission ${s.formNo || ''}`.trim(),
      body: `${s.applicant?.name || s.applicant?.phone || 'Applicant'} · ${s.activation?.title || ''}`,
    })),
    ...msgs.map((c) => ({
      type: 'message', at: c.createdAt, submissionId: c.submissionId,
      title: `Message from ${c.Submission?.applicant?.name || c.Submission?.applicant?.phone || 'applicant'}${c.Submission?.formNo ? ' · ' + c.Submission.formNo : ''}`,
      body: String(c.message || '').slice(0, 90),
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 20)
    .map((n) => ({ ...n, unseen: new Date(n.at) > seenAt }));

  res.json({ items, unseen: items.filter((n) => n.unseen).length });
});

router.post('/notifications/seen', async (req, res) => {
  await AdminUser.update({ notifSeenAt: new Date() }, { where: { id: req.admin.id } });
  res.json({ ok: true });
});

// ---------- Audit log ----------
router.get('/audit', requirePerm('audit'), async (req, res) => {
  const where = {};
  if (req.query.action) where.action = { [Op.like]: `${req.query.action}%` };
  if (req.query.q) {
    const like = { [Op.like]: `%${req.query.q}%` };
    where[Op.or] = [{ actorName: like }, { summary: like }, { action: like }, { entityId: String(req.query.q) }];
  }
  if (req.query.from) where.createdAt = { [Op.gte]: new Date(req.query.from) };
  if (req.query.to) where.createdAt = { ...(where.createdAt || {}), [Op.lte]: new Date(req.query.to + 'T23:59:59') };
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const { rows, count } = await AuditLog.findAndCountAll({ where, order: [['createdAt', 'DESC']], limit, offset });
  res.json({ rows, count, limit, offset });
});

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
  await audit(req, 'user.create', { entity: 'AdminUser', entityId: user.id, summary: `Created user ${name} (${email}) as ${user.role}` });
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
  await audit(req, 'user.update', { entity: 'AdminUser', entityId: user.id, summary: `Updated user ${user.name} (${user.email})${password ? ' — password reset' : ''}${active === false ? ' — deactivated' : ''}` });
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
  await audit(req, 'user.delete', { entity: 'AdminUser', entityId: req.params.id, summary: `Deleted user ${user.name} (${user.email})` });
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

// Save whole template (name + sections + fields) in one call.
// IMPORTANT: sections & fields are UPSERTED (ids preserved) — never
// destroy/recreate, because submission data is keyed by field id and
// recreating fields would orphan every existing submission's answers.
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
    } else {
      template = await FormTemplate.create({ name, description, active }, { transaction: tx });
    }
    const oldSections = await FormSection.findAll({
      where: { templateId: template.id },
      include: [{ model: FormField, as: 'fields' }], transaction: tx,
    });
    const validSectionIds = new Set(oldSections.map((s) => s.id));
    const validFieldIds = new Set(oldSections.flatMap((s) => s.fields.map((f) => f.id)));
    const keepSectionIds = [];
    const keepFieldIds = [];

    for (let si = 0; si < sections.length; si++) {
      const s = sections[si];
      const sPayload = { templateId: template.id, title: s.title || `Section ${si + 1}`, sortOrder: si };
      let sectionId;
      if (s.id && validSectionIds.has(Number(s.id))) {
        sectionId = Number(s.id);
        await FormSection.update(sPayload, { where: { id: sectionId }, transaction: tx });
      } else {
        sectionId = (await FormSection.create(sPayload, { transaction: tx })).id;
      }
      keepSectionIds.push(sectionId);

      for (let fi = 0; fi < (s.fields || []).length; fi++) {
        const f = s.fields[fi];
        const fPayload = {
          sectionId,
          label: f.label || `Field ${fi + 1}`,
          fieldType: f.fieldType || 'text',
          options: typeof f.options === 'string' ? f.options : JSON.stringify(f.options || []),
          required: !!f.required,
          studentField: f.studentField || null,
          validation: typeof f.validation === 'string' ? f.validation : JSON.stringify(f.validation || {}),
          autoFill: f.autoFill ? (typeof f.autoFill === 'string' ? f.autoFill : JSON.stringify(f.autoFill)) : null,
          showIf: f.showIf ? (typeof f.showIf === 'string' ? f.showIf : JSON.stringify(f.showIf)) : null,
          sortOrder: fi,
        };
        if (f.id && validFieldIds.has(Number(f.id))) {
          await FormField.update(fPayload, { where: { id: Number(f.id) }, transaction: tx });
          keepFieldIds.push(Number(f.id));
        } else {
          keepFieldIds.push((await FormField.create(fPayload, { transaction: tx })).id);
        }
      }
    }
    // remove only what the admin actually deleted in the builder
    await FormField.destroy({
      where: { sectionId: oldSections.map((s) => s.id), id: { [Op.notIn]: keepFieldIds.length ? keepFieldIds : [0] } },
      transaction: tx,
    });
    await FormSection.destroy({
      where: { templateId: template.id, id: { [Op.notIn]: keepSectionIds.length ? keepSectionIds : [0] } },
      transaction: tx,
    });
    await tx.commit();
    await audit(req, 'template.save', { entity: 'FormTemplate', entityId: template.id, summary: `${id ? 'Updated' : 'Created'} form template "${name}" (${sections.length} sections)` });
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
  // Only accept a real number — a garbled value must NOT break design lookup
  const designQ = Number(req.query.design);
  const s = {
    __designIndex: Number.isFinite(designQ) ? designQ : null,
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
    await audit(req, 'activation.save', { entity: 'FormActivation', entityId: act.id, summary: `${id ? 'Updated' : 'Created'} active form "${act.title}"` });
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
  await audit(req, 'activation.toggle', { entity: 'FormActivation', entityId: a.id, summary: `${a.active ? 'Activated' : 'Deactivated'} form "${a.title}"` });
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

router.get('/submissions', requirePerm('submissions'), async (req, res) => {
  const rows = await findSubmissions(req.query);
  // attach the student's name (from fields linked to First/Last Name)
  const tplIds = [...new Set(rows.map((r) => r.activation?.templateId).filter(Boolean))];
  const secs = tplIds.length
    ? await FormSection.findAll({ where: { templateId: tplIds }, include: [{ model: FormField, as: 'fields' }] })
    : [];
  const nameMap = {};
  for (const s of secs) {
    const m = (nameMap[s.templateId] = nameMap[s.templateId] || {});
    for (const f of s.fields) {
      if (f.studentField === 'firstName') m.fn = f.id;
      if (f.studentField === 'lastName') m.ln = f.id;
    }
  }
  res.json(rows.map((r) => {
    const j = r.toJSON();
    const m = nameMap[r.activation?.templateId] || {};
    let d = {}; try { d = JSON.parse(r.data || '{}'); } catch {}
    j.studentName = [d[m.fn], d[m.ln]].filter((x) => x && typeof x !== 'object').join(' ');
    return j;
  }));
});

// ---------- Payment reconciliation ----------
// A parent sometimes pays but their browser never returns to confirm — money
// is captured at Razorpay but the form stays a pending DRAFT. This endpoint
// asks Razorpay for the true status of every pending order and finalizes the
// forms whose payment was actually captured.
/** Run async fn over items in parallel batches (keeps requests fast enough
 *  to never hit the nginx 60s gateway timeout). */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** Collect every Razorpay payment attempt across ALL orders of a submission. */
async function collectSubmissionPayments(sub) {
  const { listOrderPayments } = require('../services/payment');
  const orders = await Payment.findAll({ where: { submissionId: sub.id }, order: [['createdAt', 'ASC']] });
  const seen = new Map();
  const errors = [];
  for (const o of orders) {
    try {
      for (const p of await listOrderPayments(o.orderId)) {
        seen.set(p.paymentId, { ...p, orderId: o.orderId, payRowId: o.id });
      }
    } catch (e) { errors.push(`${o.orderId}: ${e.message}`); }
  }
  return { orders, attempts: [...seen.values()], errors };
}

/** Apply one captured payment to a submission; all other orders → superseded. */
async function applyPaymentToSubmission(sub, attempt, orders) {
  for (const o of orders) {
    if (o.id === attempt.payRowId) await o.update({ status: 'paid', paymentId: attempt.paymentId });
    else if (!['paid', 'mock_paid'].includes(o.status)) await o.update({ status: 'superseded' });
  }
  await sub.update({ paymentStatus: 'paid' });
  if (sub.isDraft) {
    const { assignFormNoAndFirstStatus } = require('../services/finalize');
    const act = sub.activation || await FormActivation.findByPk(sub.activationId);
    await assignFormNoAndFirstStatus(sub, act);
  }
}

// Bulk reconcile: auto-fixes clear cases (exactly ONE captured payment);
// submissions with MULTIPLE captured payments are reported for manual choice
// (one of them needs a refund) — never auto-applied.
router.post('/payments/reconcile', requirePerm('status'), async (req, res) => {
  const { getGateway } = require('../services/payment');
  const gw = await getGateway();
  if (gw.mock) return res.status(400).json({ error: 'Razorpay keys are not configured in Settings' });

  const pendings = await Payment.findAll({
    where: { status: { [Op.in]: ['created', 'failed'] } },
    order: [['createdAt', 'DESC']], limit: 200,
  });
  const subIds = [...new Set(pendings.map((p) => p.submissionId).filter(Boolean))];
  const subs = await Submission.findAll({
    where: { id: subIds },
    include: [{ model: Applicant, as: 'applicant' }, { model: FormActivation, as: 'activation' }],
  });

  const results = (await inBatches(subs, 5, async (sub) => {
    const who = `${sub.formNo || 'DRAFT #' + sub.id} · ${sub.applicant?.name || sub.applicant?.phone || ''}`;
    try {
      if (sub.paymentStatus === 'paid') return null;
      const { orders, attempts, errors } = await collectSubmissionPayments(sub);
      const captured = attempts.filter((a) => a.status === 'captured');
      if (captured.length === 1) {
        await applyPaymentToSubmission(sub, captured[0], orders);
        return { id: sub.id, ok: true, fixed: true, note: `${who} → payment ${captured[0].paymentId} (${captured[0].method}) CAPTURED — marked paid, form no ${sub.formNo}` };
      }
      if (captured.length > 1) {
        return { id: sub.id, ok: false, multi: true, note: `${who} → ⚠ ${captured.length} CAPTURED payments (${captured.map((c) => c.paymentId).join(', ')}) — parent paid twice! Use the 🔄 button on this row to choose which payment to keep; refund the other in Razorpay.` };
      }
      const last = attempts.length ? attempts[attempts.length - 1].status : 'no payment attempt';
      return { id: sub.id, ok: false, note: `${who} → Razorpay says: ${last}${errors.length ? ' · ' + errors.join('; ') : ''}` };
    } catch (e) {
      return { id: sub.id, ok: false, note: `${who} → check failed: ${e.message}` };
    }
  })).filter(Boolean);
  const fixed = results.filter((r) => r.fixed).length;
  await audit(req, 'payment.reconcile', {
    entity: 'Payment',
    summary: `Payment reconciliation: ${subs.length} submission(s) checked, ${fixed} recovered & finalized`,
    details: { results: results.map((r) => r.note) },
  });
  res.json({ ok: true, checked: subs.length, fixed, results });
});

// Per-submission reconcile: returns every payment attempt; auto-applies only
// when there is exactly one captured payment, otherwise offers choices.
router.post('/submissions/:id/reconcile', requirePerm('status'), async (req, res) => {
  const { getGateway } = require('../services/payment');
  const gw = await getGateway();
  if (gw.mock) return res.status(400).json({ error: 'Razorpay keys are not configured in Settings' });
  const sub = await Submission.findByPk(req.params.id, {
    include: [{ model: Applicant, as: 'applicant' }, { model: FormActivation, as: 'activation' }],
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const { orders, attempts, errors } = await collectSubmissionPayments(sub);
  const captured = attempts.filter((a) => a.status === 'captured');
  if (sub.paymentStatus !== 'paid' && captured.length === 1) {
    await applyPaymentToSubmission(sub, captured[0], orders);
    await audit(req, 'payment.reconcile', { entity: 'Submission', entityId: sub.id, summary: `Reconciled #${sub.id}: payment ${captured[0].paymentId} applied, form no ${sub.formNo}` });
    return res.json({ applied: true, formNo: sub.formNo, attempts, errors });
  }
  res.json({ applied: false, alreadyPaid: sub.paymentStatus === 'paid', capturedCount: captured.length, attempts, errors });
});

// Admin chose WHICH captured payment to attach (the other gets refunded manually)
router.post('/submissions/:id/apply-payment', requirePerm('status'), async (req, res) => {
  const paymentId = String(req.body.paymentId || '');
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' });
  const sub = await Submission.findByPk(req.params.id, {
    include: [{ model: Applicant, as: 'applicant' }, { model: FormActivation, as: 'activation' }],
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const { orders, attempts } = await collectSubmissionPayments(sub);
  const chosen = attempts.find((a) => a.paymentId === paymentId);
  if (!chosen) return res.status(400).json({ error: 'That payment id does not belong to this submission' });
  if (chosen.status !== 'captured') return res.status(400).json({ error: `Payment ${paymentId} is not captured (status: ${chosen.status})` });
  await applyPaymentToSubmission(sub, chosen, orders);
  await audit(req, 'payment.apply', {
    entity: 'Submission', entityId: sub.id,
    summary: `Admin selected payment ${paymentId} (${chosen.method}, ₹${chosen.amount}) for ${sub.formNo || '#' + sub.id}; other captured payments to be refunded in Razorpay`,
  });
  res.json({ ok: true, formNo: sub.formNo });
});

// ---------- Payments tab: every order/payment with owner, for refund work ----------
router.get('/payments', requirePerm('submissions'), async (_req, res) => {
  const rows = await Payment.findAll({
    include: [{ model: Submission, include: [
      { model: Applicant, as: 'applicant' },
      { model: FormActivation, as: 'activation' },
    ] }],
    order: [['createdAt', 'DESC']], limit: 500,
  });
  res.json(rows.map((p) => ({
    id: p.id, orderId: p.orderId, paymentId: p.paymentId, amount: Number(p.amount || 0),
    status: p.status, createdAt: p.createdAt,
    submissionId: p.Submission?.id || null,
    formNo: p.Submission?.formNo || (p.Submission ? 'DRAFT #' + p.Submission.id : '—'),
    form: p.Submission?.activation?.title || '',
    applicant: p.Submission?.applicant?.name || '',
    phone: p.Submission?.applicant?.phone || '',
  })));
});

// Live Razorpay status for payment rows (captured / authorized / refunded / partial)
router.post('/payments/refresh', requirePerm('submissions'), async (req, res) => {
  const { fetchPaymentInfo, listOrderPayments, getGateway } = require('../services/payment');
  const gw = await getGateway();
  if (gw.mock) return res.status(400).json({ error: 'Razorpay keys are not configured in Settings' });
  const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 100);
  const rows = await Payment.findAll({ where: { id: ids } });
  const live = {};
  await inBatches(rows, 6, async (p) => {
    try {
      let info = null;
      if (p.paymentId && p.paymentId.startsWith('pay_') && p.paymentId !== 'pay_mock') {
        info = await fetchPaymentInfo(p.paymentId);
      } else {
        const items = await listOrderPayments(p.orderId);
        info = items.find((x) => x.status === 'captured') || items[items.length - 1] || { status: 'no payment attempt' };
      }
      // keep our stored status in sync with refund state
      if (info.refundStatus === 'full') await p.update({ status: 'refunded' });
      else if (info.refundStatus === 'partial') await p.update({ status: 'partial_refund' });
      live[p.id] = info;
    } catch (e) { live[p.id] = { error: e.message }; }
    return null;
  });
  res.json({ live });
});

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

// ---------- Edit form data after submission (audited, permission-gated) ----------
router.post('/submissions/:id/data', requirePerm('edit'), async (req, res) => {
  const s = await Submission.findByPk(req.params.id, {
    include: [{
      model: FormActivation, as: 'activation',
      include: [{ model: FormTemplate, as: 'template', include: [{ model: FormSection, as: 'sections', include: [{ model: FormField, as: 'fields' }] }] }],
    }],
  });
  if (!s) return res.status(404).json({ error: 'Not found' });
  const newData = req.body.data || {};
  const { applyAutoFill } = require('../services/validate');
  await applyAutoFill(s.activation, newData); // rule-computed fields stay consistent
  const oldData = JSON.parse(s.data || '{}');

  // Field-level change list for the audit trail
  const fields = (s.activation?.template?.sections || []).flatMap((sec) => sec.fields);
  const fmt = (v) => (v == null || v === '' ? '(empty)' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? (v.filename || '[file]') : String(v));
  const changes = [];
  for (const f of fields) {
    const before = fmt(oldData[f.id]);
    const after = fmt(newData[f.id]);
    if (before !== after) changes.push({ field: f.label, from: before, to: after });
  }
  if (!changes.length) return res.json({ ok: true, changed: 0 });

  await s.update({ data: JSON.stringify(newData) });
  // Re-run automatic scoring with the corrected data
  try {
    const { scoreSubmission, detectDuplicates } = require('../services/scoring');
    const [{ score, details }, flags] = await Promise.all([
      scoreSubmission(s.activation, newData),
      detectDuplicates(s.activation, newData, s.id),
    ]);
    await s.update({ score, scoreDetails: JSON.stringify(details), flags: JSON.stringify(flags) });
  } catch (e) { console.error('[scoring]', e.message); }

  await audit(req, 'submission.edit', {
    entity: 'Submission', entityId: s.id,
    summary: `Edited form ${s.formNo || '#' + s.id}: ${changes.length} field${changes.length > 1 ? 's' : ''} changed (${changes.slice(0, 3).map((c) => c.field).join(', ')}${changes.length > 3 ? '…' : ''})`,
    details: { changes },
  });
  res.json({ ok: true, changed: changes.length, changes });
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
    const out = await changeStatus(req.params.id, req.body.statusId, req.body.note, req.admin.name);
    await audit(req, 'status.change', { entity: 'Submission', entityId: out.id, summary: `Changed status of submission #${out.id} to "${out.status}"${req.body.note ? ` (note: ${req.body.note})` : ''}` });
    res.json(out);
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
  const okCount = results.filter((r) => !r.error).length;
  await audit(req, 'status.bulk', { entity: 'Submission', summary: `Bulk status change: ${okCount}/${ids.length} submissions → "${results.find((r) => !r.error)?.status || ''}"`, details: { ids, note } });
  res.json(results);
});

// ---------- Delete submissions (test data cleanup — audited) ----------
router.post('/submissions/bulk-delete', requirePerm('edit'), async (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'No submissions selected' });
  const subs = await Submission.findAll({ where: { id: ids }, attributes: ['id', 'formNo'] });
  if (!subs.length) return res.status(404).json({ error: 'Submissions not found' });
  // detach/remove dependent records first (FK safety)
  await Student.update({ submissionId: null }, { where: { submissionId: ids } });
  await Payment.destroy({ where: { submissionId: ids } });
  await Attachment.destroy({ where: { submissionId: ids } });
  await Communication.destroy({ where: { submissionId: ids } });
  await StatusLog.destroy({ where: { submissionId: ids } });
  const count = await Submission.destroy({ where: { id: ids } });
  await audit(req, 'submission.delete', {
    entity: 'Submission',
    summary: `DELETED ${count} submission(s): ${subs.map((s) => s.formNo || '#' + s.id).join(', ')}`,
    details: { ids },
  });
  res.json({ ok: true, count });
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
  await audit(req, 'message.send', { entity: 'Submission', entityId: s.id, summary: `Sent ${channel} message on ${s.formNo || '#' + s.id}: "${String(message).slice(0, 60)}"` });
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
  await audit(req, 'message.bulk', { entity: 'Submission', summary: `Bulk message to ${results.length} applicants via ${channels.join('+')}: "${String(message).slice(0, 60)}"`, details: { ids } });
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
  const sections = await FormSection.findAll({
    where: { templateId: templateIds.length ? templateIds : [0] },
    include: [{ model: FormField, as: 'fields' }],
    // columns must follow the FORM sequence: section order, then field order
    order: [['templateId', 'ASC'], ['sortOrder', 'ASC'], [{ model: FormField, as: 'fields' }, 'sortOrder', 'ASC']],
  });
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
      let cell = Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? (v.filename || '[file]') : v ?? '';
      // Excel's hard cell limit is 32,767 chars; embedded base64 blobs also bloat the file
      if (typeof cell === 'string' && cell.length > 2000) cell = cell.slice(0, 2000) + ' …[truncated]';
      row['f' + c.id] = cell;
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

// PDFs render in a worker thread with a hard timeout (see services/pdf-render.js)
// so bad data can NEVER freeze/OOM the server again — worst case the download
// is a small error-PDF and the offending form is named in the server log.
const { renderPdfBuffer } = require('../services/pdf-render');

router.get('/submissions/:id/pdf', requirePerm('export'), async (req, res) => {
  const s = await Submission.findByPk(req.params.id, { include: submissionPdfInclude });
  if (!s) return res.status(404).json({ error: 'Not found' });
  const buf = await renderPdfBuffer([s.toJSON()], { timeoutMs: 20000, label: `form ${s.formNo || '#' + s.id}` });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="form-${s.formNo || s.id}.pdf"`);
  res.send(buf);
});

router.get('/export/pdf', requirePerm('export'), async (req, res) => {
  const rows = await findSubmissions(req.query);
  const full = await Submission.findAll({ where: { id: rows.map((r) => r.id).length ? rows.map((r) => r.id) : [0] }, include: submissionPdfInclude });
  const byId = new Map(full.map((f) => [f.id, f]));
  const subs = rows.map((r) => (byId.get(r.id) || r).toJSON());
  const buf = await renderPdfBuffer(subs, { timeoutMs: Math.min(55000, 15000 + subs.length * 1500), label: `bulk export (${subs.length} forms)` });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="all-submissions.pdf"');
  res.send(buf);
});

// ---------- School logo (used in headers & PDFs) ----------
const logoUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (['image/jpeg', 'image/png'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Logo must be JPG or PNG'))),
});
router.post('/settings/logo', requirePerm('settings', 'forms'), (req, res) => {
  logoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'assets');
    fs.mkdirSync(dir, { recursive: true });
    const ext = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    for (const old of ['logo.png', 'logo.jpg']) { try { fs.unlinkSync(path.join(dir, old)); } catch {} }
    fs.writeFileSync(path.join(dir, 'logo.' + ext), req.file.buffer);
    res.json({ ok: true });
  });
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
  await audit(req, 'settings.save', { entity: 'Setting', summary: 'Updated settings (SMS/Email/Razorpay/Login)' });
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

// Send the daily Owners report immediately (for testing / on demand)
router.post('/reports/send-now', requirePerm('settings'), async (req, res) => {
  try {
    const { sendDailyReport } = require('../services/reports');
    const out = await sendDailyReport();
    await audit(req, 'report.send', { entity: 'Setting', summary: `Daily report sent manually to: ${out.sent.join(', ') || 'nobody'}` });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
