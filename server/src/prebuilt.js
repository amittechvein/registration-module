/**
 * Pre-built form: "Nursery Application Form (2026-27)" recreated from the
 * school's applicant PDF. Created automatically at server start if missing,
 * and activated for Nursery, session 2026-27, fee ₹1000 with online payment.
 */
const { FormTemplate, FormSection, FormField, FormActivation, FormStatus, AcademicSession, ClassRoom } = require('./models');

const f = (label, fieldType = 'text', extra = {}) => ({ label, fieldType, ...extra });

const SECTIONS = [
  { title: 'Student Personal Details', fields: [
    f('First Name', 'text', { required: true, studentField: 'firstName' }),
    f('Middle Name'),
    f('Last Name', 'text', { studentField: 'lastName' }),
    f('Date of Birth', 'date', { required: true, studentField: 'dob' }),
    f('Gender', 'radio', { required: true, options: ['Male', 'Female'], studentField: 'gender' }),
    f('Nationality', 'text', { required: true, studentField: 'nationality' }),
    f('Student Category', 'select', { required: true, options: ['GENERAL', 'OBC', 'SC', 'ST', 'EWS'], studentField: 'category' }),
    f('Religion', 'select', { options: ['HINDU', 'MUSLIM', 'CHRISTIAN', 'SIKH', 'JAIN', 'BUDDHIST', 'OTHER'], studentField: 'religion' }),
    f('Blood Group', 'select', { options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Not Known'], studentField: 'bloodGroup' }),
    f('Birth Place'),
    f('Mother Tongue'),
  ]},
  { title: 'Student Communication Details', fields: [
    f('Address Line 1', 'text', { required: true, studentField: 'address' }),
    f('Address Line 2'),
    f('City', 'text', { required: true, studentField: 'city' }),
    f('State', 'text', { required: true, studentField: 'state' }),
    f('Pin Code', 'text', { required: true, studentField: 'pincode', validation: { regex: '^\\d{6}$', regexMessage: 'Pin Code must be 6 digits' } }),
    f('Country', 'text', { required: true }),
    f('Mobile / WhatsApp No.', 'phone', { required: true, studentField: 'guardianPhone' }),
    f('E-mail', 'email', { studentField: 'email' }),
  ]},
  { title: 'Previous Institution Details', fields: [
    f('Institution Name', 'text', { studentField: 'previousSchool' }),
    f('Date Last Attended', 'date'), f('Place'), f('State'),
  ]},
  { title: "Father's Personal Details", fields: [
    f("Father's Name", 'text', { required: true, studentField: 'fatherName' }),
    f("Father's Date of Birth", 'date'), f('Education'), f('Occupation'), f('Occupation Code'),
  ]},
  { title: "Father's Contact Details", fields: [
    f('Office Address', 'textarea'), f('City'), f('State'), f('Country'), f('Office Contact No'),
    f('Mobile No (10 digits WhatsApp No)', 'phone', { required: true }), f('Email', 'email'),
  ]},
  { title: "Mother's Personal Details", fields: [
    f("Mother's Name", 'text', { required: true, studentField: 'motherName' }),
    f("Mother's Date of Birth", 'date'), f('Education'), f('Occupation'), f('Occupation Code'),
  ]},
  { title: "Mother's Contact Details", fields: [
    f('Office Address', 'textarea'), f('City'), f('State'), f('Country'),
    f('Mobile No (10 digits WhatsApp No)', 'phone'), f('Email', 'email'),
  ]},
  { title: 'Additional Details', fields: [
    f('Residence Distance from School (in km)', 'number', { validation: { min: 0, max: 200 } }),
    f('Residence Locality Code (Select any one)', 'select', { options: ['A', 'B', 'C', 'D'] }),
    f('Second Language'),
    f('Does the Applicant have a real sister studying in this School?', 'radio', { required: true, options: ['YES', 'NO'] }),
    f('If Yes then Class'), f('Section'), f('Registration/Admission No'),
    f('If the mother of the Girl was a Student of this School', 'radio', { options: ['YES', 'NO'] }),
  ]},
  { title: 'Attachments', fields: [
    f('Birth Certificate', 'file', { required: true }),
    f('Address proof of the parents (Aadhar Card / Electricity Bill / Gas Connection)', 'file', { required: true }),
    f('Recent Photograph of Parents with the Child', 'file', { required: true }),
  ]},
  { title: 'Declaration', fields: [
    f('I/We hereby declare that the above information provided by me/us is correct & I/We understand that if the information is found to be incorrect or false, my/our ward shall be automatically debarred from selection/admission process without any correspondence', 'checkbox', { required: true, options: ['I AGREE'] }),
    f('I agree to paste recent postcard size photograph of the Family (Father, Mother and child) on the last page of printed Application Form', 'checkbox', { required: true, options: ['I AGREE'] }),
  ]},
];

const INSTRUCTIONS = `<h3>Nursery Application — Instructions</h3><ul><li>Fill all sections carefully. Fields marked * are mandatory.</li><li>Upload the child's <b>Birth Certificate</b>, <b>address proof of parents</b> (Aadhaar / Electricity Bill / Gas Connection) and a <b>recent photograph of parents with the child</b> in the Attachments section (JPG/PNG/PDF, max 5 MB each).</li><li>Registration fee: <b>₹1000</b>, payable online at the time of submission.</li><li>Use the same mobile number to log in later and track your application status.</li><li>Paste a recent postcard-size photograph of the family on the last page of the printed application form.</li></ul>`;

const STATUSES = [
  { name: 'Submitted', color: '#2563eb', isFirst: true, sendNotification: true, notifySms: true, notifyEmail: true, sortOrder: 0,
    messageTemplate: 'Dear {{name}}, application {{form_no}} for {{class}} has been submitted successfully. Track status with your mobile number.' },
  { name: 'Under Review', color: '#d97706', sortOrder: 1 },
  { name: 'Shortlisted', color: '#7c3aed', sendNotification: true, notifySms: true, notifyEmail: true, sortOrder: 2,
    messageTemplate: 'Dear {{name}}, application {{form_no}}: your ward is shortlisted for {{class}}.' },
  { name: 'Allotted', color: '#16a34a', isAllotted: true, sendNotification: true, notifySms: true, notifyEmail: true, sortOrder: 3,
    messageTemplate: 'Congratulations {{name}}! Application {{form_no}}: seat allotted in {{class}}. Further details will follow.' },
  { name: 'Rejected', color: '#dc2626', sortOrder: 4 },
];

async function ensurePrebuiltForms() {
  const TEMPLATE_NAME = 'Nursery Application Form (2026-27)';
  let template = await FormTemplate.findOne({ where: { name: TEMPLATE_NAME } });
  if (!template) {
    template = await FormTemplate.create({ name: TEMPLATE_NAME, description: 'Pre-built from the school applicant PDF', active: true });
    for (let si = 0; si < SECTIONS.length; si++) {
      const s = SECTIONS[si];
      const section = await FormSection.create({ templateId: template.id, title: s.title, sortOrder: si });
      for (let fi = 0; fi < s.fields.length; fi++) {
        const fld = s.fields[fi];
        await FormField.create({
          sectionId: section.id, label: fld.label, fieldType: fld.fieldType,
          options: JSON.stringify(fld.options || []), required: !!fld.required,
          studentField: fld.studentField || null, validation: JSON.stringify(fld.validation || {}), sortOrder: fi,
        });
      }
    }
    console.log('Pre-built template created: ' + TEMPLATE_NAME);
  }

  const ACT_TITLE = 'Nursery Registration 2026-27';
  let act = await FormActivation.findOne({ where: { title: ACT_TITLE } });
  if (!act) {
    const session = await AcademicSession.findOne({ where: { name: '2026-27' } });
    const nursery = await ClassRoom.findOne({ where: { name: 'Nursery' } });
    if (!session || !nursery) return;
    act = await FormActivation.create({
      title: ACT_TITLE, slug: 'nursery-registration-2026-27',
      templateId: template.id, sessionId: session.id, classId: nursery.id,
      price: 1000, onlinePaymentEnabled: true, dobValidationEnabled: false,
      formNoPrefix: 'NUR-', formNoSuffix: '/27', formNoPad: 5,
      instructionsHtml: INSTRUCTIONS, active: true,
    });
    for (const st of STATUSES) await FormStatus.create({ activationId: act.id, ...st });
    console.log('Pre-built form activated → public URL path: /form/' + act.slug);
  }
}

module.exports = { ensurePrebuiltForms };
