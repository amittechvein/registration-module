/**
 * One-time setup: creates the "Nursery Application Form" template (based on the
 * Nirmala Convent School applicant PDF) and activates it for Nursery, 2026-27, ₹1000.
 *
 * Run from your PC:   node setup-nursery-form.js
 * (Requires Node 18+. Running it twice creates a duplicate — run once.)
 */

const API = 'https://registration-api-uxse.onrender.com/api';
const ADMIN_EMAIL = 'admin@school.com';
const ADMIN_PASSWORD = 'admin123'; // change here if you changed the admin password

const f = (label, fieldType = 'text', extra = {}) => ({ label, fieldType, ...extra });

const SECTIONS = [
  {
    title: 'Student Personal Details',
    fields: [
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
    ],
  },
  {
    title: 'Student Communication Details',
    fields: [
      f('Address Line 1', 'text', { required: true, studentField: 'address' }),
      f('Address Line 2'),
      f('City', 'text', { required: true, studentField: 'city' }),
      f('State', 'text', { required: true, studentField: 'state' }),
      f('Pin Code', 'text', { required: true, studentField: 'pincode', validation: { regex: '^\\d{6}$', regexMessage: 'Pin Code must be 6 digits' } }),
      f('Country', 'text', { required: true }),
      f('Mobile / WhatsApp No.', 'phone', { required: true, studentField: 'guardianPhone' }),
      f('E-mail', 'email', { studentField: 'email' }),
    ],
  },
  {
    title: 'Previous Institution Details',
    fields: [
      f('Institution Name', 'text', { studentField: 'previousSchool' }),
      f('Date Last Attended', 'date'),
      f('Place'),
      f('State'),
    ],
  },
  {
    title: "Father's Personal Details",
    fields: [
      f("Father's Name", 'text', { required: true, studentField: 'fatherName' }),
      f("Father's Date of Birth", 'date'),
      f('Education'),
      f('Occupation'),
      f('Occupation Code'),
    ],
  },
  {
    title: "Father's Contact Details",
    fields: [
      f('Office Address', 'textarea'),
      f('City'),
      f('State'),
      f('Country'),
      f('Office Contact No'),
      f('Mobile No (10 digits WhatsApp No)', 'phone', { required: true }),
      f('Email', 'email'),
    ],
  },
  {
    title: "Mother's Personal Details",
    fields: [
      f("Mother's Name", 'text', { required: true, studentField: 'motherName' }),
      f("Mother's Date of Birth", 'date'),
      f('Education'),
      f('Occupation'),
      f('Occupation Code'),
    ],
  },
  {
    title: "Mother's Contact Details",
    fields: [
      f('Office Address', 'textarea'),
      f('City'),
      f('State'),
      f('Country'),
      f('Mobile No (10 digits WhatsApp No)', 'phone'),
      f('Email', 'email'),
    ],
  },
  {
    title: 'Additional Details',
    fields: [
      f('Residence Distance from School (in km)', 'number', { validation: { min: 0, max: 200 } }),
      f('Residence Locality Code (Select any one)', 'select', { options: ['A', 'B', 'C', 'D'] }),
      f('Second Language'),
      f('Does the Applicant have a real sister studying in this School?', 'radio', { required: true, options: ['YES', 'NO'] }),
      f('If Yes then Class'),
      f('Section'),
      f('Registration/Admission No'),
      f('If the mother of the Girl was a Student of this School', 'radio', { options: ['YES', 'NO'] }),
    ],
  },
  {
    title: 'Attachments',
    fields: [
      f('Birth Certificate', 'file', { required: true }),
      f('Address proof of the parents (Aadhar Card / Electricity Bill / Gas Connection)', 'file', { required: true }),
      f('Recent Photograph of Parents with the Child', 'file', { required: true }),
    ],
  },
  {
    title: 'Declaration',
    fields: [
      f('I/We hereby declare that the above information provided by me/us is correct & I/We understand that if the information is found to be incorrect or false, my/our ward shall be automatically debarred from selection/admission process without any correspondence', 'checkbox', { required: true, options: ['I AGREE'] }),
      f('I agree to paste recent postcard size photograph of the Family (Father, Mother and child) on the last page of printed Application Form', 'checkbox', { required: true, options: ['I AGREE'] }),
    ],
  },
];

const INSTRUCTIONS = `
<h3>Nursery Application — Instructions</h3>
<ul>
<li>Fill all sections carefully. Fields marked * are mandatory.</li>
<li>Keep the child's <b>Birth Certificate</b>, <b>address proof of parents</b> (Aadhaar Card / Electricity Bill / Gas Connection) and a <b>recent photograph of parents with the child</b> ready — these must be submitted to the school office after form submission.</li>
<li>Registration fee: <b>₹1000</b>, payable online at the time of submission.</li>
<li>Use the same mobile number to log in later and track your application status.</li>
<li>Paste a recent postcard-size photograph of the family on the last page of the printed application form.</li>
</ul>`;

const STATUSES = [
  { name: 'Submitted', color: '#2563eb', isFirst: true, sendNotification: true, notifySms: true, notifyEmail: true, messageTemplate: 'Dear {{name}}, application {{form_no}} for {{class}} has been submitted successfully. Track status with your mobile number.' },
  { name: 'Under Review', color: '#d97706' },
  { name: 'Shortlisted', color: '#7c3aed', sendNotification: true, notifySms: true, notifyEmail: true, messageTemplate: 'Dear {{name}}, application {{form_no}}: your ward is shortlisted for {{class}}.' },
  { name: 'Allotted', color: '#16a34a', isAllotted: true, sendNotification: true, notifySms: true, notifyEmail: true, messageTemplate: 'Congratulations {{name}}! Application {{form_no}}: seat allotted in {{class}}. Further details will follow.' },
  { name: 'Rejected', color: '#dc2626' },
];

async function api(path, method = 'GET', body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} failed: ${data.error || res.status}`);
  return data;
}

(async () => {
  console.log('Waking up the server (free tier may take ~30s)…');
  await fetch(API + '/health').catch(() => {});

  const { token } = await api('/admin/auth/login', 'POST', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  console.log('✔ Logged in as admin');

  const meta = await api('/meta'.replace('/meta', '/admin/meta'), 'GET', null, token);
  const session = meta.sessions.find((s) => s.name === '2026-27');
  const nursery = meta.classes.find((c) => c.name.toLowerCase() === 'nursery');
  if (!session || !nursery) throw new Error('Session 2026-27 or class Nursery not found on server');

  // Re-runnable: updates the template in place if it already exists
  const existingTemplates = await api('/admin/templates', 'GET', null, token);
  const existingTpl = existingTemplates.find((t) => t.name === 'Nursery Application Form (2026-27)');
  const tpl = await api('/admin/templates', 'POST', {
    id: existingTpl ? existingTpl.id : undefined,
    name: 'Nursery Application Form (2026-27)',
    description: 'Recreated from the school applicant PDF layout',
    active: true,
    sections: SECTIONS,
  }, token);
  console.log(`✔ Template ${existingTpl ? 'updated' : 'created'} (id ${tpl.id}) with ${SECTIONS.length} sections`);

  const existingActs = await api('/admin/activations', 'GET', null, token);
  const existingAct = existingActs.find((a) => a.title === 'Nursery Registration 2026-27');
  const act = await api('/admin/activations', 'POST', {
    id: existingAct ? existingAct.id : undefined,
    // keep existing statuses (with their ids) if re-running, so submissions keep their status
    ...(existingAct ? { statuses: existingAct.statuses.sort((a, b) => a.sortOrder - b.sortOrder) } : {}),
    title: 'Nursery Registration 2026-27',
    templateId: tpl.id,
    sessionId: session.id,
    classId: nursery.id,
    price: 1000,
    onlinePaymentEnabled: true,
    dobValidationEnabled: false,
    formNoPrefix: 'NUR-',
    formNoSuffix: '/27',
    formNoPad: 5,
    instructionsHtml: INSTRUCTIONS.trim(),
    active: true,
    ...(existingAct ? {} : {
      statuses: STATUSES.map((s) => ({
        isFirst: false, isAllotted: false, sendNotification: false,
        notifySms: false, notifyEmail: false, notifyWhatsapp: false, messageTemplate: '', ...s,
      })),
    }),
  }, token);
  console.log('✔ Form activated for Nursery, 2026-27 — fee ₹1000, online payment ON');
  console.log('');
  console.log('PUBLIC FORM URL:');
  console.log('  https://school-registration-portal.netlify.app/form/' + act.slug);
  console.log('');
  console.log('Share that link with parents. Manage submissions in the admin panel.');

  // Verify Razorpay configuration on the server
  const pub = await api('/public/forms/' + act.slug);
  if (pub.mockPayment) {
    console.log('');
    console.log('⚠ Razorpay is NOT configured on the server — payments will run in MOCK mode.');
    console.log('  Fix: Render dashboard → registration-api → Environment →');
    console.log('  set RAZORPAY_KEY_ID = rzp_test_… and RAZORPAY_KEY_SECRET = … then Save (service restarts).');
  } else {
    console.log('✔ Razorpay is configured (key ' + pub.razorpayKeyId + ') — real checkout window will open.');
  }
})().catch((e) => {
  console.error('✖ ' + e.message);
  process.exit(1);
});
