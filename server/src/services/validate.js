const { FormSection, FormField } = require('../models');

/**
 * Server-side validation of submission data against the template definition
 * and activation-level rules (DOB range etc.). Returns array of error strings.
 */
async function validateSubmission(activation, data) {
  const errors = [];
  const sections = await FormSection.findAll({
    where: { templateId: activation.templateId },
    include: [{ model: FormField, as: 'fields' }],
  });

  for (const section of sections) {
    for (const field of section.fields) {
      const value = data[field.id];
      const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
      if (field.required && empty) {
        errors.push(`${field.label} is required`);
        continue;
      }
      if (field.fieldType === 'file') {
        if (field.required && !(value && typeof value === 'object' && value.attachmentId)) {
          if (!errors.includes(`${field.label} is required`)) errors.push(`${field.label} is required`);
        }
        continue;
      }
      if (empty) continue;

      let rules = {};
      try { rules = JSON.parse(field.validation || '{}'); } catch {}

      const str = String(value);
      if (rules.minLength && str.length < rules.minLength) errors.push(`${field.label} must be at least ${rules.minLength} characters`);
      if (rules.maxLength && str.length > rules.maxLength) errors.push(`${field.label} must be at most ${rules.maxLength} characters`);
      if (field.fieldType === 'number') {
        const n = Number(value);
        if (Number.isNaN(n)) errors.push(`${field.label} must be a number`);
        else {
          if (rules.min != null && rules.min !== '' && n < Number(rules.min)) errors.push(`${field.label} must be ≥ ${rules.min}`);
          if (rules.max != null && rules.max !== '' && n > Number(rules.max)) errors.push(`${field.label} must be ≤ ${rules.max}`);
        }
      }
      if (field.fieldType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) errors.push(`${field.label} must be a valid email`);
      if (field.fieldType === 'phone' && !/^[6-9]\d{9}$/.test(str)) errors.push(`${field.label} must be a valid 10-digit mobile number`);
      if (rules.regex) {
        try {
          if (!new RegExp(rules.regex).test(str)) errors.push(rules.regexMessage || `${field.label} is invalid`);
        } catch {}
      }
      // DOB validation from the activation settings, applied to the field linked to Date of Birth
      if (activation.dobValidationEnabled && field.studentField === 'dob') {
        const d = new Date(str);
        if (Number.isNaN(d.getTime())) errors.push(`${field.label} must be a valid date`);
        else {
          if (activation.dobMin && d < new Date(activation.dobMin)) errors.push(`${field.label}: date of birth must be on or after ${activation.dobMin}`);
          if (activation.dobMax && d > new Date(activation.dobMax)) errors.push(`${field.label}: date of birth must be on or before ${activation.dobMax}`);
        }
      }
    }
  }
  return errors;
}

module.exports = { validateSubmission };
