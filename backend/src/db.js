import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// NUMERIC -> float, BIGINT -> int (valorile noastre incap in 2^53)
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/luckybitcoin';

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
export const query = (text, params) => pool.query(text, params);

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Creeaza baza de date daca nu exista (se conecteaza la baza administrativa "postgres"). */
export async function ensureDatabase() {
  const url = new URL(DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!r.rowCount) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
      console.log(`[db] Database "${dbName}" created.`);
    }
  } finally {
    await admin.end();
  }
}

export async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] Schema applied.');
}
