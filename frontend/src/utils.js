export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
export const TF_MIN = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
export const SPEEDS = [1, 2, 5, 10, 25, 50, 100];
export const FEES = { MAKER: 0.0002, TAKER: 0.0005 };
export const MMR = 0.004;

export const calcLiq = (side, entry, lev) => (side === 'LONG' ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR));

export const fmt = (n, d = 2) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtSigned = (n, d = 2) =>
  n === null || n === undefined ? '—' : (Number(n) > 0 ? '+' : '') + fmt(n, d);

export const pnlClass = (n) => (n > 0 ? 'text-up' : n < 0 ? 'text-down' : 'text-tx2');

export const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return x.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Valoarea pentru <input type="datetime-local"> (ora locala) din timestamp ms. */
export const toLocalInput = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const gradeColor = (g) =>
  ({ S: 'text-gold', A: 'text-up', B: 'text-up', C: 'text-tx', D: 'text-down', F: 'text-down' }[g] || 'text-tx');
