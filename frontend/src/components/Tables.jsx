import { useState } from 'react';
import { useApp } from '../AppContext';
import { fmt, fmtDate, fmtSigned, pnlClass } from '../utils';

/** Camp numeric editabil in loc (UPDATE pe viu pentru SL / TP / Limit). */
function EditNum({ value, onSave, disabled }) {
  const [ed, setEd] = useState(false);
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  const { errMsg } = useApp();
  if (disabled) return <span className="num text-tx2">{value != null ? fmt(value) : '—'}</span>;
  const commit = async () => {
    setEd(false);
    const nv = v === '' ? null : Number(v);
    if (nv === value || (nv === null && value == null)) return;
    try { await onSave(nv); setErr(false); } catch (e) { setErr(errMsg(e)); setTimeout(() => setErr(false), 3500); }
  };
  if (ed)
    return (
      <input autoFocus type="number" step="any" className="input num !py-0.5 !px-1.5 !w-24 !text-xs" value={v}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEd(false); }} />
    );
  return (
    <button className="num hover:text-gold border-b border-dashed border-line" title={typeof err === 'string' ? err : '✎'}
      onClick={() => { setV(value ?? ''); setEd(true); }}>
      {err ? <span className="text-down">{typeof err === 'string' ? '!' : ''}</span> : null}{value != null ? fmt(value) : '—'}
    </button>
  );
}

export default function Tables({ positions, orders, price, onEditPos, onClosePos, onDeletePos, onEditOrder, onCancelOrder, onDeleteOrder }) {
  const { t } = useApp();
  const [tab, setTab] = useState('open');
  const open = positions.filter((p) => p.status === 'OPEN');
  const closed = positions.filter((p) => p.status !== 'OPEN');
  const pending = orders.filter((o) => o.status === 'PENDING');
  const oldOrders = orders.filter((o) => o.status !== 'PENDING');

  const T = (k, n) => (
    <button className={`tab ${tab === k ? 'tab-on' : ''}`} onClick={() => setTab(k)}>
      {t('tbl.' + k)} <span className="text-[10px] opacity-70">({n})</span>
    </button>
  );
  const side = (s) => <span className={`chip ${s === 'LONG' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{s}</span>;

  return (
    <div className="card overflow-hidden">
      <div className="flex gap-1 p-2 border-b border-line overflow-x-auto">
        {T('open', open.length)}{T('pending', pending.length)}{T('closed', closed.length)}{T('orders', oldOrders.length)}
      </div>
      <div className="overflow-x-auto max-h-[300px]">
        {tab === 'open' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-card"><tr>
              {['side', 'lev', 'entry', 'mark', 'size', 'margin', 'upnl', 'roe', 'liq', 'sl', 'tp', 'fee', ''].map((h) => <th key={h} className="th">{t('col.' + h)}</th>)}
            </tr></thead>
            <tbody>
              {open.map((p) => {
                const upnl = (p.side === 'LONG' ? price - p.entry_price : p.entry_price - price) * p.quantity_btc;
                const roe = (upnl / p.margin_usdc) * 100;
                return (
                  <tr key={p.id} className="border-t border-line/60 hover:bg-line/20">
                    <td className="td">{side(p.side)}</td>
                    <td className="td num">x{p.leverage}</td>
                    <td className="td num">{fmt(p.entry_price)}</td>
                    <td className="td num">{fmt(price)}</td>
                    <td className="td num">{p.quantity_btc.toFixed(6)}</td>
                    <td className="td num">{fmt(p.margin_usdc)}</td>
                    <td className={`td num font-semibold ${pnlClass(upnl)}`}>{fmtSigned(upnl, 3)}</td>
                    <td className={`td num ${pnlClass(roe)}`}>{fmtSigned(roe, 1)}%</td>
                    <td className="td num text-gold">{fmt(p.liquidation_price)}</td>
                    <td className="td"><EditNum value={p.stop_loss} onSave={(v) => onEditPos(p.id, { stop_loss: v })} /></td>
                    <td className="td"><EditNum value={p.take_profit} onSave={(v) => onEditPos(p.id, { take_profit: v })} /></td>
                    <td className="td num text-tx2">{fmt(p.opening_fee_usdc, 4)}</td>
                    <td className="td"><button className="btn-ghost btn-sm" onClick={() => onClosePos(p.id)}>{t('tbl.closeBtn')}</button></td>
                  </tr>
                );
              })}
              {!open.length && <Empty cols={13} />}
            </tbody>
          </table>
        )}

        {tab === 'pending' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-card"><tr>
              {['side', 'lev', 'type', 'limit', 'margin', 'sl', 'tp', ''].map((h) => <th key={h} className="th">{t('col.' + h)}</th>)}
            </tr></thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id} className="border-t border-line/60 hover:bg-line/20">
                  <td className="td">{side(o.side)}</td>
                  <td className="td num">x{o.leverage}</td>
                  <td className="td">{o.order_type}</td>
                  <td className="td"><EditNum value={o.limit_price} disabled={o.order_type !== 'LIMIT'} onSave={(v) => onEditOrder(o.id, { limit_price: v })} /></td>
                  <td className="td num">{fmt(o.margin_usdc)}</td>
                  <td className="td"><EditNum value={o.stop_loss} onSave={(v) => onEditOrder(o.id, { stop_loss: v })} /></td>
                  <td className="td"><EditNum value={o.take_profit} onSave={(v) => onEditOrder(o.id, { take_profit: v })} /></td>
                  <td className="td"><button className="btn-ghost btn-sm" onClick={() => onCancelOrder(o.id)}>{t('tbl.cancel')}</button></td>
                </tr>
              ))}
              {!pending.length && <Empty cols={8} />}
            </tbody>
          </table>
        )}

        {tab === 'closed' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-card"><tr>
              {['side', 'lev', 'entry', 'exit', 'margin', 'fees', 'pnl', 'status', 'reason', 'closed', ''].map((h) => <th key={h} className="th">{t('col.' + h)}</th>)}
            </tr></thead>
            <tbody>
              {closed.map((p) => (
                <tr key={p.id} className="border-t border-line/60 hover:bg-line/20">
                  <td className="td">{side(p.side)}</td>
                  <td className="td num">x{p.leverage}</td>
                  <td className="td num">{fmt(p.entry_price)}</td>
                  <td className="td num">{fmt(p.exit_price)}</td>
                  <td className="td num">{fmt(p.margin_usdc)}</td>
                  <td className="td num text-tx2">{fmt(p.opening_fee_usdc + p.closing_fee_usdc, 4)}</td>
                  <td className={`td num font-semibold ${pnlClass(p.realized_pnl_usdc)}`}>{fmtSigned(p.realized_pnl_usdc, 3)}</td>
                  <td className="td"><span className={`chip ${p.status === 'LIQUIDATED' ? 'bg-down/15 text-down' : 'bg-line text-tx2'}`}>{p.status}</span></td>
                  <td className="td text-tx2 text-xs">{p.close_reason}</td>
                  <td className="td text-tx2 text-xs">{fmtDate(p.closed_at)}</td>
                  <td className="td"><button className="btn-ghost btn-sm" onClick={() => onDeletePos(p.id)}>🗑</button></td>
                </tr>
              ))}
              {!closed.length && <Empty cols={11} />}
            </tbody>
          </table>
        )}

        {tab === 'orders' && (
          <table className="w-full">
            <thead className="sticky top-0 bg-card"><tr>
              {['side', 'lev', 'type', 'limit', 'margin', 'status', ''].map((h) => <th key={h} className="th">{t('col.' + h)}</th>)}
            </tr></thead>
            <tbody>
              {oldOrders.map((o) => (
                <tr key={o.id} className="border-t border-line/60 hover:bg-line/20">
                  <td className="td">{side(o.side)}</td>
                  <td className="td num">x{o.leverage}</td>
                  <td className="td">{o.order_type}</td>
                  <td className="td num">{o.limit_price != null ? fmt(o.limit_price) : '—'}</td>
                  <td className="td num">{fmt(o.margin_usdc)}</td>
                  <td className="td"><span className="chip bg-line text-tx2">{o.status}</span></td>
                  <td className="td"><button className="btn-ghost btn-sm" onClick={() => onDeleteOrder(o.id)}>🗑</button></td>
                </tr>
              ))}
              {!oldOrders.length && <Empty cols={7} />}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Empty({ cols }) {
  const { t } = useApp();
  return <tr><td colSpan={cols} className="td text-center text-tx2 py-6">{t('tbl.empty')}</td></tr>;
}
