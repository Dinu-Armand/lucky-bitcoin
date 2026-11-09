// Migrare + fixtures automate la pornire: roluri, conturi, lumanari BTC/USDC, sesiuni/ordine/pozitii/recenzii istorice.
import bcrypt from 'bcryptjs';
import { pool, withTx } from './db.js';
import { fetchKlines } from './binance.js';
import { aggregate, TF_MIN, SYMBOL } from './utils.js';
import { FEES, calcLiq, checkExit } from './engine.js';
import { generateReviewData, saveReview } from './review.js';

const ROUNDS = 12;

export const DEMO_ACCOUNTS = [
  { username: 'admin', email: 'admin@luckybtc.ro', password: 'Admin123!', role: 'ADMIN' },
  { username: 'analyst', email: 'analyst@luckybtc.ro', password: 'Analyst123!', role: 'ANALYST' },
  { username: 'trader', email: 'trader@luckybtc.ro', password: 'Trader123!', role: 'TRADER' },
];

const ROLES = [
  { name: 'TRADER', description: 'Trading simulator, own sessions, orders, positions, reviews and reports',
    permissions: { simulator: true, own_sessions: true, own_reports: true, view_all: false, manage_candles: false, admin_console: false } },
  { name: 'ANALYST', description: 'Mentor / Risk Auditor: sees all sessions, edits mentor notes, manages historical candles, aggregate reports',
    permissions: { simulator: false, view_all: true, mentor_notes: true, manage_candles: true, aggregate_reports: true, admin_console: false } },
  { name: 'ADMIN', description: 'Full CRUD on all 8 tables, index benchmark, load test, audit log',
    permissions: { simulator: true, view_all: true, full_crud: true, benchmark: true, loadtest: true, audit_log: true, admin_console: true } },
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random-walk determinist (offline). */
function synthCandles(count, endMs) {
  const rand = mulberry32(20261027);
  const start = Math.floor(endMs / 60000) * 60000 - count * 60000;
  let price = 67000;
  const out = [];
  for (let i = 0; i < count; i++) {
    const open = price;
    const regime = Math.sin(i / 900) * 0.00009 + Math.sin(i / 160) * 0.00004;
    const shock = rand() < 0.01 ? (rand() - 0.5) * 0.01 : 0;
    const ret = (rand() - 0.5) * 0.0024 + regime + shock;
    const close = open * (1 + ret);
    const high = Math.max(open, close) * (1 + rand() * 0.0006);
    const low = Math.min(open, close) * (1 - rand() * 0.0006);
    out.push({ open_time: start + i * 60000, open, high, low, close, volume: 3 + rand() * 40 + Math.abs(ret) * 20000 });
    price = close;
  }
  return out;
}

async function loadCandles1m() {
  try {
    let all = [];
    let endTime = Date.now();
    for (let page = 0; page < 10; page++) {
      const k = await fetchKlines(SYMBOL, '1m', 1000, { endTime });
      if (!k.length) break;
      all = k.concat(all);
      endTime = k[0].open_time - 1;
    }
    all.pop(); // ultima lumanare poate fi incompleta
    if (all.length >= 5000) {
      console.log(`[seed] Downloaded ${all.length} 1m candles from Binance.`);
      return all;
    }
  } catch (e) {
    console.log(`[seed] Binance unavailable (${e.message}) - generating deterministic offline candles.`);
  }
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return synthCandles(12000, d.getTime());
}

async function bulkInsert(c, table, cols, rows, returning = false) {
  if (!rows.length) return [];
  const per = cols.length;
  const params = [];
  const tuples = rows.map((r, i) => {
    cols.forEach((k) => params.push(r[k] === undefined ? null : r[k]));
    return '(' + cols.map((_, j) => `$${i * per + j + 1}`).join(',') + ')';
  });
  const res = await c.query(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${table === 'historical_candles' ? 'ON CONFLICT DO NOTHING' : ''} ${returning ? 'RETURNING id' : ''}`,
    params
  );
  return res.rows;
}

async function insertCandles(c, rows, tf) {
  const cd = rows.map((r) => ({ symbol: SYMBOL, timeframe: tf, ...r }));
  for (let i = 0; i < cd.length; i += 1000)
    await bulkInsert(c, 'historical_candles', ['symbol', 'timeframe', 'open_time', 'open', 'high', 'low', 'close', 'volume'], cd.slice(i, i + 1000));
}

const PERSONAS = [
  { levs: [1, 2, 3], sl: 0.95, tp: 0.8, limit: 0.55, frac: [0.1, 0.25], dur: [20, 90], slPct: [0.004, 0.01], rr: [1.5, 3] },
  { levs: [7, 10, 10], sl: 0.1, tp: 0.25, limit: 0.1, frac: [0.3, 0.8], dur: [3, 40], slPct: [0.002, 0.006], rr: [1, 2] },
  { levs: [3, 5], sl: 0.5, tp: 0.6, limit: 0.2, frac: [0.15, 0.4], dur: [2, 12], slPct: [0.002, 0.005], rr: [1, 1.5] },
  { levs: [2, 3, 5], sl: 0.7, tp: 0.6, limit: 0.35, frac: [0.1, 0.3], dur: [10, 60], slPct: [0.003, 0.008], rr: [1.2, 2.5] },
];

async function seedHistory(c, candles, userIds) {
  const rand = mulberry32(777);
  const rr = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const N = 40;
  const owners = [];
  for (let i = 0; i < N; i++) owners.push(i < 28 ? userIds.trader : i < 34 ? userIds.analyst : userIds.admin);
  const balances = [10, 100, 1000];
  let totalPositions = 0;

  for (let k = 0; k < N; k++) {
    const persona = PERSONAS[k % PERSONAS.length];
    const initial = balances[k % 3];
    let balance = initial;
    let idx = Math.floor(rand() * candles.length * 0.25);
    const startIdx = idx;
    const posRows = [], ordRows = [];
    for (let n = 0; n < 150; n++) {
      idx += Math.floor(rr(1, 20));
      const maxDur = Math.floor(rr(persona.dur[0], persona.dur[1]));
      if (idx + maxDur + 2 >= candles.length || balance < 1.5) break;
      const side = rand() < 0.5 ? 'LONG' : 'SHORT';
      const lev = pick(persona.levs);
      const isLimit = rand() < persona.limit;
      const margin = Math.max(1, Math.min(balance * 0.9, balance * rr(persona.frac[0], persona.frac[1])));
      const entry = candles[idx].close;
      const notional = margin * lev;
      const qty = notional / entry;
      const liq = calcLiq(side, entry, lev);
      const slPct = rr(persona.slPct[0], persona.slPct[1]);
      const sl = rand() < persona.sl ? (side === 'LONG' ? entry * (1 - slPct) : entry * (1 + slPct)) : null;
      const tpPct = slPct * rr(persona.rr[0], persona.rr[1]);
      const tp = rand() < persona.tp ? (side === 'LONG' ? entry * (1 + tpPct) : entry * (1 - tpPct)) : null;
      const pos = { side, liquidation_price: liq, stop_loss: sl, take_profit: tp };
      let exitIdx = idx + maxDur, exitPrice = candles[exitIdx].close, reason = 'MANUAL';
      for (let j = idx + 1; j <= idx + maxDur; j++) {
        const ex = checkExit(pos, candles[j]);
        if (ex) { exitIdx = j; exitPrice = ex.price; reason = ex.reason; break; }
      }
      const openFee = notional * (isLimit ? FEES.MAKER : FEES.TAKER);
      let closeFee = 0, realized, status = 'CLOSED';
      const pnl = (side === 'LONG' ? exitPrice - entry : entry - exitPrice) * qty;
      if (reason === 'LIQUIDATED') { status = 'LIQUIDATED'; realized = -margin - openFee; }
      else { closeFee = exitPrice * qty * FEES.TAKER; realized = pnl - openFee - closeFee; }
      balance = Math.max(0, balance + realized);
      const openedAt = new Date(candles[idx].open_time);
      ordRows.push({ session_id: null, side, order_type: isLimit ? 'LIMIT' : 'MARKET', leverage: lev, quantity_btc: qty, margin_usdc: margin,
        limit_price: isLimit ? entry : null, stop_loss: sl, take_profit: tp, status: 'FILLED', created_at: openedAt });
      posRows.push({ side, leverage: lev, entry_price: entry, exit_price: exitPrice, liquidation_price: liq, margin_usdc: margin, quantity_btc: qty,
        stop_loss: sl, take_profit: tp, opening_fee_usdc: openFee, closing_fee_usdc: closeFee, realized_pnl_usdc: realized, status,
        close_reason: reason, opened_at: openedAt, closed_at: new Date(candles[exitIdx].open_time) });
      idx = exitIdx;
    }
    // ordine anulate (zgomot realist)
    const cancelled = Math.floor(rr(1, 4));
    for (let q = 0; q < cancelled; q++) {
      const price = candles[startIdx].close;
      ordRows.push({ session_id: null, side: 'LONG', order_type: 'LIMIT', leverage: 2, quantity_btc: 2 / price, margin_usdc: 1, limit_price: price * 0.9,
        stop_loss: null, take_profit: null, status: 'CANCELLED', created_at: new Date(candles[startIdx].open_time) });
    }
    const createdAt = new Date(Date.now() - (N - k) * 86400000);
    const lastPos = posRows[posRows.length - 1];
    const simStart = new Date(candles[startIdx].open_time);
    const simEnd = lastPos ? lastPos.closed_at : simStart;
    const sess = (await c.query(
      `INSERT INTO trading_sessions (user_id, name, mode, initial_balance, final_balance, current_balance, simulated_start_time,
          simulated_current_time, status, created_at, ended_at)
       VALUES ($1,$2,'TIME_MACHINE',$3,$4,$4,$5,$6,'CLOSED',$7,$8) RETURNING *`,
      [owners[k], `Demo session #${k + 1}`, initial, balance, simStart, simEnd, createdAt, new Date(createdAt.getTime() + 3600000)]
    )).rows[0];
    ordRows.forEach((o) => (o.session_id = sess.id));
    const ordIds = await bulkInsert(c, 'orders',
      ['session_id', 'side', 'order_type', 'leverage', 'quantity_btc', 'margin_usdc', 'limit_price', 'stop_loss', 'take_profit', 'status', 'created_at'],
      ordRows, true);
    posRows.forEach((p, i) => { p.session_id = sess.id; p.order_id = ordIds[i].id; });
    await bulkInsert(c, 'positions',
      ['session_id', 'order_id', 'side', 'leverage', 'entry_price', 'exit_price', 'liquidation_price', 'margin_usdc', 'quantity_btc', 'stop_loss',
        'take_profit', 'opening_fee_usdc', 'closing_fee_usdc', 'realized_pnl_usdc', 'status', 'close_reason', 'opened_at', 'closed_at'],
      posRows);
    totalPositions += posRows.length;
    const positions = (await c.query('SELECT * FROM positions WHERE session_id=$1 ORDER BY id', [sess.id])).rows;
    const orders = (await c.query('SELECT * FROM orders WHERE session_id=$1 ORDER BY id', [sess.id])).rows;
    const review = await saveReview(c, sess, positions, orders);
    if (k % 5 === 0) {
      await c.query('UPDATE trader_reviews SET mentor_notes=$1 WHERE id=$2', [
        'Audit note: check leverage discipline and stop-loss usage relative to account size.', review.id]);
    }
  }
  console.log(`[seed] Inserted ${N} closed sessions with ${totalPositions} positions and ${N} reviews.`);
}

export async function seedIfEmpty() {
  const hasRoles = (await pool.query('SELECT COUNT(*)::int n FROM roles')).rows[0].n;
  if (hasRoles > 0) {
    console.log('[seed] Database already seeded - skipping fixtures.');
    return;
  }
  console.log('[seed] Empty database detected - inserting fixtures (this takes a few seconds)...');
  const candles = await loadCandles1m();
  const hashes = {};
  for (const a of DEMO_ACCOUNTS) hashes[a.username] = await bcrypt.hash(a.password, ROUNDS);

  await withTx(async (c) => {
    const roleIds = {};
    for (const r of ROLES) {
      const { rows } = await c.query('INSERT INTO roles (name, permissions, description) VALUES ($1,$2,$3) RETURNING id',
        [r.name, JSON.stringify(r.permissions), r.description]);
      roleIds[r.name] = rows[0].id;
    }
    const userIds = {};
    for (const a of DEMO_ACCOUNTS) {
      const { rows } = await c.query(
        'INSERT INTO users (username, email, password_hash, role_id, preferred_lang) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [a.username, a.email, hashes[a.username], roleIds[a.role], 'ro']);
      userIds[a.username] = rows[0].id;
    }
    await insertCandles(c, candles, '1m');
    for (const tf of ['5m', '15m', '1h', '4h', '1d']) await insertCandles(c, aggregate(candles, TF_MIN[tf]), tf);
    console.log(`[seed] Candles inserted (1m: ${candles.length}, plus 5m/15m/1h/4h/1d aggregates).`);
    await seedHistory(c, candles, userIds);
    await c.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, entity_id, payload_json, ip_address) VALUES
        ($1::integer,'SEED','database',NULL,'{"note":"initial fixtures"}','127.0.0.1'),
        ($2::integer,'LOGIN','users',($2::integer)::text,'{"note":"demo login"}','127.0.0.1'),
        ($3::integer,'UPDATE','trader_reviews','1','{"field":"mentor_notes"}','127.0.0.1')`,
      [userIds.admin, userIds.trader, userIds.analyst]);
  });
  await pool.query('ANALYZE');
  console.log('[seed] Done.');
}
