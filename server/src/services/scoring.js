const { FormSection, FormField, Submission, Applicant } = require('../models');
const { Op } = require('sequelize');

/**
 * Automatic application scoring + duplicate detection.
 *
 * Rule-based algorithm that reads the submitted answers and computes an
 * admission-priority score (0–100) the moment a form is submitted, so the
 * admin can sort/shortlist automatically instead of reading every form.
 *
 * Rules (auto-detected from field labels, works with any template):
 *  - Distance from school (km):   ≤2km +30 · ≤5km +20 · ≤10km +10
 *  - Sibling (real sister/brother) studying here: YES +25
 *  - Parent (mother) ex-student of the school:    YES +15
 *  - Residence locality code:     A +10 · B +7 · C +4
 *  - Form completeness:           up to +10 (share of optional fields filled)
 *  - Attachments all uploaded:    +10
 */
async function scoreSubmission(activation, data) {
  const sections = await FormSection.findAll({
    where: { templateId: activation.templateId },
    include: [{ model: FormField, as: 'fields' }],
  });
  const details = [];
  let score = 0;

  const allFields = sections.flatMap((s) => s.fields);
  const val = (f) => data[f.id];
  const yes = (v) => String(v || '').trim().toUpperCase() === 'YES';

  for (const f of allFields) {
    const label = f.label.toLowerCase();
    const v = val(f);
    if (v == null || v === '') continue;

    if (label.includes('distance')) {
      const km = parseFloat(v);
      if (!Number.isNaN(km)) {
        const pts = km <= 2 ? 30 : km <= 5 ? 20 : km <= 10 ? 10 : 0;
        if (pts) { score += pts; details.push(`Distance ${km} km: +${pts}`); }
      }
    }
    if (label.includes('sister') || label.includes('brother') || label.includes('sibling')) {
      if (yes(v) && !details.some((d) => d.startsWith('Sibling'))) { score += 25; details.push('Sibling in school: +25'); }
    }
    if (label.includes('mother') && (label.includes('student of this school') || label.includes('alumna'))) {
      if (yes(v)) { score += 15; details.push('Mother is ex-student: +15'); }
    }
    if (label.includes('locality')) {
      const code = String(v).trim().toUpperCase();
      const pts = { A: 10, B: 7, C: 4 }[code] || 0;
      if (pts) { score += pts; details.push(`Locality ${code}: +${pts}`); }
    }
  }

  // Completeness of optional fields
  const optional = allFields.filter((f) => !f.required && f.fieldType !== 'file');
  if (optional.length) {
    const filled = optional.filter((f) => { const v = val(f); return v != null && v !== '' && !(Array.isArray(v) && !v.length); }).length;
    const pts = Math.round((filled / optional.length) * 10);
    if (pts) { score += pts; details.push(`Form completeness ${filled}/${optional.length} optional fields: +${pts}`); }
  }

  // All required attachments uploaded
  const fileFields = allFields.filter((f) => f.fieldType === 'file');
  if (fileFields.length && fileFields.every((f) => val(f) && typeof val(f) === 'object' && val(f).attachmentId)) {
    score += 10; details.push('All documents uploaded: +10');
  }

  return { score: Math.min(100, score), details };
}

/**
 * Duplicate detection: flags submissions in the same form whose child
 * first-name + date-of-birth match an earlier submission (typical double entry
 * from a second phone number).
 */
async function detectDuplicates(activation, data, ownSubmissionId) {
  const sections = await FormSection.findAll({
    where: { templateId: activation.templateId },
    include: [{ model: FormField, as: 'fields' }],
  });
  const allFields = sections.flatMap((s) => s.fields);
  const nameField = allFields.find((f) => f.studentField === 'firstName');
  const dobField = allFields.find((f) => f.studentField === 'dob');
  if (!nameField || !dobField) return [];
  const name = String(data[nameField.id] || '').trim().toLowerCase();
  const dob = String(data[dobField.id] || '').trim();
  if (!name || !dob) return [];

  const others = await Submission.findAll({
    where: { activationId: activation.id, isDraft: false, id: { [Op.ne]: ownSubmissionId || 0 } },
    include: [{ model: Applicant, as: 'applicant' }],
  });
  const flags = [];
  for (const o of others) {
    const od = JSON.parse(o.data || '{}');
    if (String(od[nameField.id] || '').trim().toLowerCase() === name && String(od[dobField.id] || '').trim() === dob) {
      flags.push(`Possible duplicate of form ${o.formNo || '#' + o.id} (${o.applicant?.phone || 'unknown phone'}) — same child name & date of birth`);
    }
  }
  return flags;
}

module.exports = { scoreSubmission, detectDuplicates };
