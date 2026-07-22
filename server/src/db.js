require('dotenv').config();
const { Sequelize } = require('sequelize');

const dialect = process.env.DB_DIALECT || 'sqlite';

// Hosted deployment: set DATABASE_URL to a Postgres/MySQL URL.
// SSL is used automatically for remote DBs (Render/Neon/etc.) and skipped for
// localhost (e.g. Postgres on the same Linode/VPS). Override with DB_SSL=true/false.
const dbUrl = process.env.DATABASE_URL;
const isLocalDb = dbUrl && /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl);
const useSsl = process.env.DB_SSL != null ? process.env.DB_SSL === 'true' : dbUrl && dbUrl.startsWith('postgres') && !isLocalDb;
const sequelize = dbUrl
  ? new Sequelize(dbUrl, {
      logging: false,
      dialectOptions: useSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
    })
  : dialect === 'mysql'
    ? new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        dialect: 'mysql',
        logging: false,
      })
    : new Sequelize({
        dialect: 'sqlite',
        storage: process.env.DB_STORAGE || './registration.sqlite',
        logging: false,
      });

module.exports = sequelize;
