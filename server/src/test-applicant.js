/**
 * Test applicant for trying settings on the LIVE system without touching real
 * parents — run ON THE SERVER:
 *
 *   cd /opt/registration/server
 *   node src/test-applicant.js create <your-mobile> <your-email> [activationId]
 *   node src/test-applicant.js remove <your-mobile>
 *
 * create: makes an applicant "TEST PARENT" with your mobile/email and one
 *         submitted form numbered TEST-0001 (outside the real NUR-… sequence,
 *         so real numbering is untouched), student "Test Student", first status
 *         of the form, payment marked paid (₹0, no Razorpay record).
 *         Log in at https://form.techvein.org/track with that mobile (OTP by
 *         SMS) to see it as a parent; in admin, search "TEST" to find it.
 * remove: deletes that applicant's TEST-… submissions (messages, status logs,
 *         attachments) and the applicant if nothing real is attached to it.
 *
 * Refuses to touch a mobile number that belongs to a real applicant.
 */
require('dotenv').config();
const {
  sequelize, Applicant, Submission, FormActivation, FormStatus, FormTemplate, FormSection, FormField,
  StatusLog, Communication, Payment, Attachment, AuditLog,
} = require('./models');

const TEST_PREFIX = 'TEST-';
const [cmd, phoneArg, emailArg, activationArg] = process.argv.slice(2);
const phone = String(phoneArg || '').replace(/\D/g, '').slice(-10);

async function audit(action, summary) {
  try { await AuditLog.create({ actorType: 'system', actorName: 'test-applicant.js (server console)', action, entity: 'Submission', summary }); } catch {}
}

async function create() {
  const email = String(emailArg || '').trim();
  if (phone.length !== 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: create <10-digit mobile> <email> [activationId]');

  const existing = await Applicant.findOne({ where: { phone } });
  if (existing && !/^TEST PARENT/i.test(existing.name || '')) {
    throw new Error(`Mobile ${phone} already belongs to a REAL applicant "${existing.name}" — use a different number.`);
  }
  const activation = activationArg
    ? await FormActivation.findByPk(activationArg)
    : await FormActivation.findOne({ order: [['createdAt', 'DESC']] });
  if (!activation) throw new Error('No active form found — pass an activationId');
  const firstStatus = await FormStatus.findOne({ where: { activationId: activation.id, isFirst: true } })
    || await FormStatus.findOne({ where: { activationId: activation.id }, order: [['id', 'ASC']] });

  // student name fields of this form's template
  const sections = await FormSection.findAll({ where: { templateId: activation.templateId }, include: [{ model: FormField, as: 'fields' }] });
  const data = {};
  for (const sec of sections) for (const f of sec.fields) {
    if (f.studentField === 'firstName') data[f.id] = 'Test';
    if (f.studentField === 'lastName') data[f.id] = 'Student';
  }

  const applicant = existing || await Applicant.create({ phone, name: 'TEST PARENT (delete after testing)', email });
  if (existing && existing.email !== email) await existing.update({ email });

  // next free TEST-000n for this form
  let n = 1, formNo;
  for (;;) {
    formNo = `${TEST_PREFIX}${String(n).padStart(4, '0')}`;
    if (!(await Submission.findOne({ where: { activationId: activation.id, formNo }, attributes: ['id'] }))) break;
    n++;
  }
  const sub = await Submission.create({
    applicantId: applicant.id, activationId: activation.id, formNo, data: JSON.stringify(data),
    isDraft: false, submittedAt: new Date(), amount: 0, paymentStatus: 'paid', statusId: firstStatus?.id || null,
  });
  await StatusLog.create({ submissionId: sub.id, fromStatus: null, toStatus: firstStatus?.name || 'Submitted', note: 'test entry created from server console', changedBy: 'system' });
  await Communication.create({ submissionId: sub.id, sender: 'system', channel: 'portal', message: 'This is a TEST application created for checking portal settings. It will be removed after testing.' });
  await audit('test.create', `Created TEST applicant ${phone} / ${email} with form ${formNo} on "${activation.title}"`);

  console.log('DONE — test applicant ready');
  console.log(`  Form         : ${activation.title} (activation #${activation.id})`);
  console.log(`  Form No      : ${formNo}   (submission #${sub.id}, status "${firstStatus?.name || '—'}")`);
  console.log(`  Parent login : https://form.techvein.org/track  →  mobile ${phone} (OTP by SMS)`);
  console.log(`  Email target : ${email}`);
  console.log(`  In admin     : Submissions → Search "TEST" → tick it → Apply Status / Send Email / Notices PDF`);
  console.log(`  Remove later : node src/test-applicant.js remove ${phone}`);
}

async function remove() {
  if (phone.length !== 10) throw new Error('Usage: remove <10-digit mobile>');
  const applicant = await Applicant.findOne({ where: { phone } });
  if (!applicant) { console.log('No applicant with that mobile — nothing to do.'); return; }
  if (!/^TEST PARENT/i.test(applicant.name || '')) throw new Error(`Mobile ${phone} belongs to a REAL applicant "${applicant.name}" — refusing.`);
  const subs = await Submission.findAll({ where: { applicantId: applicant.id } });
  const test = subs.filter((s) => String(s.formNo || '').startsWith(TEST_PREFIX) || s.isDraft);
  const tx = await sequelize.transaction();
  try {
    for (const s of test) {
      await Communication.destroy({ where: { submissionId: s.id }, transaction: tx });
      await StatusLog.destroy({ where: { submissionId: s.id }, transaction: tx });
      await Payment.destroy({ where: { submissionId: s.id }, transaction: tx });
      await Attachment.destroy({ where: { submissionId: s.id }, transaction: tx });
      await s.destroy({ transaction: tx });
    }
    const left = subs.length - test.length;
    if (!left) await applicant.destroy({ transaction: tx });
    await tx.commit();
    await audit('test.remove', `Removed ${test.length} TEST submission(s) for ${phone}${left ? '' : ' and the test applicant'}`);
    console.log(`DONE — removed ${test.length} test submission(s)${left ? ` (applicant kept: ${left} non-test submission(s) remain)` : ' and the test applicant'}.`);
  } catch (e) { await tx.rollback(); throw e; }
}

(async () => {
  if (cmd === 'create') await create();
  else if (cmd === 'remove') await remove();
  else { console.log('Usage:\n  node src/test-applicant.js create <mobile> <email> [activationId]\n  node src/test-applicant.js remove <mobile>'); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
