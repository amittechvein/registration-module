require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { sequelize } = require('./models');
const { ensureSeed } = require('./seed');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/admin', require('./routes/admin'));
app.use('/api/public', require('./routes/public'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve built React client if present (production)
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run: cd client && npm run build');
  });
});

const PORT = process.env.PORT || 5000;
(async () => {
  await sequelize.sync();
  await ensureSeed();
  app.listen(PORT, () => console.log(`Registration server running on http://localhost:${PORT}`));
})();
