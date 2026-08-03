/**
 * Finalize a submission: assign the next free form number (skipping numbers
 * already in use) and set the form's First Status, firing its notifications.
 * Used on normal payment verification AND by payment reconciliation.
 */
const { sequelize, FormActivation, FormStatus, StatusLog, Applicant, ClassRoom, Submission } = require('../models');
const { notifyStatusChange } = require('./notify');

async function assignFormNoAndFirstStatus(sub, a) {
  const firstStatus = await FormStatus.findOne({ where: { activationId: a.id, isFirst: true } });
  const tx = await sequelize.transaction();
  try {
    const act = await FormActivation.findByPk(a.id, { transaction: tx, lock: tx.LOCK ? tx.LOCK.UPDATE : undefined });
    // Skip numbers that are already used — so the counter can be reset and
    // numbering fills gaps, then jumps over existing numbers automatically.
    let num = act.formNoNext;
    let formNo;
    for (let guard = 0; guard < 10000; guard++) {
      formNo = `${act.formNoPrefix || ''}${String(num).padStart(act.formNoPad || 4, '0')}${act.formNoSuffix || ''}`;
      const clash = await Submission.findOne({ where: { activationId: act.id, formNo }, attributes: ['id'], transaction: tx });
      if (!clash) break;
      num++;
    }
    await act.update({ formNoNext: num + 1 }, { transaction: tx });
    await sub.update({ formNo, isDraft: false, submittedAt: sub.submittedAt || new Date(), statusId: firstStatus?.id || null }, { transaction: tx });
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

module.exports = { assignFormNoAndFirstStatus };
