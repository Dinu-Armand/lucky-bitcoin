// Benchmark indecsi: EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) INAINTE si DUPA crearea indecsilor.
// Totul ruleaza intr-o tranzactie care se anuleaza (ROLLBACK), deci schema ramane neschimbata dupa test.
import { pool } from './db.js';
import { SYMBOL } from './utils.js';

function walk(node, acc = []) {
  acc.push(node['Node Type']);
  (node.Plans || []).forEach((p) => walk(p, acc));
  return acc;
}

function summarize(raw) {
  const top = raw[0];
  const plan = top.Plan;
  const nodes = walk(plan);
  return {
    nodes,
    mainScan: nodes.find((n) => /Scan/.test(n)) || nodes[0],
    executionMs: top['Execution Time'],
    planningMs: top['Planning Time'],
    totalCost: plan['Total Cost'],
    sharedHit: JSON.stringify(top).match(/"Shared Hit Blocks":(\d+)/g)?.length ? sumKey(plan, 'Shared Hit Blocks') : 0,
    sharedRead: sumKey(plan, 'Shared Read Blocks'),
    rows: plan['Actual Rows'],
    raw,
  };
}
function sumKey(node, key) {
  return (node[key] || 0) + (node.Plans || []).reduce((s, p) => s + sumKey(p, key), 0);
}

async function explain(c, sql) {
  await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`); // warm-up (cache)
  const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  return summarize(r.rows[0]['QUERY PLAN']);
}

export async function runBenchmark() {
  const c = await pool.connect();
  const log = [];
  const run = async (sql) => { log.push(sql.trim()); await c.query(sql); };
  try {
    const b = (await c.query(
      `SELECT MIN(open_time) mn, MAX(open_time) mx FROM historical_candles WHERE symbol=$1 AND timeframe='1m'`, [SYMBOL])).rows[0];
    if (!b.mn) throw new Error('No candles in database');
    const mid = Math.floor((b.mn + b.mx) / 2 / 60000) * 60000;
    const from = mid, to = mid + 200 * 60000;
    const sess = (await c.query(
      `SELECT session_id FROM positions GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1`)).rows[0];
    const sessionId = sess ? sess.session_id : 0;

    const q1 = `SELECT open_time, open, high, low, close, volume FROM historical_candles
                 WHERE symbol='${SYMBOL}' AND timeframe='1m' AND open_time BETWEEN ${from} AND ${to} ORDER BY open_time`;
    const q2 = `SELECT status, COUNT(*) AS trades, SUM(realized_pnl_usdc) AS pnl, SUM(opening_fee_usdc + closing_fee_usdc) AS fees
                  FROM positions WHERE session_id=${sessionId} AND status IN ('CLOSED','LIQUIDATED') AND closed_at >= now() - interval '10 years'
                 GROUP BY status`;

    await run('BEGIN');
    // ---- stare "ÎNAINTE": fara indecsi (inclusiv fara indexul implicit al constrangerii UNIQUE) ----
    await run('DROP INDEX IF EXISTS idx_candles_lookup');
    await run('DROP INDEX IF EXISTS idx_positions_session_status');
    await run('ALTER TABLE historical_candles DROP CONSTRAINT IF EXISTS uq_candles');
    await run('ANALYZE historical_candles');
    await run('ANALYZE positions');
    const before = { candles: await explain(c, q1), positions: await explain(c, q2) };

    // ---- stare "DUPĂ": cu indecsii ceruti ----
    await run('CREATE INDEX idx_candles_lookup ON historical_candles (symbol, timeframe, open_time)');
    await run('CREATE INDEX idx_positions_session_status ON positions (session_id, status, closed_at)');
    await run('ANALYZE historical_candles');
    await run('ANALYZE positions');
    const after = { candles: await explain(c, q1), positions: await explain(c, q2) };
    await c.query('ROLLBACK'); // restaureaza schema exact asa cum era (indecsii din schema.sql + constrangerea UNIQUE)
    log.push('ROLLBACK -- schema restored (indexes from schema.sql remain in place)');

    const pct = (b0, a0) => (b0 > 0 ? Math.round(((b0 - a0) / b0) * 1000) / 10 : 0);
    const mk = (key, title, sql, indexSql) => ({
      key, title, sql: sql.replace(/\s+/g, ' ').trim(), indexSql,
      before: { ...before[key], raw: undefined }, after: { ...after[key], raw: undefined },
      speedupPct: pct(before[key].executionMs, after[key].executionMs),
      speedupFactor: after[key].executionMs > 0 ? Math.round((before[key].executionMs / after[key].executionMs) * 10) / 10 : null,
      plans: { before: before[key].raw, after: after[key].raw },
    });
    return {
      ranAt: new Date().toISOString(),
      statements: log,
      tests: [
        mk('candles', 'Time Machine: candle range lookup', q1, 'CREATE INDEX idx_candles_lookup ON historical_candles(symbol, timeframe, open_time);'),
        mk('positions', 'PnL aggregation per session', q2, 'CREATE INDEX idx_positions_session_status ON positions(session_id, status, closed_at);'),
      ],
    };
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}
