import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../auth.js';
import { fetchKlines, fetchLivePrice } from '../binance.js';
import { asyncH, HttpError, aggregate, TF_MIN, SYMBOL } from '../utils.js';
import { getMarket } from '../engine.js';
import { ensureRange, TM_MIN_MS, tmMaxMs } from '../history.js';

const r = Router();
r.use(authenticate);

const toChart = (rows) => rows.map((c) => ({ time: Math.floor(c.open_time / 1000), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));

async function sessionFor(req) {
  const id = parseInt(req.query.session, 10);
  if (!id) return null;
  const { rows } = await query('SELECT * FROM trading_sessions WHERE id=$1', [id]);
  const s = rows[0];
  if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
  if (s.user_id !== req.user.id && !['ANALYST', 'ADMIN'].includes(req.user.role)) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  return s;
}

r.get('/price', asyncH(async (req, res) => {
  const s = await sessionFor(req);
  if (s) {
    const m = await getMarket({ query }, s);
    return res.json({ symbol: SYMBOL, ...m });
  }
  try {
    res.json({ symbol: SYMBOL, price: await fetchLivePrice(SYMBOL), time: Date.now(), source: 'binance' });
  } catch {
    const { rows } = await query(`SELECT open_time, close FROM historical_candles WHERE symbol=$1 AND timeframe='1m' ORDER BY open_time DESC LIMIT 1`, [SYMBOL]);
    res.json({ symbol: SYMBOL, price: rows[0]?.close ?? null, time: Date.now(), source: 'offline' });
  }
}));

/**
 * Lumanari pentru grafic.
 * - TIME_MACHINE: agregate din 1m, STRICT pana la simulated_current_time (anti-lookahead).
 * - LIVE: proxy catre Binance REST; fallback pe datele din DB daca nu exista internet.
 */
r.get('/candles', asyncH(async (req, res) => {
  const tf = TF_MIN[req.query.timeframe] ? req.query.timeframe : '1m';
  const limit = Math.min(1000, Math.max(10, parseInt(req.query.limit, 10) || 300));
  const s = await sessionFor(req);
  if (s && s.mode === 'TIME_MACHINE') {
    const upTo = new Date(s.simulated_current_time).getTime();
    const need = Math.min(30000, limit * TF_MIN[tf] + TF_MIN[tf]);
    await ensureRange(upTo - Math.min(need, 4320) * 60000, upTo); // contextul graficului (max 3 zile in urma) se descarca la cerere
    const { rows } = await query(
      `SELECT open_time, open, high, low, close, volume FROM historical_candles
        WHERE symbol=$1 AND timeframe='1m' AND open_time <= $2 ORDER BY open_time DESC LIMIT $3`,
      [SYMBOL, upTo, need]);
    const agg = aggregate(rows.reverse(), TF_MIN[tf]).slice(-limit);
    return res.json({ timeframe: tf, source: 'history', candles: toChart(agg) });
  }
  try {
    const k = await fetchKlines(SYMBOL, tf, limit);
    return res.json({ timeframe: tf, source: 'binance', candles: toChart(k) });
  } catch {
    const { rows } = await query(
      `SELECT open_time, open, high, low, close, volume FROM historical_candles
        WHERE symbol=$1 AND timeframe=$2 ORDER BY open_time DESC LIMIT $3`, [SYMBOL, tf, limit]);
    res.json({ timeframe: tf, source: 'offline', candles: toChart(rows.reverse()) });
  }
}));

r.get('/bounds', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM historical_candles WHERE symbol=$1 AND timeframe='1m'`, [SYMBOL]);
  // Time Machine accepta orice data intre primele date Bitstamp (2011-09-14) si acum; lumanarile se descarca la cerere.
  res.json({ min_time: TM_MIN_MS, max_time: tmMaxMs(), count: rows[0].count });
}));

/** Evenimente istorice celebre (UTC). Se porneste cu cateva ore inainte, ca sa nu vezi "spoilerul". */
const EVENTS = [
  { key: 'peak_2013', time: Date.UTC(2013, 10, 29, 0, 0) },
  { key: 'peak_2017', time: Date.UTC(2017, 11, 16, 12, 0) },
  { key: 'black_thursday', time: Date.UTC(2020, 2, 12, 0, 0) },
  { key: 'coinbase_peak', time: Date.UTC(2021, 3, 14, 8, 0) },
  { key: 'may_crash', time: Date.UTC(2021, 4, 19, 6, 0) },
  { key: 'ftx_collapse', time: Date.UTC(2022, 10, 8, 12, 0) },
  { key: 'halving_2024', time: Date.UTC(2024, 3, 20, 0, 0) },
];
r.get('/events', (req, res) => res.json(EVENTS));

export default r;
