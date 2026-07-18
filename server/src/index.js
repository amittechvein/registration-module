require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { sequelize } = require('./models');
const { ensureSeed } = require('./seed');

const app = express();

// Behind Render/Netlify proxies — needed so rate limiting sees real client IPs
app.set('trust proxy', 1);

// Security headers (CSP off because the client is served separately / needs Razorpay script)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS: only the known frontends may call the API from a browser
const ALLOWED_ORIGINS = [
  'https://school-registration-portal.netlify.app',
  'http://localhost:5173',
  'http://localhost:5000',
  ...(process.env.EXTRA_CORS_ORIGINS ? process.env.EXTRA_CORS_ORIGINS.split(',') : []),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
}));

// Rate limits: strict on auth endpoints (brute-force protection), generous elsewhere
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please try again after 15 minutes.' } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api/public/auth/', authLimiter);
app.use('/api/admin/auth/', authLimiter);
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '2mb' }));

app.use('/api/admin', require('./routes/admin'));
app.use('/api/public', require('./routes/public'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve built React client if present (production single-server mode)
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run: cd client && npm run build');
  });
});

// Never leak stack traces to clients
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.message === 'Not allowed by CORS') return res.status(403).json({ error: 'Origin not allowed' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
(async () => {
  await sequelize.sync({ alter: true });
  await ensureSeed();
  app.listen(PORT, () => console.log(`Registration server running on http://localhost:${PORT}`));
})();
