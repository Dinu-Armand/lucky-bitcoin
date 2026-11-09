// Test de sarcina cu autocannon pe: cotatii, istoric sesiuni, plasare ordine.
import autocannon from 'autocannon';
import { pool } from './db.js';
import { SYMBOL } from './utils.js';

// autocannon nu expune p95; il calculam exact din timpii de raspuns individuali (evenimentul 'response').
function run(opts) {
  return new Promise((resolve, reject) => {
    const times = [];
    const inst = autocannon(opts, (err, result) => (err ? reject(err) : resolve({ result, times })));
    inst.on('response', (client, statusCode, resBytes, responseTime) => {
      if (times.length < 500000) times.push(responseTime);
    });
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const summarize = (name, method, path, r, times) => ({
  name, method, path,
  rps: Math.round(r.requests.average * 10) / 10,
  totalRequests: r.requests.total,
  latency: {
    avg: r.latency.average, min: r.latency.min, max: r.latency.max, p50: r.latency.p50,
    p95: times.length ? percentile([...times].sort((a, b) => a - b), 95) : r.latency.p97_5, p99: r.latency.p99,
  },
  throughputMBs: Math.round((r.throughput.average / 1048576) * 1000) / 1000,
  bytes: r.throughput.total,
  status2xx: r['2xx'], non2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts,
  successRate: r.requests.total + r.errors ? Math.round((r['2xx'] / (r['2xx'] + r.non2xx + r.errors + r.timeouts || 1)) * 10000) / 100 : 0,
  durationSec: r.duration,
});

export async function runLoadTest({ baseUrl, token, userId, connections = 50, duration = 10 }) {
  connections = Math.min(200, Math.max(1, Number(connections) || 50));
  duration = Math.min(30, Math.max(2, Number(duration) || 10));
  const per = Math.max(2, Math.round(duration / 3));

  // sesiune dedicata (Time Machine) cu sold urias, ca ordinele sa nu fie respinse; se sterge la final
  const b = (await pool.query(`SELECT MIN(open_time) mn, MAX(open_time) mx FROM historical_candles WHERE symbol=$1 AND timeframe='1m'`, [SYMBOL])).rows[0];
  const mid = new Date(Math.floor((b.mn + b.mx) / 2 / 60000) * 60000);
  const sess = (await pool.query(
    `INSERT INTO trading_sessions (user_id, name, mode, initial_balance, current_balance, simulated_start_time, simulated_current_time)
     VALUES ($1,'__loadtest__','TIME_MACHINE',1000,1000000000,$2,$2) RETURNING id`, [userId, mid])).rows[0];
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const results = [];
  try {
    const specs = [
      { name: 'Quotes', method: 'GET', path: `/api/market/price?session=${sess.id}` },
      { name: 'Session history', method: 'GET', path: '/api/sessions' },
      { name: 'Place order', method: 'POST', path: `/api/sessions/${sess.id}/orders`,
        body: JSON.stringify({ side: 'LONG', order_type: 'LIMIT', leverage: 2, margin_usdc: 1, limit_price: 1000 }) },
    ];
    for (const s of specs) {
      const { result, times } = await run({ url: baseUrl + s.path, method: s.method, headers, body: s.body, connections, duration: per });
      results.push(summarize(s.name, s.method, s.path.split('?')[0].replace(String(sess.id), ':id'), result, times));
    }
  } finally {
    await pool.query('DELETE FROM trading_sessions WHERE id=$1', [sess.id]);
  }
  const totalReq = results.reduce((s, x) => s + x.totalRequests, 0);
  const totalDur = results.reduce((s, x) => s + x.durationSec, 0);
  const ok = results.reduce((s, x) => s + x.status2xx, 0);
  const bad = results.reduce((s, x) => s + x.non2xx + x.errors + x.timeouts, 0);
  return {
    ranAt: new Date().toISOString(), connections, durationPerEndpointSec: per, results,
    totals: {
      requests: totalReq,
      rps: totalDur ? Math.round((totalReq / totalDur) * 10) / 10 : 0,
      avgLatency: totalReq ? Math.round((results.reduce((s, x) => s + x.latency.avg * x.totalRequests, 0) / totalReq) * 100) / 100 : 0,
      successRate: ok + bad ? Math.round((ok / (ok + bad)) * 10000) / 100 : 0,
    },
  };
}
