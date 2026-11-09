// Motorul de executie: ordine, pozitii, lichidari, comisioane, Time Machine, Live tick.
import { withTx, query, pool } from './db.js';
import { fetchLivePrice } from './binance.js';
import { saveReview } from './review.js';
import { ensureRange, TM_MIN_MS, tmMaxMs } from './history.js';
import { HttpError, SYMBOL, isPos, toNum } from './utils.js';

export const FEES = { MAKER: 0.0002, TAKER: 0.0005 };
export const MMR = 0.004; // maintenance margin rate

export const calcLiq = (side, entry, lev) =>
  side === 'LONG' ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR);

/** Verifica daca o lumanare (high/low) declanseaza iesirea unei pozitii. Folosit si de seed. */
export function checkExit(p, cd) {
  const long = p.side === 'LONG';
  const liq = p.liquidation_price;
  const sl = p.stop_loss, tp = p.take_profit;
  const hitLiq = long ? cd.low <= liq : cd.high >= liq;
  const hitSL = sl != null && (long ? cd.low <= sl : cd.high >= sl);
  const hitTP = tp != null && (long ? cd.high >= tp : cd.low <= tp);
  // SL-ul se atinge inaintea lichidarii daca e mai aproape de pretul de intrare
  const slFirst = hitSL && (!hitLiq || (long ? sl > liq : sl < liq));
  if (slFirst) return { price: sl, reason: 'STOP_LOSS' };
  if (hitLiq) return { price: liq, reason: 'LIQUIDATED' };
  if (hitTP) return { price: tp, reason: 'TAKE_PROFIT' };
  return null;
}

/* ---------------------------------------------------------------- helpers */

async function lockSession(c, id, userId, { requireActive = true } = {}) {
  const { rows } = await c.query('SELECT * FROM trading_sessions WHERE id=$1 FOR UPDATE', [id]);
  const s = rows[0];
  if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
  if (userId != null && s.user_id !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (requireActive && s.status !== 'ACTIVE') throw new HttpError(409, 'Session is closed', 'SESSION_CLOSED');
  return s;
}

async function saveSession(c, s) {
  await c.query('UPDATE trading_sessions SET current_balance=$1, simulated_current_time=$2 WHERE id=$3', [
    s.current_balance, s.simulated_current_time, s.id,
  ]);
}

export async function getMarket(c, s) {
  if (s.mode === 'TIME_MACHINE') {
    const { rows } = await c.query(
      `SELECT open_time, open, high, low, close FROM historical_candles
        WHERE symbol=$1 AND timeframe='1m' AND open_time <= $2 ORDER BY open_time DESC LIMIT 1`,
      [SYMBOL, new Date(s.simulated_current_time).getTime()]
    );
    if (!rows.length) throw new HttpError(409, 'No candle available for this time', 'NO_CANDLE');
    return { price: rows[0].close, time: rows[0].open_time, source: 'history' };
  }
  try {
    const price = await fetchLivePrice(SYMBOL);
    return { price, time: Date.now(), source: 'binance' };
  } catch {
    const { rows } = await c.query(
      `SELECT open_time, close FROM historical_candles WHERE symbol=$1 AND timeframe='1m' ORDER BY open_time DESC LIMIT 1`,
      [SYMBOL]
    );
    if (!rows.length) throw new HttpError(503, 'Price unavailable', 'NO_PRICE');
    return { price: rows[0].close, time: Date.now(), source: 'offline' };
  }
}

export async function buildState(c, s, market) {
  const m = market || (await getMarket(c, s));
  const positions = (await c.query('SELECT * FROM positions WHERE session_id=$1 ORDER BY id DESC', [s.id])).rows;
  const orders = (await c.query('SELECT * FROM orders WHERE session_id=$1 ORDER BY id DESC', [s.id])).rows;
  return { session: s, market: m, positions, orders };
}

async function loadCtx(c, s) {
  const pending = (await c.query("SELECT * FROM orders WHERE session_id=$1 AND status='PENDING'", [s.id])).rows;
  const open = (await c.query("SELECT * FROM positions WHERE session_id=$1 AND status='OPEN'", [s.id])).rows;
  return { c, s, pending, open, events: [] };
}

/* ---------------------------------------------------------- fill / close */

async function fillOrder(ctx, o, price, feeRate) {
  const { c, s } = ctx;
  const notional = o.margin_usdc * o.leverage;
  const qty = notional / price;
  const fee = notional * feeRate;
  const liq = calcLiq(o.side, price, o.leverage);
  const { rows } = await c.query(
    `INSERT INTO positions (session_id, order_id, side, leverage, entry_price, liquidation_price, margin_usdc,
        quantity_btc, stop_loss, take_profit, opening_fee_usdc, status, opened_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN',$12) RETURNING *`,
    [s.id, o.id, o.side, o.leverage, price, liq, o.margin_usdc, qty, o.stop_loss, o.take_profit, fee, s.simulated_current_time]
  );
  await c.query("UPDATE orders SET status='FILLED', quantity_btc=$1 WHERE id=$2", [qty, o.id]);
  s.current_balance -= fee;
  ctx.pending = ctx.pending.filter((x) => x.id !== o.id);
  ctx.open.push(rows[0]);
  ctx.events.push({ type: 'FILLED', order_id: o.id, position_id: rows[0].id, price, side: o.side });
  return rows[0];
}

async function closePosition(ctx, p, price, reason) {
  const { c, s } = ctx;
  const pnl = (p.side === 'LONG' ? price - p.entry_price : p.entry_price - price) * p.quantity_btc;
  let closeFee = 0, realized, status = 'CLOSED', back;
  if (reason === 'LIQUIDATED') {
    status = 'LIQUIDATED';
    realized = -p.margin_usdc - p.opening_fee_usdc;
    back = 0;
  } else {
    closeFee = price * p.quantity_btc * FEES.TAKER;
    realized = pnl - p.opening_fee_usdc - closeFee;
    back = Math.max(0, p.margin_usdc + pnl - closeFee);
  }
  s.current_balance += back;
  await c.query(
    `UPDATE positions SET status=$1, exit_price=$2, closing_fee_usdc=$3, realized_pnl_usdc=$4, close_reason=$5, closed_at=$6 WHERE id=$7`,
    [status, price, closeFee, realized, reason, s.simulated_current_time, p.id]
  );
  ctx.open = ctx.open.filter((x) => x.id !== p.id);
  ctx.events.push({ type: reason, position_id: p.id, price, pnl: realized, side: p.side });
}

/** Proceseaza o lumanare: ordine limit, apoi SL/TP/lichidare pentru pozitiile deschise. */
async function processCandle(ctx, cd) {
  const justOpened = new Set();
  for (const o of [...ctx.pending]) {
    if (o.order_type !== 'LIMIT') continue;
    const hit = o.side === 'LONG' ? cd.low <= o.limit_price : cd.high >= o.limit_price;
    if (hit) {
      const p = await fillOrder(ctx, o, o.limit_price, FEES.MAKER);
      justOpened.add(p.id);
    }
  }
  for (const p of [...ctx.open]) {
    if (justOpened.has(p.id)) continue;
    const ex = checkExit(p, cd);
    if (ex) await closePosition(ctx, p, ex.price, ex.reason);
  }
}

/* --------------------------------------------------------- public API */

function validateLevels(side, ref, sl, tp) {
  if (sl != null) {
    if (!isPos(sl)) throw new HttpError(400, 'Invalid Stop-Loss', 'INVALID_SL');
    if (side === 'LONG' ? sl >= ref : sl <= ref)
      throw new HttpError(400, 'Stop-Loss on the wrong side of the price', 'INVALID_SL');
  }
  if (tp != null) {
    if (!isPos(tp)) throw new HttpError(400, 'Invalid Take-Profit', 'INVALID_TP');
    if (side === 'LONG' ? tp <= ref : tp >= ref)
      throw new HttpError(400, 'Take-Profit on the wrong side of the price', 'INVALID_TP');
  }
}

export async function createSession(userId, { initial_balance, mode, startMs, name }) {
  if (![10, 100, 1000].includes(initial_balance)) throw new HttpError(400, 'Start amount must be 10, 100 or 1000', 'INVALID_BALANCE');
  if (!['LIVE', 'TIME_MACHINE'].includes(mode)) throw new HttpError(400, 'Invalid mode', 'INVALID_MODE');
  let tmStart = null;
  if (mode === 'TIME_MACHINE') {
    // Orice data din TM_MIN_MS (2011-09-14) pana acum: lumanarile lipsa se descarca la cerere (history.js).
    const DAY = 86400000;
    let t = Math.floor((Number.isFinite(startMs) && startMs ? startMs : tmMaxMs() - 30 * DAY) / 60000) * 60000;
    t = Math.min(tmMaxMs(), Math.max(TM_MIN_MS, t));
    await ensureRange(t - 2 * DAY, t + DAY); // 2 zile de context in urma + prima zi de joc
    const f = (await query(
      `SELECT MIN(open_time) AS t FROM historical_candles WHERE symbol=$1 AND timeframe='1m' AND open_time >= $2 AND open_time <= $3`,
      [SYMBOL, t, t + 7 * DAY])).rows[0];
    if (f.t == null) throw new HttpError(409, 'No market data available for the chosen date', 'NO_CANDLE');
    tmStart = new Date(f.t);
  }
  return withTx(async (c) => {
    const act = await c.query("SELECT id FROM trading_sessions WHERE user_id=$1 AND status='ACTIVE' FOR UPDATE", [userId]);
    if (act.rowCount) throw new HttpError(409, 'You already have an active session', 'ACTIVE_EXISTS');
    const start = tmStart || new Date();
    const { rows } = await c.query(
      `INSERT INTO trading_sessions (user_id, name, mode, initial_balance, current_balance, simulated_start_time, simulated_current_time)
       VALUES ($1,$2,$3,$4,$4,$5,$5) RETURNING *`,
      [userId, name || null, mode, initial_balance, start]
    );
    return buildState(c, rows[0]);
  });
}

export async function stateOf(userId, id) {
  const { rows } = await query('SELECT * FROM trading_sessions WHERE id=$1', [id]);
  const s = rows[0];
  if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
  if (userId != null && s.user_id !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (s.status === 'CLOSED') {
    const positions = (await query('SELECT * FROM positions WHERE session_id=$1 ORDER BY id DESC', [id])).rows;
    const orders = (await query('SELECT * FROM orders WHERE session_id=$1 ORDER BY id DESC', [id])).rows;
    return { session: s, market: null, positions, orders };
  }
  return buildState(pool, s);
}

export async function placeOrder(userId, id, body) {
  const side = body.side;
  const type = body.order_type || 'MARKET';
  const lev = Number(body.leverage);
  const margin = Number(body.margin_usdc);
  const limit = toNum(body.limit_price);
  const sl = toNum(body.stop_loss);
  const tp = toNum(body.take_profit);
  if (!['LONG', 'SHORT'].includes(side)) throw new HttpError(400, 'Invalid side', 'INVALID_SIDE');
  if (!['MARKET', 'LIMIT'].includes(type)) throw new HttpError(400, 'Invalid order type', 'INVALID_TYPE');
  if (!Number.isInteger(lev) || lev < 1 || lev > 10) throw new HttpError(400, 'Leverage must be 1-10', 'INVALID_LEVERAGE');
  if (!isPos(margin) || margin < 1) throw new HttpError(400, 'Minimum margin is 1 USDC', 'MIN_MARGIN');

  return withTx(async (c) => {
    const s = await lockSession(c, id, userId);
    if (s.mode === 'LIVE') s.simulated_current_time = new Date();
    const m = await getMarket(c, s);
    let ref = m.price;
    if (type === 'LIMIT') {
      if (!isPos(limit)) throw new HttpError(400, 'Limit price required', 'INVALID_LIMIT');
      if (side === 'LONG' ? limit >= m.price : limit <= m.price)
        throw new HttpError(400, 'LONG limit must be below price, SHORT limit above', 'INVALID_LIMIT');
      ref = limit;
    }
    validateLevels(side, ref, sl, tp);
    const feeRate = type === 'LIMIT' ? FEES.MAKER : FEES.TAKER;
    const fee = margin * lev * feeRate;
    if (s.current_balance < margin + fee) throw new HttpError(400, 'Insufficient balance', 'INSUFFICIENT_BALANCE');
    s.current_balance -= margin; // marja rezervata
    const { rows } = await c.query(
      `INSERT INTO orders (session_id, side, order_type, leverage, quantity_btc, margin_usdc, limit_price, stop_loss, take_profit, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10) RETURNING *`,
      [s.id, side, type, lev, (margin * lev) / ref, margin, type === 'LIMIT' ? limit : null, sl, tp, s.simulated_current_time]
    );
    const ctx = await loadCtx(c, s);
    if (type === 'MARKET') await fillOrder(ctx, rows[0], m.price, FEES.TAKER);
    await saveSession(c, s);
    const st = await buildState(c, s, m);
    st.events = ctx.events;
    return st;
  });
}

export async function modifyOrder(userId, id, oid, body) {
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId);
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 AND session_id=$2 FOR UPDATE', [oid, id])).rows[0];
    if (!o) throw new HttpError(404, 'Order not found', 'NOT_FOUND');
    if (o.status !== 'PENDING') throw new HttpError(409, 'Only pending orders can be modified', 'NOT_PENDING');
    if (s.mode === 'LIVE') s.simulated_current_time = new Date();
    const m = await getMarket(c, s);
    const limit = 'limit_price' in body ? toNum(body.limit_price) : o.limit_price;
    const sl = 'stop_loss' in body ? toNum(body.stop_loss) : o.stop_loss;
    const tp = 'take_profit' in body ? toNum(body.take_profit) : o.take_profit;
    if (o.order_type === 'LIMIT') {
      if (!isPos(limit) || (o.side === 'LONG' ? limit >= m.price : limit <= m.price))
        throw new HttpError(400, 'Invalid limit price', 'INVALID_LIMIT');
    }
    validateLevels(o.side, o.order_type === 'LIMIT' ? limit : m.price, sl, tp);
    await c.query('UPDATE orders SET limit_price=$1, stop_loss=$2, take_profit=$3 WHERE id=$4', [
      o.order_type === 'LIMIT' ? limit : null, sl, tp, oid,
    ]);
    return buildState(c, s, m);
  });
}

export async function deleteOrder(userId, id, oid) {
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId, { requireActive: false });
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 AND session_id=$2 FOR UPDATE', [oid, id])).rows[0];
    if (!o) throw new HttpError(404, 'Order not found', 'NOT_FOUND');
    if (o.status === 'PENDING') {
      if (s.status !== 'ACTIVE') throw new HttpError(409, 'Session is closed', 'SESSION_CLOSED');
      s.current_balance += o.margin_usdc; // elibereaza marja rezervata
      await c.query("UPDATE orders SET status='CANCELLED' WHERE id=$1", [oid]);
      await c.query('UPDATE trading_sessions SET current_balance=$1 WHERE id=$2', [s.current_balance, s.id]);
    } else {
      await c.query('DELETE FROM orders WHERE id=$1', [oid]);
    }
    return s.status === 'ACTIVE' ? buildState(c, s) : { session: s, market: null, positions: [], orders: [] };
  });
}

export async function modifyPosition(userId, id, pid, body) {
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId);
    const p = (await c.query('SELECT * FROM positions WHERE id=$1 AND session_id=$2 FOR UPDATE', [pid, id])).rows[0];
    if (!p) throw new HttpError(404, 'Position not found', 'NOT_FOUND');
    if (p.status !== 'OPEN') throw new HttpError(409, 'Position is not open', 'NOT_OPEN');
    if (s.mode === 'LIVE') s.simulated_current_time = new Date();
    const m = await getMarket(c, s);
    const sl = 'stop_loss' in body ? toNum(body.stop_loss) : p.stop_loss;
    const tp = 'take_profit' in body ? toNum(body.take_profit) : p.take_profit;
    validateLevels(p.side, m.price, sl, tp);
    await c.query('UPDATE positions SET stop_loss=$1, take_profit=$2 WHERE id=$3', [sl, tp, pid]);
    return buildState(c, s, m);
  });
}

export async function closePositionManual(userId, id, pid) {
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId);
    if (s.mode === 'LIVE') s.simulated_current_time = new Date();
    const ctx = await loadCtx(c, s);
    const p = ctx.open.find((x) => x.id === pid);
    if (!p) throw new HttpError(404, 'Open position not found', 'NOT_FOUND');
    const m = await getMarket(c, s);
    await closePosition(ctx, p, m.price, 'MANUAL');
    await saveSession(c, s);
    const st = await buildState(c, s, m);
    st.events = ctx.events;
    return st;
  });
}

export async function deletePosition(userId, id, pid) {
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId, { requireActive: false });
    const p = (await c.query('SELECT * FROM positions WHERE id=$1 AND session_id=$2 FOR UPDATE', [pid, id])).rows[0];
    if (!p) throw new HttpError(404, 'Position not found', 'NOT_FOUND');
    if (p.status === 'OPEN') throw new HttpError(409, 'Close the position before deleting its record', 'POSITION_OPEN');
    await c.query('DELETE FROM positions WHERE id=$1', [pid]);
    return s.status === 'ACTIVE' ? buildState(c, s) : { session: s, market: null, positions: [], orders: [] };
  });
}

/** Time Machine: avanseaza `steps` lumanari de 1m (fara lookahead: doar lumanarile deja "formate"). */
export async function advance(userId, id, steps) {
  const cur = (await query('SELECT mode, simulated_current_time FROM trading_sessions WHERE id=$1', [id])).rows[0];
  if (cur && cur.mode === 'TIME_MACHINE') {
    const at = new Date(cur.simulated_current_time).getTime();
    await ensureRange(at, at + (steps + 1500) * 60000); // prefetch: urmatoarea zi, ca sa nu apara pauze la viteze mari
  }
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId);
    if (s.mode !== 'TIME_MACHINE') throw new HttpError(400, 'Fast-forward is only available in Time Machine mode', 'NOT_TIME_MACHINE');
    const last = new Date(s.simulated_current_time).getTime();
    const { rows } = await c.query(
      `SELECT open_time, open, high, low, close FROM historical_candles
        WHERE symbol=$1 AND timeframe='1m' AND open_time > $2 ORDER BY open_time LIMIT $3`,
      [SYMBOL, last, steps]
    );
    const ctx = await loadCtx(c, s);
    for (const cd of rows) {
      s.simulated_current_time = new Date(cd.open_time);
      await processCandle(ctx, cd);
    }
    await saveSession(c, s);
    const st = await buildState(c, s);
    st.events = ctx.events;
    st.ended = rows.length < steps;
    return st;
  });
}

/** Live: preia pretul curent si verifica ordinele/SL/TP/lichidarea la acest pret. */
export async function tickLive(userId, id) {
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId);
    if (s.mode !== 'LIVE') throw new HttpError(400, 'Tick is only for Live mode', 'NOT_LIVE');
    const m = await getMarket(c, s);
    s.simulated_current_time = new Date();
    const ctx = await loadCtx(c, s);
    if (ctx.pending.length || ctx.open.length) {
      await processCandle(ctx, { open_time: Date.now(), open: m.price, high: m.price, low: m.price, close: m.price });
    }
    await saveSession(c, s);
    const st = await buildState(c, s, m);
    st.events = ctx.events;
    return st;
  });
}

/** "Sesiune noua": inchide pozitiile la pret curent, anuleaza ordinele, salveaza recenzia, arhiveaza. */
export async function closeSession(userId, id) {
  return withTx(async (c) => {
    const s = await lockSession(c, id, userId);
    if (s.mode === 'LIVE') s.simulated_current_time = new Date();
    const m = await getMarket(c, s);
    const ctx = await loadCtx(c, s);
    for (const p of [...ctx.open]) await closePosition(ctx, p, m.price, 'SESSION_END');
    for (const o of ctx.pending) {
      s.current_balance += o.margin_usdc;
      await c.query("UPDATE orders SET status='CANCELLED' WHERE id=$1", [o.id]);
    }
    await c.query(
      `UPDATE trading_sessions SET status='CLOSED', current_balance=$1, final_balance=$1, simulated_current_time=$2, ended_at=now() WHERE id=$3`,
      [s.current_balance, s.simulated_current_time, s.id]
    );
    const session = (await c.query('SELECT * FROM trading_sessions WHERE id=$1', [s.id])).rows[0];
    const positions = (await c.query('SELECT * FROM positions WHERE session_id=$1 ORDER BY id', [s.id])).rows;
    const orders = (await c.query('SELECT * FROM orders WHERE session_id=$1 ORDER BY id', [s.id])).rows;
    const review = await saveReview(c, session, positions, orders);
    const fees = positions.reduce((a, p) => a + p.opening_fee_usdc + p.closing_fee_usdc, 0);
    return { session, review, trades: positions.length, fees, events: ctx.events };
  });
}

/** Recenzie pe sesiunea curenta (buton "Analizeaza profilul") - poate fi apasat de oricate ori. */
export async function reviewSession(userId, id) {
  const { rows } = await query('SELECT * FROM trading_sessions WHERE id=$1', [id]);
  const s = rows[0];
  if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
  if (userId != null && s.user_id !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  const positions = (await query('SELECT * FROM positions WHERE session_id=$1 ORDER BY id', [id])).rows;
  const orders = (await query('SELECT * FROM orders WHERE session_id=$1 ORDER BY id', [id])).rows;
  return saveReview(pool, s, positions, orders);
}
