export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const SYMBOL = 'BTCUSDC';
export const TF_MIN = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };

/** '' / undefined -> null, altfel Number (NaN ramane NaN pentru validare). */
export const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
export const isPos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Agregare lumanari de 1m (sortate crescator) in lumanari de tfMin minute, aliniate la epoch. */
export function aggregate(rows, tfMin) {
  if (tfMin === 1) return rows.map((r) => ({ ...r }));
  const ms = tfMin * 60000;
  const out = [];
  let cur = null;
  for (const r of rows) {
    const bucket = Math.floor(r.open_time / ms) * ms;
    if (!cur || cur.open_time !== bucket) {
      cur = { open_time: bucket, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
      cur.close = r.close;
      cur.volume += r.volume;
    }
  }
  return out;
}
