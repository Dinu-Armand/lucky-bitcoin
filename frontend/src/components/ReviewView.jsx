import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';
import { fmt, fmtSigned, gradeColor, pnlClass } from '../utils';

function Ring({ score, grade }) {
  const r = 46, c = 2 * Math.PI * r;
  const col = score >= 65 ? '#0ECB81' : score >= 40 ? '#FCD535' : '#F6465D';
  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#2B3139" strokeWidth="8" />
        <circle cx="55" cy="55" r={r} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><div className="num text-3xl font-bold">{score}</div><div className={`text-xl font-bold -mt-1 ${gradeColor(grade)}`}>{grade}</div></div>
      </div>
    </div>
  );
}

function Metric({ label, value, cls = '' }) {
  return (
    <div className="bg-bg border border-line rounded-xl px-3 py-2">
      <div className="text-[10px] uppercase text-tx2">{label}</div>
      <div className={`num text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

/** Afiseaza o recenzie de trader; permite editarea notitelor (UPDATE) si stergerea (DELETE) dupa rol. */
export default function ReviewView({ review, onChanged, onDeleted }) {
  const { t, lang, user, errMsg } = useApp();
  const [mentor, setMentor] = useState('');
  const [mine, setMine] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setMentor(review?.mentor_notes || '');
    setMine(review?.trader_notes || '');
    setMsg('');
  }, [review?.id, review?.updated_at]);

  if (!review) return <div className="text-tx2 text-sm p-4">{t('review.none')}</div>;
  const m = review.metrics || {};
  const feedback = (lang === 'en' ? review.feedback_en : review.feedback_ro) || '';
  const canMentor = ['ANALYST', 'ADMIN'].includes(user.role);
  const canTrader = user.role === 'ADMIN' || (user.role === 'TRADER' && review.user_id === user.id);
  const canDelete = user.role === 'ADMIN' || (user.role === 'TRADER' && review.user_id === user.id);

  const save = async (body) => {
    try {
      const r = await api.put(`/reviews/${review.id}`, body);
      setMsg(t('review.saved'));
      onChanged?.(r);
    } catch (e) { setMsg(errMsg(e)); }
  };
  const del = async () => {
    if (!window.confirm(t('review.confirmDelete'))) return;
    try { await api.del(`/reviews/${review.id}`); onDeleted?.(review.id); } catch (e) { setMsg(errMsg(e)); }
  };

  return (
    <div className="space-y-4 anim-in">
      <div className="flex items-center gap-4">
        <Ring score={review.score} grade={review.grade} />
        <div>
          <div className="text-[11px] uppercase text-tx2">{t('review.archetype')}</div>
          <div className="text-xl font-bold text-gold leading-tight">{t('arch.' + review.archetype)}</div>
          <div className="text-xs text-tx2 mt-1">{t('arch.desc.' + review.archetype)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label={t('m.winRate')} value={`${fmt(review.win_rate, 1)}%`} cls={review.win_rate >= 50 ? 'text-up' : 'text-down'} />
        <Metric label={t('m.profitFactor')} value={fmt(m.profitFactor)} cls={m.profitFactor >= 1 ? 'text-up' : 'text-down'} />
        <Metric label={t('m.avgRR')} value={m.avgRR == null ? '—' : `${fmt(m.avgRR)} : 1`} />
        <Metric label={t('m.slUsage')} value={`${fmt(review.sl_usage_rate, 0)}%`} cls={review.sl_usage_rate >= 70 ? 'text-up' : 'text-down'} />
        <Metric label={t('m.avgLev')} value={`x${fmt(review.avg_leverage, 1)}`} cls={review.avg_leverage >= 7 ? 'text-down' : ''} />
        <Metric label={t('m.feeBleed')} value={m.feeBleed == null ? '—' : `${fmt(m.feeBleed, 1)}%`} />
        <Metric label={t('m.maxDD')} value={`${fmt(m.maxDrawdown, 1)}%`} cls={m.maxDrawdown >= 25 ? 'text-down' : ''} />
        <Metric label={t('m.avgDur')} value={`${fmt(m.avgDurationMin, 0)} min`} />
        <Metric label={t('m.netPnl')} value={`${fmtSigned(m.netPnl)} (${fmtSigned(m.netPnlPct, 1)}%)`} cls={pnlClass(m.netPnl)} />
        <Metric label={t('m.fees')} value={`${fmt(review.total_fees_paid, 4)} USDC`} />
        <Metric label={t('m.trades')} value={`${m.trades ?? 0}`} />
        <Metric label={t('m.liquidations')} value={`${m.liquidations ?? 0}`} cls={m.liquidations ? 'text-down' : ''} />
      </div>

      <div>
        <div className="text-xs uppercase text-tx2 mb-2">{t('review.diagnosis')}</div>
        <ul className="space-y-1.5">
          {feedback.split('\n').filter(Boolean).map((l, i) => (
            <li key={i} className="text-sm leading-snug flex gap-2"><span className="text-gold">▸</span><span>{l}</span></li>
          ))}
        </ul>
      </div>

      <div>
        <label className="label">{t('review.mentorNotes')}</label>
        <textarea className="input min-h-[64px]" value={mentor} onChange={(e) => setMentor(e.target.value)} disabled={!canMentor} placeholder={canMentor ? t('review.mentorPlaceholder') : '—'} />
        {canMentor && <button className="btn-ghost btn-sm mt-1" onClick={() => save({ mentor_notes: mentor })}>{t('review.saveNotes')}</button>}
      </div>
      <div>
        <label className="label">{t('review.myNotes')}</label>
        <textarea className="input min-h-[64px]" value={mine} onChange={(e) => setMine(e.target.value)} disabled={!canTrader} placeholder={t('review.myPlaceholder')} />
        {canTrader && <button className="btn-ghost btn-sm mt-1" onClick={() => save({ trader_notes: mine })}>{t('review.saveNotes')}</button>}
      </div>
      <div className="flex items-center gap-3">
        {canDelete && <button className="btn-ghost btn-sm text-down" onClick={del}>🗑 {t('review.delete')}</button>}
        {msg && <span className="text-xs text-tx2">{msg}</span>}
      </div>
    </div>
  );
}
