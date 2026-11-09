// Ruleaza testul de sarcina din terminal:  npm run loadtest   (serverul trebuie sa ruleze)
// Optiuni: LT_CONNECTIONS=100 LT_DURATION=10 npm run loadtest
const base = process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const connections = Number(process.env.LT_CONNECTIONS || 50);
const duration = Number(process.env.LT_DURATION || 10);

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ login: 'admin@luckybtc.ro', password: 'Admin123!' }),
});
if (!login.ok) {
  console.error('Login failed - is the server running and seeded?', login.status);
  process.exit(1);
}
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
console.log(`Running load test: ${connections} connections, ~${duration}s total...`);
const res = await fetch(`${base}/api/admin/loadtest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ connections, duration }),
});
const data = await res.json();
if (!res.ok) {
  console.error(data);
  process.exit(1);
}
console.table(
  data.results.map((r) => ({
    endpoint: `${r.method} ${r.path}`, 'req/s': r.rps, 'avg ms': r.latency.avg, 'min ms': r.latency.min, 'max ms': r.latency.max,
    'p50 ms': r.latency.p50, 'p95 ms': r.latency.p95, 'p99 ms': r.latency.p99, 'MB/s': r.throughputMBs, '2xx %': r.successRate,
  }))
);
console.log('Totals:', data.totals);
