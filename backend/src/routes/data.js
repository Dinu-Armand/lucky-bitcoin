// CRUD generic pentru toate cele 8 tabele, cu RBAC pe tabel si pe coloana.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { authenticate, audit, BCRYPT_ROUNDS, invalidateUser } from '../auth.js';
import { asyncH, HttpError } from '../utils.js';

const r = Router();
r.use(authenticate);

const A = ['ADMIN'];
const AA = ['ADMIN', 'ANALYST'];

const TABLES = {
  roles: { read: A, cols: ['name', 'description', 'permissions'], json: ['permissions'], filters: [] },
  users: { read: A, cols: ['username', 'email', 'role_id', 'preferred_lang'], filters: ['role_id'], special: 'users' },
  trading_sessions: {
    read: AA, cols: ['user_id', 'name', 'notes', 'mode', 'initial_balance', 'final_balance', 'current_balance', 'simulated_start_time',
      'simulated_current_time', 'status', 'ended_at'], filters: ['user_id', 'status', 'mode'] },
  orders: {
    read: AA, cols: ['session_id', 'side', 'order_type', 'leverage', 'quantity_btc', 'margin_usdc', 'limit_price', 'stop_loss', 'take_profit', 'status'],
    filters: ['session_id', 'status'] },
  positions: {
    read: AA, cols: ['session_id', 'order_id', 'side', 'leverage', 'entry_price', 'exit_price', 'liquidation_price', 'margin_usdc', 'quantity_btc',
      'stop_loss', 'take_profit', 'opening_fee_usdc', 'closing_fee_usdc', 'realized_pnl_usdc', 'status', 'close_reason', 'opened_at', 'closed_at'],
    filters: ['session_id', 'status'] },
  trader_reviews: {
    read: AA, cols: ['session_id', 'user_id', 'score', 'grade', 'archetype', 'win_rate', 'avg_leverage', 'sl_usage_rate', 'total_fees_paid',
      'feedback_ro', 'feedback_en', 'mentor_notes', 'trader_notes'], filters: ['session_id', 'user_id'],
    writeCols: { ANALYST: ['mentor_notes'] }, writeRoles: ['ADMIN', 'ANALYST'], noCreateRoles: ['ANALYST'], noDeleteRoles: ['ANALYST'] },
  historical_candles: {
    read: AA, cols: ['symbol', 'timeframe', 'open_time', 'open', 'high', 'low', 'close', 'volume'], filters: ['symbol', 'timeframe'], order: 'open_time DESC',
    writeRoles: ['ADMIN', 'ANALYST'] },
  audit_logs: { read: A, cols: ['user_id', 'action', 'entity_name', 'entity_id', 'payload_json', 'ip_address'], json: ['payload_json'], filters: ['user_id', 'action'] },
};

const writeRolesOf = (t) => t.writeRoles || ['ADMIN'];
const writableCols = (t, role) => (t.writeCols?.[role] ? t.writeCols[role] : writeRolesOf(t).includes(role) ? t.cols : []);

function tableOf(req) {
  const t = TABLES[req.params.table];
  if (!t) throw new HttpError(404, 'Unknown table', 'NOT_FOUND');
  if (!t.read.includes(req.user.role)) throw new HttpError(403, 'Forbidden for your role', 'FORBIDDEN');
  return t;
}

/** Ce tabele poate vedea/modifica utilizatorul curent (folosit de UI). */
r.get('/_meta', (req, res) => {
  const out = [];
  for (const [name, t] of Object.entries(TABLES)) {
    if (!t.read.includes(req.user.role)) continue;
    out.push({
      table: name,
      canCreate: writableCols(t, req.user.role).length > 0 && !(t.noCreateRoles || []).includes(req.user.role),
      canDelete: writeRolesOf(t).includes(req.user.role) && !(t.noDeleteRoles || []).includes(req.user.role),
      writable: writableCols(t, req.user.role),
    });
  }
  res.json(out);
});

const clean = (v) => (v === '' ? null : v);

r.get('/:table', asyncH(async (req, res) => {
  const t = tableOf(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const where = [], vals = [];
  for (const f of t.filters) {
    if (req.query[f] !== undefined && req.query[f] !== '') { vals.push(req.query[f]); where.push(`${f}=$${vals.length}`); }
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await query(`SELECT COUNT(*)::int n FROM ${req.params.table} ${w}`, vals)).rows[0].n;
  const rows = (await query(
    `SELECT * FROM ${req.params.table} ${w} ORDER BY ${t.order || 'id DESC'} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, vals)).rows;
  res.json({ rows, total, page, limit });
}));

r.get('/:table/:id', asyncH(async (req, res) => {
  tableOf(req);
  const { rows } = await query(`SELECT * FROM ${req.params.table} WHERE id=$1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
  res.json(rows[0]);
}));

function pickBody(t, body, role) {
  const allowed = writableCols(t, role);
  const out = {};
  for (const c of allowed) {
    if (body[c] !== undefined) {
      let v = clean(body[c]);
      if (t.json?.includes(c) && v !== null && typeof v !== 'string') v = JSON.stringify(v);
      out[c] = v;
    }
  }
  return out;
}

r.post('/:table', asyncH(async (req, res) => {
  const name = req.params.table;
  const t = tableOf(req);
  if (!writableCols(t, req.user.role).length || (t.noCreateRoles || []).includes(req.user.role))
    throw new HttpError(403, 'Forbidden for your role', 'FORBIDDEN');
  const data = pickBody(t, req.body || {}, req.user.role);
  if (name === 'users') {
    if (!req.body.password || String(req.body.password).length < 6) throw new HttpError(400, 'Password (min 6 chars) required', 'INVALID_REGISTER');
    data.password_hash = await bcrypt.hash(String(req.body.password), BCRYPT_ROUNDS);
  }
  if (name === 'trading_sessions' && data.current_balance == null) data.current_balance = data.initial_balance;
  if (name === 'historical_candles' && !data.symbol) data.symbol = 'BTCUSDC';
  const keys = Object.keys(data);
  if (!keys.length) throw new HttpError(400, 'No data', 'INVALID_BODY');
  const { rows } = await query(
    `INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, keys.map((k) => data[k]));
  await audit(req, 'CREATE', name, rows[0].id, data);
  res.status(201).json(rows[0]);
}));

async function update(req, res) {
  const name = req.params.table;
  const t = tableOf(req);
  if (!writableCols(t, req.user.role).length) throw new HttpError(403, 'Forbidden for your role', 'FORBIDDEN');
  const data = pickBody(t, req.body || {}, req.user.role);
  if (name === 'users' && req.body.password) {
    data.password_hash = await bcrypt.hash(String(req.body.password), BCRYPT_ROUNDS);
  }
  const keys = Object.keys(data);
  if (!keys.length) throw new HttpError(400, 'No editable fields provided', 'INVALID_BODY');
  const { rows } = await query(
    `UPDATE ${name} SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(', ')} WHERE id=$${keys.length + 1} RETURNING *`,
    [...keys.map((k) => data[k]), req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Not found', 'NOT_FOUND');
  if (name === 'users') invalidateUser(rows[0].id);
  await audit(req, 'UPDATE', name, rows[0].id, { ...data, password_hash: data.password_hash ? '[rehashed]' : undefined });
  res.json(rows[0]);
}
r.put('/:table/:id', asyncH(update));
r.patch('/:table/:id', asyncH(update));

r.delete('/:table/:id', asyncH(async (req, res) => {
  const name = req.params.table;
  const t = tableOf(req);
  if (!writeRolesOf(t).includes(req.user.role) || (t.noDeleteRoles || []).includes(req.user.role))
    throw new HttpError(403, 'Forbidden for your role', 'FORBIDDEN');
  if (name === 'users' && Number(req.params.id) === req.user.id) throw new HttpError(409, 'You cannot delete your own account', 'SELF_DELETE');
  const { rowCount } = await query(`DELETE FROM ${name} WHERE id=$1`, [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Not found', 'NOT_FOUND');
  if (name === 'users') invalidateUser(Number(req.params.id));
  await audit(req, 'DELETE', name, req.params.id, null);
  res.json({ ok: true });
}));

export default r;
