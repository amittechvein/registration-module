/**
 * Audit trail — records every important admin action.
 * Never throws: an audit failure must not break the actual operation.
 */
const { AuditLog } = require('../models');

/**
 * audit(req, action, { entity, entityId, summary, details, actor })
 *  - action:  short dotted key, e.g. 'login', 'submission.edit', 'status.change'
 *  - summary: human-readable one-liner shown in the Audit Log page
 *  - details: object with extra data (e.g. field-level changes) — stored as JSON
 *  - actor:   optional { id, name, type } override (used at login, before req.admin exists)
 */
async function audit(req, action, opts = {}) {
  try {
    const actor = opts.actor
      || (req.admin ? { id: req.admin.id, name: req.admin.name, type: 'admin' } : null)
      || (req.applicant ? { id: req.applicant.id, name: 'Applicant ' + (req.applicant.phone || '#' + req.applicant.id), type: 'applicant' } : null)
      || { id: null, name: 'system', type: 'system' };
    await AuditLog.create({
      actorType: actor.type || 'admin',
      actorId: actor.id ?? null,
      actorName: actor.name || '',
      action,
      entity: opts.entity || null,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      summary: opts.summary || '',
      details: opts.details ? JSON.stringify(opts.details) : null,
      ip: (req.headers?.['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim().slice(0, 60),
    });
  } catch (e) {
    console.error('[audit] failed:', e.message);
  }
}

module.exports = { audit };
