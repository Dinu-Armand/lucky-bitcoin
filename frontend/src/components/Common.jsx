import { useEffect } from 'react';
import { useApp } from '../AppContext';
import { reportUrl } from '../api';

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card p-5 w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[90vh] overflow-y-auto anim-in`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">{title}</div>
          <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Butoane de export reale (PDF / CSV / Excel) generate de backend din datele PostgreSQL. */
export function ExportButtons({ kind, params = {}, small = true }) {
  const { t, lang } = useApp();
  const items = [['pdf', 'PDF'], ['csv', 'CSV'], ['xlsx', 'Excel']];
  return (
    <div className="inline-flex items-center gap-1">
      {items.map(([f, label]) => (
        <a key={f} href={reportUrl(kind, f, lang, params)} download className={`btn-ghost ${small ? 'btn-sm' : ''}`} title={t('export.' + f)}>
          ⬇ {label}
        </a>
      ))}
    </div>
  );
}

export function Pager({ page, limit, total, onPage }) {
  const { t } = useApp();
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center gap-2 text-xs text-tx2">
      <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      <span className="num">{page} / {pages}</span>
      <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
      <span>{total} {t('common.rows')}</span>
    </div>
  );
}

export function Section({ title, children, right }) {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold text-lg">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
