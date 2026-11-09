import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';
import Chart from '../components/Chart';
import OrderPanel from '../components/OrderPanel';
import Tables from '../components/Tables';
import TimeMachineBar from '../components/TimeMachineBar';
import ReviewDrawer from '../components/ReviewDrawer';
import ReviewView from '../components/ReviewView';
import { TIMEFRAMES, TF_MIN, fmt, fmtSigned, pnlClass, toLocalInput } from '../utils';

/* ------------------------------------------------------------ start screen */
function StartScreen({ onStart }) {
  const { t, errMsg } = useApp();
  const [mode, setMode] = useState('LIVE');
  const [bounds, setBounds] = useState(null);
  const [events, setEvents] = useState([]);
  const [when, setWhen] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/market/bounds').then((b) => {
      setBounds(b);
      if (b.min_time) setWhen(toLocalInput(b.max_time - 30 * 86400000));
    }).catch(() => {});
    api.get('/market/events').then(setEvents).catch(() => {});
  }, []);

  const start = async (amount) => {
    setErr(''); setBusy(true);
    try {
      await onStart({ initial_balance: amount, mode, start_time: mode === 'TIME_MACHINE' ? new Date(when).toISOString() : undefined });
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl mx-auto mt-6 space-y-5 anim-in">
      <div className="text-center">
        <h1 className="text-3xl font-bold">{t('start.title')}</h1>
        <p className="text-tx2 mt-1">{t('start.subtitle')}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {['LIVE', 'TIME_MACHINE'].map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`card p-4 text-left transition-all ${mode === m ? '!border-gold shadow-[0_0_0_1px_#FCD535]' : 'hover:border-tx2'}`}>
            <div className="font-semibold text-lg">{m === 'LIVE' ? '🟢 ' : '⏱ '}{t('mode.' + m)}</div>
            <div className="text-xs text-tx2 mt-1 leading-relaxed">{t('mode.' + m + '.desc')}</div>
          </button>
        ))}
      </div>

      {mode === 'TIME_MACHINE' && (
        <div className="card p-4 space-y-3 anim-in">
          <div>
            <label className="label">{t('start.pickDate')}</label>
            <input type="datetime-local" className="input num" value={when} onChange={(e) => setWhen(e.target.value)}
              min={bounds?.min_time ? toLocalInput(bounds.min_time + 3600000) : undefined} max={bounds?.max_time ? toLocalInput(bounds.max_time - 3600000) : undefined} />
            {bounds?.min_time && <div className="text-[11px] text-tx2 mt-1">{t('start.range')}: {new Date(bounds.min_time).toISOString().slice(0, 10)} → {t('start.now')} · {t('start.sourceNote')}</div>}
          </div>
          {events.length > 0 && (
            <div>
              <div className="label">{t('start.events')}</div>
              <div className="flex flex-wrap gap-2">
                {events.map((e) => (
                  <button key={e.key} className="btn-ghost btn-sm" onClick={() => setWhen(toLocalInput(e.time))}>
                    {t('ev.' + e.key)} <span className="num text-tx2 ml-1">{new Date(e.time).toISOString().slice(0, 13).replace('T', ' ')}h</span>
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-tx2 mt-1">{t('start.eventsNote')}</div>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="text-center text-sm text-tx2 mb-2">{t('start.amount')}</div>
        <div className="grid grid-cols-3 gap-3">
          {[10, 100, 1000].map((a) => (
            <button key={a} disabled={busy || (mode === 'TIME_MACHINE' && !when)} onClick={() => start(a)}
              className="card py-6 text-center hover:border-gold hover:-translate-y-0.5 transition-all disabled:opacity-40">
              <div className="num text-3xl font-bold text-gold">${a}</div>
              <div className="text-xs text-tx2 mt-1">USDC</div>
            </button>
          ))}
        </div>
      </div>
      {err && <div className="text-down text-sm text-center">{err}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- trading view */
function Trading({ initial, onClosed }) {
  const { t, errMsg } = useApp();
  const [st, setSt] = useState(initial);
  const [tf, setTf] = useState('1m');
  const [candles, setCandles] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ended, setEnded] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [reviewTick, setReviewTick] = useState(0);
  const [toast, setToast] = useState(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [livePrice, setLivePrice] = useState(null);
  const busy = useRef(false);

  const s = st.session;
  const tm = s.mode === 'TIME_MACHINE';
  const price = livePrice ?? st.market?.price ?? 0;

  const flash = useCallback((m, kind = 'info') => { setToast({ m, kind }); setTimeout(() => setToast(null), 4000); }, []);

  const handleEvents = useCallback((evs) => {
    (evs || []).forEach((e) => {
      const map = { FILLED: t('ev.filled'), STOP_LOSS: t('ev.sl'), TAKE_PROFIT: t('ev.tp'), LIQUIDATED: t('ev.liq') };
      if (map[e.type]) flash(`${map[e.type]} · ${e.side} @ ${fmt(e.price)}`, e.type === 'LIQUIDATED' || e.type === 'STOP_LOSS' ? 'bad' : 'good');
    });
  }, [t, flash]);

  const apply = useCallback((r) => {
    setSt((o) => ({ ...o, ...r }));
    setLivePrice(null);
    if (r.events) handleEvents(r.events);
    if (r.ended) { setEnded(true); setPlaying(false); }
    setReviewTick((x) => x + 1);
  }, [handleEvents]);

  const loadCandles = useCallback(async () => {
    try {
      const r = await api.get(`/market/candles?timeframe=${tf}&limit=300&session=${s.id}`);
      setCandles(r.candles);
    } catch { /* ignore */ }
  }, [tf, s.id]);

  useEffect(() => { loadCandles(); }, [loadCandles, s.simulated_current_time]);
  useEffect(() => { if (!tm) { const id = setInterval(loadCandles, 30000); return () => clearInterval(id); } return undefined; }, [tm, loadCandles]);

  // Time Machine: redare automata
  useEffect(() => {
    if (!tm || !playing) return undefined;
    const id = setInterval(async () => {
      if (busy.current) return;
      busy.current = true;
      try { apply(await api.post(`/sessions/${s.id}/advance`, { steps: speed })); } catch (e) { setPlaying(false); flash(errMsg(e), 'bad'); } finally { busy.current = false; }
    }, 1000);
    return () => clearInterval(id);
  }, [tm, playing, speed, s.id, apply, flash, errMsg]);

  // Live: verificare periodica ordine/SL/TP/lichidare pe pretul curent
  useEffect(() => {
    if (tm) return undefined;
    const id = setInterval(async () => {
      if (busy.current) return;
      busy.current = true;
      try { apply(await api.post(`/sessions/${s.id}/tick`)); } catch { /* ignore */ } finally { busy.current = false; }
    }, 2000);
    return () => clearInterval(id);
  }, [tm, s.id, apply]);

  const nextCandle = async () => {
    if (busy.current) return;
    busy.current = true;
    try { apply(await api.post(`/sessions/${s.id}/advance`, { steps: TF_MIN[tf] })); } catch (e) { flash(errMsg(e), 'bad'); } finally { busy.current = false; }
  };

  const wrap = (fn) => async (...a) => { const r = await fn(...a); apply(r); return r; };
  const place = wrap((body) => api.post(`/sessions/${s.id}/orders`, body));
  const editPos = wrap((id, body) => api.put(`/sessions/${s.id}/positions/${id}`, body));
  const editOrder = wrap((id, body) => api.put(`/sessions/${s.id}/orders/${id}`, body));
  const closePos = wrap((id) => api.post(`/sessions/${s.id}/positions/${id}/close`));
  const delPos = wrap((id) => api.del(`/sessions/${s.id}/positions/${id}`));
  const delOrder = wrap((id) => api.del(`/sessions/${s.id}/orders/${id}`));

  const open = st.positions.filter((p) => p.status === 'OPEN');
  const upnl = open.reduce((a, p) => a + (p.side === 'LONG' ? price - p.entry_price : p.entry_price - price) * p.quantity_btc, 0);
  const locked = open.reduce((a, p) => a + p.margin_usdc, 0) + st.orders.filter((o) => o.status === 'PENDING').reduce((a, o) => a + o.margin_usdc, 0);
  const equity = s.current_balance + locked + upnl;
  const pnl = equity - s.initial_balance;

  const lines = [];
  open.forEach((p) => {
    lines.push({ price: p.entry_price, color: p.side === 'LONG' ? '#0ECB81' : '#F6465D', title: `${t('line.entry')} ${p.side}`, solid: true });
    lines.push({ price: p.liquidation_price, color: '#FCD535', title: t('line.liq') });
    if (p.stop_loss) lines.push({ price: p.stop_loss, color: '#F6465D', title: 'SL' });
    if (p.take_profit) lines.push({ price: p.take_profit, color: '#0ECB81', title: 'TP' });
  });
  st.orders.filter((o) => o.status === 'PENDING').forEach((o) => {
    if (o.limit_price) lines.push({ price: o.limit_price, color: '#EAECEF', title: `LIMIT ${o.side}` });
    if (o.stop_loss) lines.push({ price: o.stop_loss, color: '#F6465D', title: 'SL*' });
    if (o.take_profit) lines.push({ price: o.take_profit, color: '#0ECB81', title: 'TP*' });
  });

  const newSession = async () => {
    setConfirmNew(false);
    setPlaying(false);
    try { onClosed(await api.post(`/sessions/${s.id}/close`)); } catch (e) { flash(errMsg(e), 'bad'); }
  };

  return (
    <div className="space-y-3 anim-in">
      <div className="card px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-[10px] uppercase text-tx2">BTC/USDC {tm ? '· ' + t('mode.TIME_MACHINE') : '· LIVE'}</div>
          <div className="num text-2xl font-bold">{fmt(price)}</div>
        </div>
        <Stat label={t('stat.balance')} v={fmt(s.current_balance)} />
        <Stat label={t('stat.equity')} v={fmt(equity)} />
        <Stat label={t('stat.upnl')} v={fmtSigned(upnl, 3)} cls={pnlClass(upnl)} />
        <Stat label={t('stat.pnl')} v={`${fmtSigned(pnl)} (${fmtSigned((pnl / s.initial_balance) * 100, 1)}%)`} cls={pnlClass(pnl)} />
        <Stat label={t('stat.start')} v={`$${s.initial_balance}`} />
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setDrawer(!drawer)}>🧠 {t('review.button')}</button>
          <button className="btn-gold btn-sm" onClick={() => setConfirmNew(true)}>＋ {t('session.new')}</button>
        </div>
      </div>

      {tm && <TimeMachineBar simTime={s.simulated_current_time} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} onNext={nextCandle} ended={ended} tf={tf} />}

      <div className={`grid gap-3 lg:grid-cols-[1fr_320px] transition-[padding] ${drawer ? 'xl:pr-[400px]' : ''}`}>
        <div className="space-y-3 min-w-0">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-line">
              {TIMEFRAMES.map((x) => (
                <button key={x} onClick={() => setTf(x)} className={`tab num ${tf === x ? 'tab-on' : ''}`}>{x}</button>
              ))}
              <span className="ml-auto text-[11px] text-tx2">{tm ? t('chart.noSpoiler') : t('chart.liveFeed')}</span>
            </div>
            <div className="h-[430px]"><Chart candles={candles} lines={lines} live={!tm} timeframe={tf} onPrice={setLivePrice} resetKey={`${s.id}-${tf}`} /></div>
          </div>
          <Tables positions={st.positions} orders={st.orders} price={price}
            onEditPos={editPos} onClosePos={closePos} onDeletePos={delPos}
            onEditOrder={editOrder} onCancelOrder={delOrder} onDeleteOrder={delOrder} />
        </div>
        <OrderPanel balance={s.current_balance} price={price} onSubmit={place} />
      </div>

      <ReviewDrawer open={drawer} onClose={() => setDrawer(false)} sessionId={s.id} tick={reviewTick > 0 && drawer ? reviewTick : 0} />

      {confirmNew && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="card p-6 max-w-md anim-in">
            <div className="text-lg font-semibold">{t('session.new')}?</div>
            <p className="text-sm text-tx2 mt-2">{t('session.newConfirm')}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-ghost" onClick={() => setConfirmNew(false)}>{t('common.cancel')}</button>
              <button className="btn-gold" onClick={newSession}>{t('session.closeAndNew')}</button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-semibold anim-in shadow-xl ${toast.kind === 'bad' ? 'bg-down text-white' : toast.kind === 'good' ? 'bg-up text-bg' : 'bg-line text-tx'}`}>{toast.m}</div>
      )}
    </div>
  );
}

function Stat({ label, v, cls = '' }) {
  return <div><div className="text-[10px] uppercase text-tx2">{label}</div><div className={`num text-sm font-semibold ${cls}`}>{v}</div></div>;
}

/* ------------------------------------------------------------- closed summary */
function Summary({ data, onNext }) {
  const { t } = useApp();
  const s = data.session;
  const pnl = s.final_balance - s.initial_balance;
  return (
    <div className="max-w-3xl mx-auto space-y-4 anim-in">
      <div className="card p-5">
        <div className="text-xs uppercase text-tx2">{t('summary.title')}</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-3">
          <Stat label={t('stat.start')} v={`$${fmt(s.initial_balance)}`} />
          <Stat label={t('hist.final')} v={`$${fmt(s.final_balance)}`} />
          <Stat label="PnL" v={`${fmtSigned(pnl)} (${fmtSigned((pnl / s.initial_balance) * 100, 1)}%)`} cls={pnlClass(pnl)} />
          <Stat label={t('m.trades')} v={data.trades} />
          <Stat label={t('m.fees')} v={`${fmt(data.fees, 4)}`} />
        </div>
      </div>
      <div className="card p-5"><div className="text-xs uppercase text-tx2 mb-3">{t('summary.review')}</div><ReviewView review={data.review} onChanged={() => {}} onDeleted={() => {}} /></div>
      <button className="btn-gold w-full py-3" onClick={onNext}>{t('summary.next')}</button>
    </div>
  );
}

export default function Simulator() {
  const { t, errMsg } = useApp();
  const [phase, setPhase] = useState('loading');
  const [state, setState] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const a = await api.get('/sessions/active');
        if (a.session) { setState(await api.get(`/sessions/${a.session.id}/state`)); setPhase('trading'); } else setPhase('start');
      } catch { setPhase('start'); }
    })();
  }, []);

  const start = async (body) => { const st = await api.post('/sessions', body); setState(st); setPhase('trading'); };

  if (phase === 'loading') return <div className="text-center text-tx2 mt-20">…</div>;
  if (phase === 'start') return <StartScreen onStart={start} />;
  if (phase === 'summary') return <Summary data={summary} onNext={() => { setSummary(null); setState(null); setPhase('start'); }} />;
  return <Trading key={state.session.id} initial={state} onClosed={(d) => { setSummary(d); setPhase('summary'); }} />;
}
