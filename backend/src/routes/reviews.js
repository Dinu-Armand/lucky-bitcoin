import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, audit } from '../auth.js';
import { asyncH, HttpError } from '../utils.js';

const r = Router();
r.use(authenticate);
const isStaff = (u) => ['ANALYST', 'ADMIN'].includes(u.role);

async function load(req) {
  const { rows } = await query(
    `SELECT rv.*, u.username FROM trader_reviews rv JOIN users u ON u.id=rv.user_id WHERE rv.id=$1`, [req.params.id]);
  const rv = rows[0];
  if (!rv) throw new HttpError(404, 'Review not found', 'NOT_FOUND');
  if (rv.user_id !== req.user.id && !isStaff(req.user)) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  return rv;
}

r.get('/', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT rv.*, u.username FROM trader_reviews rv JOIN users u ON u.id=rv.user_id
      WHERE ($1::boolean OR rv.user_id=$2) ORDER BY rv.created_at DESC LIMIT 300`, [isStaff(req.user), req.user.id]);
  res.json(rows);
}));

r.get('/:id', asyncH(async (req, res) => res.json(await load(req))));

/** UPDATE: TRADER -> trader_notes (propria recenzie); ANALYST -> mentor_notes; ADMIN -> ambele. */
r.put('/:id', asyncH(async (req, res) => {
  const rv = await load(req);
  const b = req.body || {};
  const role = req.user.role;
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.trader_notes !== undefined && (role === 'ADMIN' || (role === 'TRADER' && rv.user_id === req.user.id))) add('trader_notes', b.trader_notes);
  if (b.mentor_notes !== undefined && (role === 'ADMIN' || role === 'ANALYST')) add('mentor_notes', b.mentor_notes);
  if (!sets.length) throw new HttpError(403, 'No editable fields for your role', 'FORBIDDEN');
  sets.push('updated_at=now()');
  vals.push(rv.id);
  const { rows } = await query(`UPDATE trader_reviews SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  await audit(req, 'UPDATE', 'trader_reviews', rv.id, { fields: Object.keys(b) });
  res.json(rows[0]);
}));

r.delete('/:id', asyncH(async (req, res) => {
  const rv = await load(req);
  if (!(req.user.role === 'ADMIN' || (req.user.role === 'TRADER' && rv.user_id === req.user.id)))
    throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  await query('DELETE FROM trader_reviews WHERE id=$1', [rv.id]);
  await audit(req, 'DELETE', 'trader_reviews', rv.id, null);
  res.json({ ok: true });
}));

export default r;
