import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';
import ReviewView from './ReviewView';

/** Panou lateral retractabil: nu blocheaza graficul sau panoul de ordine. Se poate regenera de oricate ori. */
export default function ReviewDrawer({ open, onClose, sessionId, tick }) {
  const { t, errMsg } = useApp();
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const generate = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.post(`/sessions/${sessionId}/review`);
      setReview(r.review);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [sessionId, errMsg]);

  useEffect(() => { if (open) generate(); }, [open, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside
      className={`fixed top-14 right-0 bottom-0 z-30 w-[400px] max-w-[92vw] bg-card/95 backdrop-blur-md border-l border-line shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="font-semibold">🧠 {t('review.title')}</div>
          <div className="flex items-center gap-2">
            <button className="btn-gold btn-sm" disabled={busy} onClick={generate}>{busy ? '…' : t('review.refresh')}</button>
            <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {err && <div className="text-down text-sm mb-3">{err}</div>}
          <ReviewView review={review} onChanged={setReview} onDeleted={() => setReview(null)} />
        </div>
      </div>
    </aside>
  );
}
