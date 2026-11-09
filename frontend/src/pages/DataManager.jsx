import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';
import { Modal, Pager } from '../components/Common';
import { fmtDate } from '../utils';

// Configuratia formularelor pentru cele 8 tabele (coloane editabile + tip camp).
// type: text | number | textarea | json | select | datetime
const SIDE = ['LONG', 'SHORT'];
export const SCHEMA = {
  roles: {
    cols: [{ k: 'name', type: 'text' }, { k: 'description', type: 'textarea' }, { k: 'permissions', type: 'json' }],
    show: ['id', 'name', 'description', 'permissions'],
  },
  users: {
    cols: [{ k: 'username', type: 'text' }, { k: 'email', type: 'text' }, { k: 'role_id', type: 'number' },
      { k: 'preferred_lang', type: 'select', options: ['ro', 'en'] }, { k: 'password', type: 'password' }],
    show: ['id', 'username', 'email', 'role_id', 'preferred_lang', 'created_at'],
  },
  trading_sessions: {
    cols: [{ k: 'user_id', type: 'number' }, { k: 'name', type: 'text' }, { k: 'notes', type: 'textarea' },
      { k: 'mode', type: 'select', options: ['LIVE', 'TIME_MACHINE'] }, { k: 'initial_balance', type: 'select', options: ['10', '100', '1000'] },
      { k: 'final_balance', type: 'number' }, { k: 'current_balance', type: 'number' }, { k: 'simulated_start_time', type: 'datetime' },
      { k: 'simulated_current_time', type: 'datetime' }, { k: 'status', type: 'select', options: ['ACTIVE', 'CLOSED'] }, { k: 'ended_at', type: 'datetime' }],
    show: ['id', 'user_id', 'name', 'mode', 'initial_balance', 'final_balance', 'status', 'created_at'],
  },
  orders: {
    cols: [{ k: 'session_id', type: 'number' }, { k: 'side', type: 'select', options: SIDE }, { k: 'order_type', type: 'select', options: ['MARKET', 'LIMIT'] },
      { k: 'leverage', type: 'number' }, { k: 'quantity_btc', type: 'number' }, { k: 'margin_usdc', type: 'number' }, { k: 'limit_price', type: 'number' },
      { k: 'stop_loss', type: 'number' }, { k: 'take_profit', type: 'number' }, { k: 'status', type: 'select', options: ['PENDING', 'FILLED', 'CANCELLED'] }],
    show: ['id', 'session_id', 'side', 'order_type', 'leverage', 'margin_usdc', 'limit_price', 'status', 'created_at'],
  },
  positions: {
    cols: [{ k: 'session_id', type: 'number' }, { k: 'order_id', type: 'number' }, { k: 'side', type: 'select', options: SIDE }, { k: 'leverage', type: 'number' },
      { k: 'entry_price', type: 'number' }, { k: 'exit_price', type: 'number' }, { k: 'liquidation_price', type: 'number' }, { k: 'margin_usdc', type: 'number' },
      { k: 'quantity_btc', type: 'number' }, { k: 'stop_loss', type: 'number' }, { k: 'take_profit', type: 'number' }, { k: 'opening_fee_usdc', type: 'number' },
      { k: 'closing_fee_usdc', type: 'number' }, { k: 'realized_pnl_usdc', type: 'number' }, { k: 'status', type: 'select', options: ['OPEN', 'CLOSED', 'LIQUIDATED'] },
      { k: 'close_reason', type: 'text' }, { k: 'opened_at', type: 'datetime' }, { k: 'closed_at', type: 'datetime' }],
    show: ['id', 'session_id', 'side', 'leverage', 'entry_price', 'exit_price', 'realized_pnl_usdc', 'status', 'close_reason', 'closed_at'],
  },
  trader_reviews: {
    cols: [{ k: 'session_id', type: 'number' }, { k: 'user_id', type: 'number' }, { k: 'score', type: 'number' }, { k: 'grade', type: 'text' }, { k: 'archetype', type: 'text' },
      { k: 'win_rate', type: 'number' }, { k: 'avg_leverage', type: 'number' }, { k: 'sl_usage_rate', type: 'number' }, { k: 'total_fees_paid', type: 'number' },
      { k: 'feedback_ro', type: 'textarea' }, { k: 'feedback_en', type: 'textarea' }, { k: 'mentor_notes', type: 'textarea' }, { k: 'trader_notes', type: 'textarea' }],
    show: ['id', 'session_id', 'user_id', 'score', 'grade', 'archetype', 'win_rate', 'mentor_notes'],
  },
  historical_candles: {
    cols: [{ k: 'symbol', type: 'text' }, { k: 'timeframe', type: 'select', options: ['1m', '5m', '15m', '1h', '4h', '1d'] }, { k: 'open_time', type: 'number' },
      { k: 'open', type: 'number' }, { k: 'high', type: 'number' }, { k: 'low', type: 'number' }, { k: 'close', type: 'number' }, { k: 'volume', type: 'number' }],
    show: ['id', 'symbol', 'timeframe', 'open_time', 'open', 'high', 'low', 'close', 'volume'],
    filters: [{ k: 'timeframe', options: ['', '1m', '5m', '15m', '1h', '4h', '1d'] }],
  },
  audit_logs: {
    cols: [{ k: 'user_id', type: 'number' }, { k: 'action', type: 'text' }, { k: 'entity_name', type: 'text' }, { k: 'entity_id', type: 'text' },
      { k: 'payload_json', type: 'json' }, { k: 'ip_address', type: 'text' }],
    show: ['id', 'user_id', 'action', 'entity_name', 'entity_id', 'payload_json', 'ip_address', 'created_at'],
  },
};

const isTimeCol = (k) => /(_at|_time)$/.test(k) && k !== 'open_time';
const toInput = (v, type) => {
  if (v === null || v === undefined) return '';
  if (type === 'json') return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  if (type === 'datetime') return new Date(v).toISOString().slice(0, 16);
  return String(v);
};

function cell(k, v) {
  if (v === null || v === undefined) return <span className="text-tx2/50">—</span>;
  if (typeof v === 'object') return <span className="num text-xs text-tx2" title={JSON.stringify(v)}>{JSON.stringify(v).slice(0, 48)}{JSON.stringify(v).length > 48 ? '…' : ''}</span>;
  if (k === 'open_time') return <span className="num">{new Date(Number(v)).toISOString().slice(0, 16).replace('T', ' ')}</span>;
  if (isTimeCol(k) || k === 'created_at') return <span className="num text-tx2">{fmtDate(v)}</span>;
  if (typeof v === 'number') return <span className="num">{Number.isInteger(v) ? v : Number(v.toFixed(6))}</span>;
  const s = String(v);
  return <span title={s}>{s.length > 40 ? s.slice(0, 40) + '…' : s}</span>;
}

/** Tabel CRUD generic: listare paginata + filtrare + creare / editare / stergere (conform drepturilor rolului). */
export function CrudTable({ table, meta }) {
  const { t, errMsg } = useApp();
  const cfg = SCHEMA[table];
  const [data, setData] = useState({ rows: [], total: 0 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [edit, setEdit] = useState(null); // { id|null, form }
  const [err, setErr] = useState('');
  const limit = 15;
  const writable = useMemo(() => new Set(meta?.writable || []), [meta]);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page, limit, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    try { setData(await api.get(`/data/${table}?${q}`)); setErr(''); } catch (e) { setErr(errMsg(e)); }
  }, [table, page, filters, errMsg]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setFilters({}); setEdit(null); }, [table]);

  const openForm = (row) => {
    const form = {};
    for (const c of cfg.cols) {
      if (row) form[c.k] = c.type === 'password' ? '' : toInput(row[c.k], c.type);
      else form[c.k] = c.type === 'select' ? c.options[0] : table === 'historical_candles' && c.k === 'symbol' ? 'BTCUSDC' : '';
    }
    setEdit({ id: row?.id ?? null, form });
  };

  const save = async () => {
    try {
      const body = {};
      for (const c of cfg.cols) {
        if (!writable.has(c.k) && c.type !== 'password') continue;
        if (c.type === 'password' && !writable.has('username')) continue;
        let v = edit.form[c.k];
        if (v === '') { body[c.k] = null; continue; }
        if (c.type === 'number') v = Number(v);
        else if (c.type === 'json') v = JSON.parse(v);
        else if (c.type === 'datetime') v = new Date(v).toISOString();
        else if (c.k === 'initial_balance') v = Number(v);
        body[c.k] = v;
      }
      if (cfg.cols.some((c) => c.type === 'password') && !body.password) delete body.password;
      if (edit.id) await api.put(`/data/${table}/${edit.id}`, body);
      else await api.post(`/data/${table}`, body);
      setEdit(null);
      load();
    } catch (e) { setErr(e instanceof SyntaxError ? 'JSON: ' + e.message : errMsg(e)); }
  };

  const del = async (row) => {
    if (!window.confirm(t('common.confirmDelete'))) return;
    try { await api.del(`/data/${table}/${row.id}`); load(); } catch (e) { setErr(errMsg(e)); }
  };

  const canEdit = writable.size > 0;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
        {(cfg.filters || []).map((f) => (
          <select key={f.k} className="input !w-32 !py-1.5" value={filters[f.k] || ''} onChange={(e) => { setPage(1); setFilters({ ...filters, [f.k]: e.target.value }); }}>
            {f.options.map((o) => <option key={o} value={o}>{o || `${f.k}: *`}</option>)}
          </select>
        ))}
        <button className="btn-ghost btn-sm" onClick={load}>↻ {t('common.refresh')}</button>
        {!canEdit && <span className="text-xs text-tx2">🔒 {t('common.readonly')}</span>}
        <div className="ml-auto">{meta?.canCreate && <button className="btn-gold btn-sm" onClick={() => openForm(null)}>＋ {t('data.new')}</button>}</div>
      </div>
      {err && <div className="text-down text-sm px-3 py-2 bg-down/10">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr>{cfg.show.map((k) => <th key={k} className="th">{k}</th>)}<th className="th">{t('common.actions')}</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-t border-line/60 hover:bg-line/20">
                {cfg.show.map((k) => <td key={k} className="td">{cell(k, r[k])}</td>)}
                <td className="td">
                  <div className="flex gap-1">
                    {canEdit && <button className="btn-ghost btn-sm" onClick={() => openForm(r)} title={t('common.edit')}>✎</button>}
                    {meta?.canDelete && <button className="btn-ghost btn-sm text-down" onClick={() => del(r)} title={t('common.delete')}>🗑</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!data.rows.length && <tr><td colSpan={cfg.show.length + 1} className="td text-center text-tx2 py-6">{t('tbl.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="p-3 border-t border-line"><Pager page={page} limit={limit} total={data.total} onPage={setPage} /></div>

      {edit && (
        <Modal title={edit.id ? `${t('data.edit')} #${edit.id}` : t('data.new')} onClose={() => setEdit(null)} wide>
          <div className="grid sm:grid-cols-2 gap-3">
            {cfg.cols.filter((c) => writable.has(c.k) || (c.type === 'password' && writable.has('username'))).map((c) => (
              <div key={c.k} className={c.type === 'textarea' || c.type === 'json' ? 'sm:col-span-2' : ''}>
                <label className="label">{c.type === 'password' ? t('common.newPassword') : c.k}</label>
                {c.type === 'select' ? (
                  <select className="input" value={edit.form[c.k]} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, [c.k]: e.target.value } })}>
                    {c.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : c.type === 'textarea' || c.type === 'json' ? (
                  <textarea className={`input min-h-[80px] ${c.type === 'json' ? 'num text-xs' : ''}`} value={edit.form[c.k]} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, [c.k]: e.target.value } })} />
                ) : (
                  <input className="input" type={c.type === 'number' ? 'number' : c.type === 'password' ? 'password' : c.type === 'datetime' ? 'datetime-local' : 'text'} step="any"
                    value={edit.form[c.k]} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, [c.k]: e.target.value } })} />
                )}
              </div>
            ))}
          </div>
          {err && <div className="text-down text-sm mt-3">{err}</div>}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
            <button className="btn-gold" onClick={save}>{t('common.save')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function DataManager() {
  const { t, user, errMsg } = useApp();
  const [meta, setMeta] = useState([]);
  const [tab, setTab] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/data/_meta').then((m) => { setMeta(m); setTab((x) => x || m[0]?.table); }).catch((e) => setErr(errMsg(e)));
  }, [errMsg]);

  return (
    <div className="space-y-4 anim-in">
      <div>
        <h1 className="text-2xl font-bold">{t('data.title')}</h1>
        <p className="text-sm text-tx2">{t('data.subtitle')}</p>
        {user.role === 'ANALYST' && <p className="text-xs text-gold mt-1">{t('data.analystNote')}</p>}
      </div>
      {err && <div className="text-down">{err}</div>}
      <div className="flex gap-1 flex-wrap">
        {meta.map((m) => (
          <button key={m.table} className={`tab ${tab === m.table ? 'tab-on' : ''}`} onClick={() => setTab(m.table)}>{t('data.tbl.' + m.table)}</button>
        ))}
      </div>
      {tab && <CrudTable key={tab} table={tab} meta={meta.find((m) => m.table === tab)} />}
    </div>
  );
}
