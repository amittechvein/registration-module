/**
 * Emergency admin recovery — run ON THE SERVER (or locally) when the admin
 * password is forgotten or all owner accounts are locked out.
 *
 *   cd /opt/registration/server
 *   node src/reset-admin.js <email> <new-password>
 *
 * - If the user exists: resets the password, promotes to owner, re-activates.
 * - If not: creates a brand-new owner account.
 * The action is recorded in the audit log.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { AdminUser, AuditLog } = require('./models');

(async () => {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.log('Usage: node src/reset-admin.js <email> <new-password>');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }
  const [user, created] = await AdminUser.findOrCreate({
    where: { email },
    defaults: { name: email.split('@')[0], permissions: '{}' },
  });
  await user.update({ passwordHash: bcrypt.hashSync(password, 10), role: 'owner', active: true });
  try {
    await AuditLog.create({
      actorType: 'system', actorName: 'reset-admin.js (server console)',
      action: created ? 'user.create' : 'user.update',
      entity: 'AdminUser', entityId: String(user.id),
      summary: `${created ? 'Created' : 'Password reset for'} owner ${email} via server console`,
    });
  } catch {}
  console.log(`DONE — ${created ? 'created new owner' : 'password reset for'} ${email}. Log in at /admin/login.`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
