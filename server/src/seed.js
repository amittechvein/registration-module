const bcrypt = require('bcryptjs');
const { sequelize, AdminUser, AcademicSession, ClassRoom } = require('./models');

async function ensureSeed() {
  const adminCount = await AdminUser.count();
  if (!adminCount) {
    await AdminUser.create({
      name: 'Admin',
      email: 'admin@school.com',
      passwordHash: bcrypt.hashSync('admin123', 10),
    });
    console.log('Seeded admin user → admin@school.com / admin123 (change this!)');
  }
  if (!(await AcademicSession.count())) {
    await AcademicSession.bulkCreate([{ name: '2026-27' }, { name: '2027-28' }]);
  }
  if (!(await ClassRoom.count())) {
    const names = ['Nursery', 'LKG', 'UKG', ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`)];
    await ClassRoom.bulkCreate(names.map((name, i) => ({ name, sortOrder: i })));
  }
  // Auto-create the pre-built Nursery form (from the school's PDF) if missing
  const { ensurePrebuiltForms } = require('./prebuilt');
  await ensurePrebuiltForms();
}

if (require.main === module) {
  (async () => {
    await sequelize.sync();
    await ensureSeed();
    console.log('Seed complete');
    process.exit(0);
  })();
}

module.exports = { ensureSeed };
