// Istoric la cerere pentru Time Machine: aduce lumanari de 1 minut pentru ORICE data si le salveaza in historical_candles.
//
// Surse (in ordine), toate publice, fara cheie API:
//   1. Binance BTCUSDC  (din momentul listarii perechii)
//   2. Binance BTCUSDT  (din 2017-08; USDT ~ USDC ca pret, folosit ca proxy inainte de listarea BTCUSDC)
//   3. Bitstamp BTC/USD (din 2011-09; folosit pentru perioada dinaintea Binance)
// O sursa Binance este acceptata doar daca prima lumanare returnata este chiar langa momentul cerut
// (altfel Binance returneaza primele date disponibile DUPA listare, ceea ce ar fi o data gresita).
// Datele sunt stocate sub simbolul BTCUSDC, astfel incat restul aplicatiei ramane neschimbat.
import { pool } from './db.js';
import { fetchKlines } from './binance.js';
import { SYMBOL } from './utils.js';

const MIN = 60000;
const DAY = 86400000;
/** Cea mai veche data disponibila cu lumanari de 1 minut (primele date Bitstamp). */
export const TM_MIN_MS = Date.UTC(2011, 8, 14);
/** Ultimul moment permis in Time Machine (cu o marja fata de prezent). */
export const tmMaxMs = () => Date.now() - 60 * MIN;

const nearStart = (candles, startMs) => candles.length > 0 && candles[0].open_time - startMs < 2 * 60 * MIN;

async function bitstamp(startMs) {
  const url = `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=60&limit=1000&start=${Math.floor(startMs / 1000)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Bitstamp HTTP ${r.status}`);
  const j = await r.json();
  return (j.data?.ohlc || []).map((k) => ({
    open_time: Number(k.timestamp) * 1000, open: parseFloat(k.open), high: parseFloat(k.high),
    low: parseFloat(k.low), close: parseFloat(k.close), volume: parseFloat(k.volume),
  }));
}

/** Pana la 1000 de lumanari de 1m incepand cu startMs, de la prima sursa care are date pentru acel moment. */
async function fetchSegment(startMs) {
  let lastErr = null;
  for (const symbol of ['BTCUSDC', 'BTCUSDT']) {
    try {
      const k = await fetchKlines(symbol, '1m', 1000, { startTime: startMs });
      if (nearStart(k, startMs)) return k;
    } catch (e) { lastErr = e; }
  }
  try {
    return await bitstamp(startMs);
  } catch (e) {
    throw lastErr || e;
  }
}

async function store(rows) {
  const clean = rows.filter((r) => [r.open, r.high, r.low, r.close].every((x) => Number.isFinite(x) && x > 0))
    .map((r) => ({ ...r, high: Math.max(r.high, r.low, r.open, r.close), low: Math.min(r.high, r.low, r.open, r.close), volume: Number.isFinite(r.volume) ? r.volume : 0 }));
  if (!clean.length) return 0;
  await pool.query(
    `INSERT INTO historical_candles (symbol, timeframe, open_time, open, high, low, close, volume)
     SELECT $1::text, '1m', t.ot, t.o, t.h, t.l, t.c, t.v
       FROM unnest($2::bigint[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[]) AS t(ot, o, h, l, c, v)
     ON CONFLICT DO NOTHING`,
    [SYMBOL, clean.map((r) => r.open_time), clean.map((r) => r.open), clean.map((r) => r.high), clean.map((r) => r.low),
      clean.map((r) => r.close), clean.map((r) => r.volume)]);
  return clean.length;
}

const lastAttempt = new Map(); // zi UTC -> timestamp ultimei incercari (Infinity = zi completa, nu se mai descarca)
const inflight = new Map();

async function loadDay(dayStart, limitMs) {
  const dayEnd = dayStart + DAY;
  const have = (await pool.query(
    `SELECT COUNT(*)::int n FROM historical_candles WHERE symbol=$1 AND timeframe='1m' AND open_time >= $2 AND open_time < $3`,
    [SYMBOL, dayStart, dayEnd])).rows[0].n;
  const complete = dayEnd <= limitMs;
  if (complete && have >= 1380) { lastAttempt.set(dayStart, Infinity); return; }
  let t = dayStart;
  let guard = 0;
  while (t < Math.min(dayEnd, limitMs) && guard++ < 4) {
    const seg = await fetchSegment(t);
    if (!seg.length) break;
    await store(seg);
    const last = seg[seg.length - 1].open_time;
    if (seg[0].open_time >= dayEnd) break; // sursa nu are date in aceasta zi (ex. weekend inainte de 2012)
    t = last + MIN;
  }
  lastAttempt.set(dayStart, complete ? Infinity : Date.now());
}

/**
 * Se asigura ca intervalul [fromMs, toMs] exista in baza de date (descarca ce lipseste, pe zile UTC).
 * Nu arunca erori de retea: daca sursele nu sunt accesibile, se folosesc datele deja existente.
 */
export async function ensureRange(fromMs, toMs) {
  const limit = Date.now() - 2 * MIN;
  const from = Math.max(TM_MIN_MS, fromMs);
  const to = Math.min(limit, toMs);
  if (to <= from) return;
  const days = [];
  for (let d = Math.floor(from / DAY) * DAY; d <= to; d += DAY) days.push(d);
  const errors = [];
  for (let i = 0; i < days.length; i += 3) {
    await Promise.all(days.slice(i, i + 3).map(async (d) => {
      const la = lastAttempt.get(d);
      if (la === Infinity || (la && Date.now() - la < 60000)) return;
      if (!inflight.has(d)) inflight.set(d, loadDay(d, limit).finally(() => inflight.delete(d)));
      try { await inflight.get(d); } catch (e) { errors.push(e.message); lastAttempt.set(d, Date.now() - 30000); }
    }));
  }
  if (errors.length) console.warn(`[history] ${errors.length} day(s) could not be downloaded: ${errors[0]}`);
}
