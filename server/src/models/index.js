const { DataTypes } = require('sequelize');
const sequelize = require('../db');

// Key/value store for admin-configurable settings (SMS, Email, Razorpay…)
const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, unique: true, allowNull: false },
  value: { type: DataTypes.TEXT },
});

const AdminUser = sequelize.define('AdminUser', {
  name: DataTypes.STRING,
  email: { type: DataTypes.STRING, unique: true },
  passwordHash: DataTypes.STRING,
  role: { type: DataTypes.STRING, defaultValue: 'staff' }, // owner (full access) | staff (permission based)
  permissions: { type: DataTypes.TEXT, defaultValue: '{}' }, // JSON: {submissions,status,communicate,export,forms,students,settings,users,edit,audit}
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  notifSeenAt: { type: DataTypes.DATE, allowNull: true }, // last time this admin opened the notification bell
});

// All grantable permissions for staff users
const ADMIN_PERMISSIONS = [
  { key: 'submissions', label: 'View submissions' },
  { key: 'edit', label: 'Edit submitted form data' },
  { key: 'status', label: 'Update application status' },
  { key: 'communicate', label: 'Message applicants' },
  { key: 'export', label: 'Download PDF / Excel' },
  { key: 'forms', label: 'Manage form templates & activations' },
  { key: 'students', label: 'View allotted students' },
  { key: 'settings', label: 'Manage settings (SMS/Email/Razorpay)' },
  { key: 'users', label: 'Manage users' },
  { key: 'audit', label: 'View audit log' },
];

// ---- Audit trail: every important admin action is recorded here ----
const AuditLog = sequelize.define('AuditLog', {
  actorType: { type: DataTypes.STRING, defaultValue: 'admin' }, // admin | applicant | system
  actorId: { type: DataTypes.INTEGER, allowNull: true },
  actorName: { type: DataTypes.STRING, defaultValue: '' },
  action: { type: DataTypes.STRING, allowNull: false }, // e.g. login, submission.edit, status.change
  entity: { type: DataTypes.STRING, allowNull: true }, // e.g. Submission, FormActivation, AdminUser
  entityId: { type: DataTypes.STRING, allowNull: true },
  summary: { type: DataTypes.TEXT, defaultValue: '' }, // human-readable one-liner
  details: { type: DataTypes.TEXT, allowNull: true }, // JSON: field-level changes etc.
  ip: { type: DataTypes.STRING, defaultValue: '' },
});

const AcademicSession = sequelize.define('AcademicSession', {
  name: { type: DataTypes.STRING, allowNull: false }, // e.g. 2026-27
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const ClassRoom = sequelize.define('ClassRoom', {
  name: { type: DataTypes.STRING, allowNull: false }, // e.g. Nursery, Class 1
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
});

// ---- Dynamic form template ----
const FormTemplate = sequelize.define('FormTemplate', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  layout: { type: DataTypes.TEXT }, // JSON: canvas-designed PDF layout {settings, elements}
});

const FormSection = sequelize.define('FormSection', {
  title: { type: DataTypes.STRING, allowNull: false }, // e.g. Personal Details
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const FormField = sequelize.define('FormField', {
  label: { type: DataTypes.STRING, allowNull: false },
  fieldType: { type: DataTypes.STRING, defaultValue: 'text' }, // text,number,date,select,radio,checkbox,textarea,email,phone
  options: { type: DataTypes.TEXT }, // JSON array for select/radio/checkbox
  required: { type: DataTypes.BOOLEAN, defaultValue: false },
  // Link to student profile column — when applicant is Allotted, value auto-inserts into Students DB
  studentField: { type: DataTypes.STRING, allowNull: true },
  validation: { type: DataTypes.TEXT }, // JSON: {minLength,maxLength,min,max,regex,regexMessage}
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
});

// ---- Activation of a form for a class ----
const FormActivation = sequelize.define('FormActivation', {
  title: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, unique: true }, // public URL part
  price: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  onlinePaymentEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
  dobValidationEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  dobMin: { type: DataTypes.DATEONLY, allowNull: true }, // earliest allowed DOB
  dobMax: { type: DataTypes.DATEONLY, allowNull: true }, // latest allowed DOB
  formNoPrefix: { type: DataTypes.STRING, defaultValue: '' },
  formNoSuffix: { type: DataTypes.STRING, defaultValue: '' },
  formNoNext: { type: DataTypes.INTEGER, defaultValue: 1 },
  formNoPad: { type: DataTypes.INTEGER, defaultValue: 4 },
  instructionsHtml: { type: DataTypes.TEXT }, // rich text instructions
  startDate: { type: DataTypes.DATEONLY, allowNull: true },
  endDate: { type: DataTypes.DATEONLY, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: false },
  pdfTemplate: { type: DataTypes.STRING, defaultValue: 'modern' }, // modern | classic
});

// Statuses configured per activation (table form)
const FormStatus = sequelize.define('FormStatus', {
  name: { type: DataTypes.STRING, allowNull: false },
  color: { type: DataTypes.STRING, defaultValue: '#2563eb' },
  isFirst: { type: DataTypes.BOOLEAN, defaultValue: false }, // status given on submission
  isAllotted: { type: DataTypes.BOOLEAN, defaultValue: false }, // predefined: allocation → insert into Students DB
  sendNotification: { type: DataTypes.BOOLEAN, defaultValue: false },
  notifySms: { type: DataTypes.BOOLEAN, defaultValue: false },
  notifyEmail: { type: DataTypes.BOOLEAN, defaultValue: false },
  notifyWhatsapp: { type: DataTypes.BOOLEAN, defaultValue: false },
  messageTemplate: { type: DataTypes.TEXT }, // supports {{name}} {{form_no}} {{status}} {{class}}
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
});

// ---- Applicants & submissions ----
const Applicant = sequelize.define('Applicant', {
  phone: { type: DataTypes.STRING, unique: true, allowNull: true }, // null for Google-only accounts
  name: DataTypes.STRING,
  email: DataTypes.STRING,
  googleId: { type: DataTypes.STRING, allowNull: true },
  otp: DataTypes.STRING, // bcrypt hash of the OTP — never stored in plain text
  otpExpiresAt: DataTypes.DATE,
  otpAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
});

// Uploaded documents (birth certificate, address proof, photos…).
// Stored as binary inside the database → encrypted at rest, survives restarts,
// and only downloadable through authenticated endpoints.
const Attachment = sequelize.define('Attachment', {
  filename: { type: DataTypes.STRING, allowNull: false },
  mimetype: { type: DataTypes.STRING, allowNull: false },
  sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
  sha256: DataTypes.STRING,
  data: { type: DataTypes.BLOB('long'), allowNull: false },
});

const Submission = sequelize.define('Submission', {
  formNo: { type: DataTypes.STRING, allowNull: true }, // assigned on final submit
  data: { type: DataTypes.TEXT, defaultValue: '{}' }, // JSON keyed by field id
  isDraft: { type: DataTypes.BOOLEAN, defaultValue: true },
  submittedAt: DataTypes.DATE,
  amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  paymentStatus: { type: DataTypes.STRING, defaultValue: 'na' }, // na | pending | paid | failed
  score: { type: DataTypes.INTEGER, allowNull: true }, // auto-computed admission priority (0-100)
  scoreDetails: { type: DataTypes.TEXT }, // JSON: score breakdown lines
  flags: { type: DataTypes.TEXT }, // JSON: auto-detected warnings (duplicates etc.)
});

const Payment = sequelize.define('Payment', {
  provider: { type: DataTypes.STRING, defaultValue: 'razorpay' },
  orderId: DataTypes.STRING,
  paymentId: DataTypes.STRING,
  signature: DataTypes.STRING,
  amount: DataTypes.DECIMAL(10, 2),
  status: { type: DataTypes.STRING, defaultValue: 'created' }, // created | paid | failed | mock_paid
});

const Communication = sequelize.define('Communication', {
  sender: { type: DataTypes.STRING, allowNull: false }, // admin | applicant | system
  channel: { type: DataTypes.STRING, defaultValue: 'portal' }, // portal | sms | email
  message: { type: DataTypes.TEXT, allowNull: false },
});

const StatusLog = sequelize.define('StatusLog', {
  fromStatus: DataTypes.STRING,
  toStatus: DataTypes.STRING,
  note: DataTypes.TEXT,
  changedBy: DataTypes.STRING,
});

// ---- Students DB (allotment target) ----
const Student = sequelize.define('Student', {
  admissionNo: DataTypes.STRING,
  firstName: DataTypes.STRING,
  lastName: DataTypes.STRING,
  dob: DataTypes.DATEONLY,
  gender: DataTypes.STRING,
  fatherName: DataTypes.STRING,
  motherName: DataTypes.STRING,
  guardianPhone: DataTypes.STRING,
  email: DataTypes.STRING,
  address: DataTypes.TEXT,
  city: DataTypes.STRING,
  state: DataTypes.STRING,
  pincode: DataTypes.STRING,
  bloodGroup: DataTypes.STRING,
  aadhaarNo: DataTypes.STRING,
  previousSchool: DataTypes.STRING,
  category: DataTypes.STRING,
  religion: DataTypes.STRING,
  nationality: DataTypes.STRING,
});

// Student profile fields available for linking in the template builder
const STUDENT_FIELDS = [
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'dob', label: 'Date of Birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'fatherName', label: "Father's Name" },
  { key: 'motherName', label: "Mother's Name" },
  { key: 'guardianPhone', label: 'Guardian Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'bloodGroup', label: 'Blood Group' },
  { key: 'aadhaarNo', label: 'Aadhaar No' },
  { key: 'previousSchool', label: 'Previous School' },
  { key: 'category', label: 'Category' },
  { key: 'religion', label: 'Religion' },
  { key: 'nationality', label: 'Nationality' },
];

// ---- Associations ----
FormTemplate.hasMany(FormSection, { as: 'sections', foreignKey: 'templateId', onDelete: 'CASCADE' });
FormSection.belongsTo(FormTemplate, { foreignKey: 'templateId' });
FormSection.hasMany(FormField, { as: 'fields', foreignKey: 'sectionId', onDelete: 'CASCADE' });
FormField.belongsTo(FormSection, { foreignKey: 'sectionId' });

FormActivation.belongsTo(FormTemplate, { as: 'template', foreignKey: 'templateId' });
FormActivation.belongsTo(AcademicSession, { as: 'session', foreignKey: 'sessionId' });
FormActivation.belongsTo(ClassRoom, { as: 'classRoom', foreignKey: 'classId' });
FormActivation.hasMany(FormStatus, { as: 'statuses', foreignKey: 'activationId', onDelete: 'CASCADE' });
FormStatus.belongsTo(FormActivation, { foreignKey: 'activationId' });

Submission.belongsTo(FormActivation, { as: 'activation', foreignKey: 'activationId' });
FormActivation.hasMany(Submission, { as: 'submissions', foreignKey: 'activationId' });
Submission.belongsTo(Applicant, { as: 'applicant', foreignKey: 'applicantId' });
Applicant.hasMany(Submission, { as: 'submissions', foreignKey: 'applicantId' });
Submission.belongsTo(FormStatus, { as: 'status', foreignKey: 'statusId' });
Submission.hasMany(Payment, { as: 'payments', foreignKey: 'submissionId' });
Payment.belongsTo(Submission, { foreignKey: 'submissionId' });
Submission.hasMany(Communication, { as: 'communications', foreignKey: 'submissionId', onDelete: 'CASCADE' });
Communication.belongsTo(Submission, { foreignKey: 'submissionId' });
Submission.hasMany(StatusLog, { as: 'statusLogs', foreignKey: 'submissionId', onDelete: 'CASCADE' });
StatusLog.belongsTo(Submission, { foreignKey: 'submissionId' });
Attachment.belongsTo(Applicant, { as: 'applicant', foreignKey: 'applicantId' });
Attachment.belongsTo(Submission, { as: 'submission', foreignKey: 'submissionId' });
Submission.hasMany(Attachment, { as: 'attachments', foreignKey: 'submissionId' });

Student.belongsTo(Submission, { as: 'sourceSubmission', foreignKey: 'submissionId' });
Student.belongsTo(ClassRoom, { as: 'classRoom', foreignKey: 'classId' });
Student.belongsTo(AcademicSession, { as: 'session', foreignKey: 'sessionId' });

module.exports = {
  sequelize,
  Setting,
  AdminUser,
  ADMIN_PERMISSIONS,
  AuditLog,
  AcademicSession,
  ClassRoom,
  FormTemplate,
  FormSection,
  FormField,
  FormActivation,
  FormStatus,
  Applicant,
  Attachment,
  Submission,
  Payment,
  Communication,
  StatusLog,
  Student,
  STUDENT_FIELDS,
};
