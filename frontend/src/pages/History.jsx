import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';
import ReviewView from '../components/ReviewView';
import { ExportButtons, Modal, Section } from '../components/Common';
import { fmt, fmtDate, fmtSigned, gradeColor, pnlClass } from '../utils';

/** Istoricul sesiunilor: READ / UPDATE (nume, notite) / DELETE + recenzie atasata + exporturi PDF/CSV/Excel. */
export default function History() {
  const { t, user, errMsg } = useApp();
  const staff = ['ANALYST', 'ADMIN'].includes(user.role);
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState([]);
  const [err, setErr] = useState('');
  const [view, setView] = useState(null); // { session, review }
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await api.get('/sessions'));
      if (staff) setStats(await api.get('/reports/stats'));
    } catch (e) { setErr(errMsg(e)); }
  }, [staff, errMsg]);
  useEffect(() => { load(); }, [load]);

  const openReview = async (s) => {
    try {
      const r = await api.get(`/sessions/${s.id}/review`);
      setView({ session: s, review: r.review });
    } catch (e) { setErr(errMsg(e)); }
  };

  const del = async (s) => {
    if (!window.confirm(t('hist.confirmDelete'))) return;
    try { await api.del(`/sessions/${s.id}`); await load(); } catch (e) { setErr(errMsg(e)); }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/sessions/${edit.id}`, { name: edit.name, notes: edit.notes });
      setEdit(null);
      await load();
    } catch (e) { setErr(errMsg(e)); }
  };

  if (!rows) return <div className="text-center text-tx2 mt-20">{err || '…'}</div>;

  const shown = rows.filter((s) => !filter || `${s.username} ${s.name || ''} ${s.mode} ${s.archetype || ''}`.toLowerCase().includes(filter.toLowerCase()));
  const closed = rows.filter((s) => s.status === 'CLOSED');
  const totalPnl = closed.reduce((a, s) => a + ((s.final_balance ?? s.current_balance) - s.initial_balance), 0);
  const avgScore = closed.filter((s) => s.score != null).reduce((a, s, _, arr) => a + s.score / arr.length, 0);

  return (
    <div className="space-y-4 anim-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('hist.title')}</h1>
          <p className="text-sm text-tx2">{staff ? t('hist.subtitleStaff') : t('hist.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="input !w-48" placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="text-xs text-tx2">{t('hist.export')}:</span>
          <ExportButtons kind="history" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t('hist.kpiSessions')} v={rows.length} />
        <Kpi label={t('hist.kpiPnl')} v={`${fmtSigned(totalPnl)} USDC`} cls={pnlClass(totalPnl)} />
        <Kpi label={t('hist.kpiScore')} v={closed.some((s) => s.score != null) ? fmt(avgScore, 1) : '—'} />
        <Kpi label={t('hist.kpiTrades')} v={rows.reduce((a, s) => a + s.trades, 0)} />
      </div>

      {err && <div className="text-down text-sm">{err}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-card"><tr>
              {['#', staff ? 'trader' : null, 'name', 'mode', 'start', 'final', 'pnl', 'pnlPct', 'trades', 'fees', 'score', 'archetype', 'created', ''].map((h, i) => h !== null && <th key={i} className="th">{h === '#' ? '#' : t('hcol.' + h)}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((s) => {
                const fin = s.final_balance ?? s.current_balance;
                const pnl = fin - s.initial_balance;
                return (
                  <tr key={s.id} className="border-t border-line/60 hover:bg-line/20">
                    <td className="td num text-tx2">{s.id}</td>
                    {staff && <td className="td">{s.username}</td>}
                    <td className="td max-w-[180px] truncate" title={s.notes || ''}>{s.name || '—'}{s.status === 'ACTIVE' && <span className="chip bg-up/15 text-up ml-2">ACTIVE</span>}</td>
                    <td className="td"><span className="chip bg-line text-tx2">{s.mode === 'LIVE' ? 'LIVE' : 'TIME M.'}</span></td>
                    <td className="td num">${fmt(s.initial_balance, 0)}</td>
                    <td className="td num">${fmt(fin)}</td>
                    <td className={`td num font-semibold ${pnlClass(pnl)}`}>{fmtSigned(pnl)}</td>
                    <td className={`td num ${pnlClass(pnl)}`}>{fmtSigned((pnl / s.initial_balance) * 100, 1)}%</td>
                    <td className="td num">{s.trades}</td>
                    <td className="td num text-tx2">{fmt(s.fees, 4)}</td>
                    <td className="td">{s.score != null ? <span className="num"><b>{s.score}</b> <span className={`font-bold ${gradeColor(s.grade)}`}>{s.grade}</span></span> : '—'}</td>
                    <td className="td text-xs">{s.archetype ? t('arch.' + s.archetype) : '—'}</td>
                    <td className="td text-tx2 text-xs">{fmtDate(s.created_at)}</td>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <button className="btn-ghost btn-sm" onClick={() => openReview(s)} title={t('hist.openReview')}>🧠</button>
                        <button className="btn-ghost btn-sm" onClick={() => setEdit({ id: s.id, name: s.name || '', notes: s.notes || '' })} title={t('common.edit')}>✎</button>
                        <button className="btn-ghost btn-sm" onClick={() => del(s)} disabled={s.status === 'ACTIVE'} title={t('common.delete')}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={14} className="td text-center text-tx2 py-8">{t('tbl.empty')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {staff && (
        <Section title={t('hist.aggregate')} right={<ExportButtons kind="aggregate" />}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{['trader', 'sessions', 'trades', 'pnl', 'fees', 'avgScore', 'winRate', 'avgLev', 'slUsage'].map((h) => <th key={h} className="th">{t('hcol.' + h)}</th>)}</tr></thead>
              <tbody>
                {stats.map((x) => (
                  <tr key={x.username} className="border-t border-line/60">
                    <td className="td font-medium">{x.username}</td>
                    <td className="td num">{x.sessions}</td>
                    <td className="td num">{x.trades}</td>
                    <td className={`td num font-semibold ${pnlClass(x.pnl)}`}>{fmtSigned(x.pnl)}</td>
                    <td className="td num text-tx2">{fmt(x.fees, 4)}</td>
                    <td className="td num">{x.avg_score ?? '—'}</td>
                    <td className="td num">{x.win_rate != null ? `${x.win_rate}%` : '—'}</td>
                    <td className="td num">{x.avg_lev != null ? `x${x.avg_lev}` : '—'}</td>
                    <td className="td num">{x.sl_usage != null ? `${x.sl_usage}%` : '—'}</td>
                  </tr>
                ))}
                {!stats.length && <tr><td colSpan={9} className="td text-center text-tx2 py-6">{t('tbl.empty')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {view && (
        <Modal wide title={`${t('review.title')} · #${view.session.id} ${view.session.name || ''}`} onClose={() => setView(null)}>
          <div className="flex items-center justify-between mb-3 text-xs text-tx2">
            <span>{view.session.username} · {fmtDate(view.session.created_at)}</span>
            <ExportButtons kind="session" params={{ session: view.session.id }} />
          </div>
          <ReviewView review={view.review}
            onChanged={(r) => { setView({ ...view, review: { ...view.review, ...r } }); load(); }}
            onDeleted={() => { setView(null); load(); }} />
        </Modal>
      )}

      {edit && (
        <Modal title={t('hist.editTitle')} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <div><label className="label">{t('hcol.name')}</label><input className="input" maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div><label className="label">{t('hist.notes')}</label><textarea className="input min-h-[90px]" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
              <button className="btn-gold" onClick={saveEdit}>{t('common.save')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Kpi({ label, v, cls = '' }) {
  return <div className="card px-4 py-3"><div className="text-[10px] uppercase text-tx2">{label}</div><div className={`num text-xl font-bold ${cls}`}>{v}</div></div>;
}
