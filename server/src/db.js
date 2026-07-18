require('dotenv').config();
const { Sequelize } = require('sequelize');

const dialect = process.env.DB_DIALECT || 'sqlite';

// Hosted deployment (Render/Railway/Neon/Supabase): set DATABASE_URL to a Postgres/MySQL URL
const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      logging: false,
      dialectOptions: process.env.DATABASE_URL.startsWith('postgres')
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : {},
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
