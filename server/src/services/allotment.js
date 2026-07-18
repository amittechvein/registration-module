const { FormSection, FormField, Student } = require('../models');

/**
 * When a submission is moved to the predefined "Allotted" status, insert the
 * applicant's details into the Students DB using the template's field → student-profile links.
 */
async function allotStudent({ submission, activation, applicant }) {
  const existing = await Student.findOne({ where: { submissionId: submission.id } });
  if (existing) return existing; // idempotent

  const sections = await FormSection.findAll({
    where: { templateId: activation.templateId },
    include: [{ model: FormField, as: 'fields' }],
  });
  const data = JSON.parse(submission.data || '{}');

  const student = { submissionId: submission.id, classId: activation.classId, sessionId: activation.sessionId };
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.studentField && data[field.id] != null && data[field.id] !== '') {
        student[field.studentField] = data[field.id];
      }
    }
  }
  if (!student.guardianPhone && applicant?.phone) student.guardianPhone = applicant.phone;
  if (!student.email && applicant?.email) student.email = applicant.email;
  student.admissionNo = submission.formNo;

  return Student.create(student);
}

module.exports = { allotStudent };
