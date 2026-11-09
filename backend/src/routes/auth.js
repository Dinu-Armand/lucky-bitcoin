import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import {
  authenticate, signToken, cookieOptions, COOKIE_NAME, BCRYPT_ROUNDS, JWT_EXPIRES, audit, invalidateUser,
} from '../auth.js';
import { asyncH, HttpError } from '../utils.js';

const r = Router();

async function userByLogin(login) {
  const { rows } = await query(
    `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1) OR lower(u.username)=lower($1)`,
    [login]
  );
  return rows[0];
}

const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, preferred_lang: u.preferred_lang, permissions: u.permissions });

r.post('/register', asyncH(async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password || String(password).length < 6 || !/^\S+@\S+\.\S+$/.test(email))
    throw new HttpError(400, 'Username, valid email and password (min 6 chars) are required', 'INVALID_REGISTER');
  const dup = await query('SELECT 1 FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($2)', [email, username]);
  if (dup.rowCount) throw new HttpError(409, 'Username or email already exists', 'USER_EXISTS');
  const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const role = (await query("SELECT id FROM roles WHERE name='TRADER'")).rows[0];
  const lang = req.body.lang === 'en' ? 'en' : 'ro';
  const ins = await query(
    'INSERT INTO users (username, email, password_hash, role_id, preferred_lang) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [username, email, hash, role.id, lang]
  );
  const u = await userByLogin(email);
  req.user = { id: ins.rows[0].id };
  await audit(req, 'REGISTER', 'users', ins.rows[0].id, { username });
  res.cookie(COOKIE_NAME, signToken(u), cookieOptions());
  res.status(201).json(publicUser(u));
}));

r.post('/login', asyncH(async (req, res) => {
  const { login, password } = req.body || {};
  const u = login ? await userByLogin(login) : null;
  // compare chiar si cand utilizatorul nu exista (timp constant aproximativ)
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  if (!u || !ok) throw new HttpError(401, 'Invalid credentials', 'BAD_CREDENTIALS');
  req.user = { id: u.id };
  await audit(req, 'LOGIN', 'users', u.id, { username: u.username });
  res.cookie(COOKIE_NAME, signToken(u), cookieOptions());
  const perms = (await query('SELECT permissions FROM roles WHERE id=$1', [u.role_id])).rows[0].permissions;
  res.json(publicUser({ ...u, permissions: perms }));
}));

r.post('/logout', authenticate, asyncH(async (req, res) => {
  await audit(req, 'LOGOUT', 'users', req.user.id, null);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}));

r.get('/me', authenticate, (req, res) => res.json(publicUser(req.user)));

r.put('/lang', authenticate, asyncH(async (req, res) => {
  const lang = req.body?.lang;
  if (!['ro', 'en'].includes(lang)) throw new HttpError(400, 'Invalid language', 'INVALID_LANG');
  await query('UPDATE users SET preferred_lang=$1 WHERE id=$2', [lang, req.user.id]);
  invalidateUser(req.user.id);
  res.json({ ok: true, lang });
}));

/** Date pentru tab-ul "Securitate & Autentificare". */
r.get('/security-info', authenticate, asyncH(async (req, res) => {
  const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  const hash = rows[0].password_hash;
  const m = /^\$(2[aby]?)\$(\d+)\$(.{22})(.{31})$/.exec(hash);
  const payload = jwt.decode(req.token);
  const now = Math.floor(Date.now() / 1000);
  res.json({
    username: req.user.username,
    role: req.user.role,
    password_hash: hash,
    hash_info: m ? { algorithm: 'bcrypt', version: m[1], rounds: Number(m[2]), cost_iterations: 2 ** Number(m[2]), salt: m[3], digest: m[4] } : null,
    token: { storage: 'httpOnly cookie "lb_token" (SameSite=Lax) - not readable by JavaScript', algorithm: 'HS256', expires_in_config: JWT_EXPIRES,
      payload, issued_at: new Date(payload.iat * 1000).toISOString(), expires_at: new Date(payload.exp * 1000).toISOString(), seconds_left: Math.max(0, payload.exp - now),
      preview: req.token.split('.').map((p, i) => (i < 2 ? p.slice(0, 18) + '…' : p.slice(0, 12) + '…')).join('.') },
  });
}));

/** Demonstreaza ca parola text NU este stocata: compara cu hash-ul din DB. */
r.post('/verify-password', authenticate, asyncH(async (req, res) => {
  const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  const t0 = Date.now();
  const match = await bcrypt.compare(String(req.body?.password || ''), rows[0].password_hash);
  res.json({ match, took_ms: Date.now() - t0 });
}));

/** Doua hash-uri ale aceluiasi text arata diferit (salt aleator). */
r.post('/hash-demo', authenticate, asyncH(async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 72);
  if (!text) throw new HttpError(400, 'Text required', 'INVALID_TEXT');
  const t0 = Date.now();
  const [a, b] = await Promise.all([bcrypt.hash(text, BCRYPT_ROUNDS), bcrypt.hash(text, BCRYPT_ROUNDS)]);
  res.json({ text, hash_1: a, hash_2: b, different: a !== b, rounds: BCRYPT_ROUNDS, took_ms: Date.now() - t0 });
}));

export default r;
