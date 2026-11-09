import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDatabase, applySchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { HttpError } from './utils.js';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import marketRoutes from './routes/market.js';
import reviewRoutes from './routes/reviews.js';
import dataRoutes from './routes/data.js';
import adminRoutes from './routes/admin.js';
import reportRoutes from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);

const app = express();
app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Lucky Bitcoin', time: new Date().toISOString() }));

// Documentatia (DOCUMENTATION.md) servita catre pagina /documentation din aplicatie
app.get('/api/documentation', (req, res) => {
  const file = path.join(__dirname, '..', '..', 'DOCUMENTATION.md');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'DOCUMENTATION.md not found' });
  res.type('text/markdown').send(fs.readFileSync(file, 'utf8'));
});

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);

// Optional: serveste frontend-ul compilat (frontend/dist) daca exista
const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON', code: 'INVALID_BODY' });
  if (typeof err.code === 'string' && /^2[23]/.test(err.code)) {
    const status = err.code === '23505' || err.code === '23503' ? 409 : 400;
    return res.status(status).json({ error: err.detail || err.message, code: `DB_${err.code}` });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
});

async function main() {
  await ensureDatabase();
  await applySchema();
  await seedIfEmpty();
  app.listen(PORT, () => {
    console.log(`\n  Lucky Bitcoin API ready on http://localhost:${PORT}`);
    console.log('  Demo accounts: admin@luckybtc.ro / Admin123!  |  analyst@luckybtc.ro / Analyst123!  |  trader@luckybtc.ro / Trader123!\n');
  });
}

main().catch((e) => {
  console.error('[fatal]', e.stack || e.message);
  console.error('Check that PostgreSQL is running and DATABASE_URL in backend/.env is correct.');
  process.exit(1);
});
