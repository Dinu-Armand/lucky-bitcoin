import { Router } from 'express';
import { authenticate, requireRole, audit } from '../auth.js';
import { asyncH } from '../utils.js';
import { runBenchmark } from '../benchmark.js';
import { runLoadTest } from '../loadtest.js';

const r = Router();
r.use(authenticate, requireRole('ADMIN'));

let lastBenchmark = null;
let lastLoadTest = null;
let loadRunning = false;

r.get('/last', (req, res) => res.json({ benchmark: lastBenchmark, loadtest: lastLoadTest }));

r.post('/benchmark', asyncH(async (req, res) => {
  lastBenchmark = await runBenchmark();
  await audit(req, 'RUN_BENCHMARK', 'indexes', null, { speedups: lastBenchmark.tests.map((t) => t.speedupPct) });
  res.json(lastBenchmark);
}));

r.post('/loadtest', asyncH(async (req, res) => {
  if (loadRunning) return res.status(409).json({ error: 'A load test is already running', code: 'LOAD_RUNNING' });
  loadRunning = true;
  try {
    const baseUrl = `http://127.0.0.1:${process.env.PORT || 4000}`;
    lastLoadTest = await runLoadTest({
      baseUrl, token: req.token, userId: req.user.id,
      connections: req.body?.connections, duration: req.body?.duration,
    });
    await audit(req, 'RUN_LOADTEST', 'api', null, { connections: lastLoadTest.connections, rps: lastLoadTest.totals.rps });
    res.json(lastLoadTest);
  } finally {
    loadRunning = false;
  }
}));

export default r;
