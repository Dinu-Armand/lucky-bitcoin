import { useState } from 'react';
import { useApp } from '../AppContext';
import { FEES, calcLiq, fmt } from '../utils';

export default function OrderPanel({ balance, price, onSubmit }) {
  const { t, errMsg } = useApp();
  const [side, setSide] = useState('LONG');
  const [type, setType] = useState('MARKET');
  const [lev, setLev] = useState(5);
  const [margin, setMargin] = useState('');
  const [limit, setLimit] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const m = Number(margin) || 0;
  const ref = type === 'LIMIT' ? Number(limit) || price : price;
  const notional = m * lev;
  const qty = ref ? notional / ref : 0;
  const rate = type === 'LIMIT' ? FEES.MAKER : FEES.TAKER;
  const fee = notional * rate;
  const liq = ref && m ? calcLiq(side, ref, lev) : null;
  // 100% = marja maxima la care marja + comisionul (marja x levier x rata) incap in sold, altfel ordinul ar fi respins.
  const setPct = (p) => {
    const base = p >= 1 ? balance / (1 + lev * rate) : balance * p;
    setMargin(String(Math.max(0, Math.floor(base * 100) / 100)));
  };

  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      await onSubmit({
        side, order_type: type, leverage: lev, margin_usdc: m,
        limit_price: type === 'LIMIT' ? limit : null, stop_loss: sl || null, take_profit: tp || null,
      });
      setSl(''); setTp('');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const long = side === 'LONG';
  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-1 bg-bg rounded-xl p-1">
        <button onClick={() => setSide('LONG')} className={`py-2 rounded-lg text-sm font-bold ${long ? 'bg-up text-bg' : 'text-tx2'}`}>LONG ▲</button>
        <button onClick={() => setSide('SHORT')} className={`py-2 rounded-lg text-sm font-bold ${!long ? 'bg-down text-white' : 'text-tx2'}`}>SHORT ▼</button>
      </div>
      <div className="flex gap-1">
        {['MARKET', 'LIMIT'].map((x) => (
          <button key={x} onClick={() => setType(x)} className={`tab flex-1 ${type === x ? 'tab-on' : ''}`}>{t('order.' + x)}</button>
        ))}
      </div>

      <div>
        <div className="flex justify-between label"><span>{t('order.leverage')}</span><span className="num text-gold font-bold">x{lev}</span></div>
        <input type="range" min="1" max="10" step="1" value={lev} onChange={(e) => setLev(Number(e.target.value))} className="w-full accent-[#FCD535]" />
        <div className="flex justify-between text-[10px] text-tx2 num"><span>1x</span><span>5x</span><span>10x</span></div>
      </div>

      {type === 'LIMIT' && (
        <div>
          <label className="label">{t('order.limitPrice')} (USDC)</label>
          <input className="input num" type="number" step="any" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={fmt(price)} />
          <div className="text-[10px] text-tx2 mt-1">{long ? t('order.limitHintLong') : t('order.limitHintShort')}</div>
        </div>
      )}

      <div>
        <div className="flex justify-between label"><span>{t('order.margin')} (USDC)</span><span className="num">{t('order.available')}: {fmt(balance)}</span></div>
        <input className="input num" type="number" step="any" min="1" value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="0.00" />
        <div className="grid grid-cols-4 gap-1 mt-1">
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <button key={p} className="btn-ghost btn-sm" onClick={() => setPct(p)} title={p >= 1 ? t('order.maxHint') : undefined}>{p >= 1 ? 'MAX' : `${Math.round(p * 100)}%`}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Stop-Loss</label><input className="input num" type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="—" /></div>
        <div><label className="label">Take-Profit</label><input className="input num" type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="—" /></div>
      </div>

      <div className="bg-bg rounded-xl p-3 text-xs space-y-1.5 num">
        <Row k={t('order.notional')} v={`${fmt(notional)} USDC`} />
        <Row k={t('order.size')} v={`${qty.toFixed(6)} BTC`} />
        <Row k={`${t('order.fee')} (${type === 'LIMIT' ? 'Maker 0.02%' : 'Taker 0.05%'})`} v={`${fmt(fee, 4)} USDC`} />
        <Row k={t('order.liq')} v={liq ? fmt(liq) : '—'} cls="text-gold" />
        <Row k={t('order.required')} v={`${fmt(m + fee, 2)} USDC`} />
      </div>

      {err && <div className="text-down text-xs bg-down/10 border border-down/30 rounded-xl px-3 py-2">{err}</div>}
      <button className={`${long ? 'btn-up' : 'btn-down'} w-full py-2.5`} disabled={busy || !m || !price} onClick={submit}>
        {busy ? '…' : `${long ? t('order.buyLong') : t('order.sellShort')} · ${type === 'LIMIT' ? t('order.LIMIT') : t('order.MARKET')}`}
      </button>
    </div>
  );
}

function Row({ k, v, cls = '' }) {
  return <div className="flex justify-between"><span className="text-tx2 font-sans">{k}</span><span className={cls}>{v}</span></div>;
}
