const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

function adminAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const decoded = jwt.verify(token, SECRET);
    if (decoded.role !== 'admin') throw new Error('not admin');
    req.admin = decoded; // { role:'admin', id, name, adminRole:'owner'|'staff', perms:{} }
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

/** Permission gate: owners pass everything; staff need the specific permission. */
function requirePerm(...permKeys) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Unauthorized' });
    if (req.admin.adminRole === 'owner') return next();
    const perms = req.admin.perms || {};
    if (permKeys.some((k) => perms[k])) return next();
    res.status(403).json({ error: 'You do not have permission for this action' });
  };
}

function applicantAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const decoded = jwt.verify(token, SECRET);
    if (decoded.role !== 'applicant') throw new Error('not applicant');
    req.applicant = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { sign, adminAuth, applicantAuth, requirePerm };
