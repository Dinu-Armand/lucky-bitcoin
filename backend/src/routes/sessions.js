import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, requireRole, audit } from '../auth.js';
import { asyncH, HttpError } from '../utils.js';
import * as eng from '../engine.js';

const r = Router();
r.use(authenticate);

const isStaff = (u) => ['ANALYST', 'ADMIN'].includes(u.role);
const canTrade = requireRole('TRADER', 'ADMIN');
const sid = (req) => {
  const id = parseInt(req.params.id, 10);
  if (!id) throw new HttpError(400, 'Invalid id', 'INVALID_ID');
  return id;
};

async function loadSession(req, { write = false } = {}) {
  const id = sid(req);
  const { rows } = await query(
    'SELECT s.*, u.username FROM trading_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1', [id]);
  const s = rows[0];
  if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
  const own = s.user_id === req.user.id;
  const allowed = write ? own || req.user.role === 'ADMIN' : own || isStaff(req.user);
  if (!allowed) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  return s;
}

const LIST_SQL = `
  SELECT s.*, u.username,
         COALESCE(p.trades,0)::int AS trades, COALESCE(p.fees,0) AS fees, COALESCE(p.pnl,0) AS pnl,
         rv.id AS review_id, rv.score, rv.grade, rv.archetype
    FROM trading_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN (SELECT session_id, COUNT(*) AS trades, SUM(opening_fee_usdc + closing_fee_usdc) AS fees, SUM(realized_pnl_usdc) AS pnl
                 FROM positions WHERE status <> 'OPEN' GROUP BY session_id) p ON p.session_id = s.id
    LEFT JOIN trader_reviews rv ON rv.session_id = s.id
   WHERE ($1::boolean OR s.user_id = $2)
   ORDER BY s.created_at DESC
   LIMIT 300`;

r.get('/', asyncH(async (req, res) => {
  const { rows } = await query(LIST_SQL, [isStaff(req.user), req.user.id]);
  res.json(rows);
}));

r.get('/active', asyncH(async (req, res) => {
  const { rows } = await query("SELECT * FROM trading_sessions WHERE user_id=$1 AND status='ACTIVE' LIMIT 1", [req.user.id]);
  res.json({ session: rows[0] || null });
}));

r.post('/', canTrade, asyncH(async (req, res) => {
  const { initial_balance, mode = 'LIVE', start_time, name } = req.body || {};
  const startMs = start_time ? new Date(start_time).getTime() : null;
  if (start_time && Number.isNaN(startMs)) throw new HttpError(400, 'Invalid start time', 'INVALID_TIME');
  const st = await eng.createSession(req.user.id, { initial_balance: Number(initial_balance), mode, startMs, name });
  await audit(req, 'CREATE', 'trading_sessions', st.session.id, { initial_balance, mode });
  res.status(201).json(st);
}));

r.get('/:id', asyncH(async (req, res) => {
  const s = await loadSession(req);
  res.json(s);
}));

r.get('/:id/state', canTrade, asyncH(async (req, res) => {
  res.json(await eng.stateOf(req.user.id, sid(req)));
}));

/** Vizualizare read-only a pozitiilor/ordinelor unei sesiuni (inclusiv pentru ANALYST). */
r.get('/:id/positions', asyncH(async (req, res) => {
  await loadSession(req);
  res.json((await query('SELECT * FROM positions WHERE session_id=$1 ORDER BY id DESC', [sid(req)])).rows);
}));
r.get('/:id/orders', asyncH(async (req, res) => {
  await loadSession(req);
  res.json((await query('SELECT * FROM orders WHERE session_id=$1 ORDER BY id DESC', [sid(req)])).rows);
}));

r.put('/:id', asyncH(async (req, res) => {
  await loadSession(req, { write: true });
  const { name, notes } = req.body || {};
  const { rows } = await query(
    'UPDATE trading_sessions SET name=COALESCE($1,name), notes=COALESCE($2,notes) WHERE id=$3 RETURNING *',
    [name ?? null, notes ?? null, sid(req)]);
  await audit(req, 'UPDATE', 'trading_sessions', sid(req), { name, notes });
  res.json(rows[0]);
}));

r.delete('/:id', asyncH(async (req, res) => {
  const s = await loadSession(req, { write: true });
  if (s.status === 'ACTIVE') throw new HttpError(409, 'Close the active session first', 'SESSION_ACTIVE');
  await query('DELETE FROM trading_sessions WHERE id=$1', [s.id]);
  await audit(req, 'DELETE', 'trading_sessions', s.id, null);
  res.json({ ok: true });
}));

/* ---- Motor ---- */
r.post('/:id/advance', canTrade, asyncH(async (req, res) => {
  const steps = Math.min(500, Math.max(1, parseInt(req.body?.steps, 10) || 1));
  res.json(await eng.advance(req.user.id, sid(req), steps));
}));
r.post('/:id/tick', canTrade, asyncH(async (req, res) => res.json(await eng.tickLive(req.user.id, sid(req)))));
r.post('/:id/close', canTrade, asyncH(async (req, res) => {
  const out = await eng.closeSession(req.user.id, sid(req));
  await audit(req, 'CLOSE_SESSION', 'trading_sessions', out.session.id, { final_balance: out.session.final_balance, score: out.review.score });
  res.json(out);
}));

/* ---- Ordine ---- */
r.post('/:id/orders', canTrade, asyncH(async (req, res) => res.status(201).json(await eng.placeOrder(req.user.id, sid(req), req.body || {}))));
r.put('/:id/orders/:oid', canTrade, asyncH(async (req, res) =>
  res.json(await eng.modifyOrder(req.user.id, sid(req), parseInt(req.params.oid, 10), req.body || {}))));
r.delete('/:id/orders/:oid', canTrade, asyncH(async (req, res) =>
  res.json(await eng.deleteOrder(req.user.id, sid(req), parseInt(req.params.oid, 10)))));

/* ---- Pozitii ---- */
r.put('/:id/positions/:pid', canTrade, asyncH(async (req, res) =>
  res.json(await eng.modifyPosition(req.user.id, sid(req), parseInt(req.params.pid, 10), req.body || {}))));
r.post('/:id/positions/:pid/close', canTrade, asyncH(async (req, res) =>
  res.json(await eng.closePositionManual(req.user.id, sid(req), parseInt(req.params.pid, 10)))));
r.delete('/:id/positions/:pid', canTrade, asyncH(async (req, res) =>
  res.json(await eng.deletePosition(req.user.id, sid(req), parseInt(req.params.pid, 10)))));

/* ---- Recenzie ---- */
r.get('/:id/review', asyncH(async (req, res) => {
  await loadSession(req);
  const { rows } = await query('SELECT * FROM trader_reviews WHERE session_id=$1', [sid(req)]);
  res.json({ review: rows[0] || null });
}));
r.post('/:id/review', canTrade, asyncH(async (req, res) => {
  const review = await eng.reviewSession(req.user.id, sid(req));
  await audit(req, 'GENERATE_REVIEW', 'trader_reviews', review.id, { score: review.score });
  res.json({ review });
}));

export default r;
