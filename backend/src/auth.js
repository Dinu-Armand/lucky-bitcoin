import jwt from 'jsonwebtoken';
import { query } from './db.js';
import { HttpError } from './utils.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'lucky-bitcoin-dev-secret';
export const JWT_EXPIRES = '8h';
export const COOKIE_NAME = 'lb_token';
export const BCRYPT_ROUNDS = 12;

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });
}

export function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 8 * 3600 * 1000, path: '/' };
}

const userCache = new Map(); // id -> {t, user}

export function invalidateUser(id) {
  userCache.delete(id);
}

async function loadUser(id) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.t < 5000) return hit.user;
  const { rows } = await query(
    `SELECT u.id, u.username, u.email, u.preferred_lang, u.created_at, r.name AS role, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [id]
  );
  const user = rows[0] || null;
  userCache.set(id, { t: Date.now(), user });
  return user;
}

/** Middleware JWT: citeste tokenul din cookie httpOnly sau din antetul Authorization: Bearer. */
export async function authenticate(req, res, next) {
  try {
    let token = req.cookies?.[COOKIE_NAME];
    const h = req.headers.authorization;
    if (!token && h && h.startsWith('Bearer ')) token = h.slice(7);
    if (!token) throw new HttpError(401, 'Not authenticated', 'UNAUTHENTICATED');
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      throw new HttpError(401, 'Invalid or expired token', 'TOKEN_INVALID');
    }
    const user = await loadUser(payload.sub);
    if (!user) throw new HttpError(401, 'User no longer exists', 'TOKEN_INVALID');
    req.user = user;
    req.token = token;
    req.jwt = payload;
    next();
  } catch (e) {
    next(e);
  }
}

/** RBAC: permite doar rolurile listate. */
export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new HttpError(403, 'Forbidden for your role', 'FORBIDDEN'));

export async function audit(req, action, entity, entityId, payload) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_name, entity_id, payload_json, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req?.user?.id ?? null,
        action,
        entity ?? null,
        entityId != null ? String(entityId) : null,
        payload ? JSON.stringify(payload) : null,
        req?.ip ?? null,
      ]
    );
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}
