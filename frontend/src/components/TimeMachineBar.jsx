import { useApp } from '../AppContext';
import { SPEEDS } from '../utils';

export default function TimeMachineBar({ simTime, playing, setPlaying, speed, setSpeed, onNext, ended, tf }) {
  const { t } = useApp();
  return (
    <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="chip bg-gold/15 text-gold">⏱ TIME MACHINE</span>
        <span className="num text-sm">{simTime ? new Date(simTime).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—'}</span>
      </div>
      <div className="flex items-center gap-2">
        <button className={playing ? 'btn-ghost btn-sm' : 'btn-gold btn-sm'} disabled={ended} onClick={() => setPlaying(!playing)}>
          {playing ? `⏸ ${t('tm.pause')}` : `▶ ${t('tm.play')}`}
        </button>
        <button className="btn-ghost btn-sm" disabled={ended || playing} onClick={onNext}>⏭ {t('tm.next')} (+1 {tf})</button>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-tx2 mr-1">{t('tm.speed')}</span>
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={`btn-sm rounded-lg px-2 py-1 text-xs num border ${speed === s ? 'bg-gold text-bg border-gold font-bold' : 'border-line text-tx2 hover:text-tx'}`}>x{s}</button>
        ))}
      </div>
      {ended && <span className="text-xs text-down">{t('tm.ended')}</span>}
      <div className="text-[11px] text-tx2 ml-auto max-w-sm">{t('tm.speedNote')}</div>
    </div>
  );
}
