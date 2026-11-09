const BASE = 'https://api.binance.com';

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
  return r.json();
}

/** Klines publice (fara cheie API). Returneaza [{open_time, open, high, low, close, volume}] crescator. */
export async function fetchKlines(symbol, interval, limit = 500, { endTime, startTime } = {}) {
  let url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (endTime) url += `&endTime=${endTime}`;
  if (startTime) url += `&startTime=${startTime}`;
  const data = await getJson(url);
  return data.map((k) => ({
    open_time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

let cache = { t: 0, p: null };

export async function fetchLivePrice(symbol = 'BTCUSDC') {
  if (cache.p && Date.now() - cache.t < 1000) return cache.p;
  const j = await getJson(`${BASE}/api/v3/ticker/price?symbol=${symbol}`);
  cache = { t: Date.now(), p: parseFloat(j.price) };
  return cache.p;
}
