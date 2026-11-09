import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';
import { Section } from '../components/Common';
import { CrudTable } from './DataManager';
import { fmt } from '../utils';

function BarChart({ title, items, unit = '', colors }) {
  const max = Math.max(...items.flatMap((i) => i.values.map((v) => v.v)), 1e-9);
  return (
    <div>
      <div className="text-xs uppercase text-tx2 mb-2">{title}</div>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-xs text-tx2 mb-1">{it.label}</div>
            {it.values.map((v, i) => (
              <div key={v.k} className="flex items-center gap-2 mb-0.5">
                <span className="w-9 text-[10px] text-tx2 num">{v.k}</span>
                <div className="flex-1 h-3.5 bg-bg rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${Math.max(1.5, (v.v / max) * 100)}%`, background: colors[i % colors.length] }} />
                </div>
                <span className="w-20 text-right text-xs num">{fmt(v.v, v.v < 100 ? 2 : 0)}{unit}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanBox({ title, color, p }) {
  const { t } = useApp();
  return (
    <div className="bg-bg border border-line rounded-xl p-3">
      <div className="text-xs font-semibold mb-2" style={{ color }}>{title}</div>
      <dl className="text-sm space-y-1">
        <div className="flex justify-between"><dt className="text-tx2">{t('admin.bench.scan')}</dt><dd className="num font-semibold">{p.mainScan}</dd></div>
        <div className="flex justify-between"><dt className="text-tx2">{t('admin.bench.time')}</dt><dd className="num font-semibold">{fmt(p.executionMs, 3)} ms</dd></div>
        <div className="flex justify-between"><dt className="text-tx2">{t('admin.bench.cost')}</dt><dd className="num">{fmt(p.totalCost, 2)}</dd></div>
        <div className="flex justify-between"><dt className="text-tx2">{t('admin.bench.buffers')}</dt><dd className="num">{p.sharedHit} / {p.sharedRead}</dd></div>
      </dl>
      <div className="text-[11px] text-tx2 num mt-2 break-words">{p.nodes.join(' → ')}</div>
    </div>
  );
}

function Benchmark() {
  const { t, errMsg } = useApp();
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/admin/last').then((x) => x.benchmark && setRes(x.benchmark)).catch(() => {}); }, []);
  const run = async () => {
    setBusy(true); setErr('');
    try { setRes(await api.post('/admin/benchmark')); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Section title={`⚡ ${t('admin.bench.title')}`} right={<button className="btn-gold" disabled={busy} onClick={run}>{busy ? t('admin.bench.running') : t('admin.bench.run')}</button>}>
      <p className="text-sm text-tx2 mb-3">{t('admin.bench.desc')}</p>
      {err && <div className="text-down text-sm mb-2">{err}</div>}
      {res && (
        <div className="space-y-5">
          {res.tests.map((x) => (
            <div key={x.key} className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-semibold">{x.title}</div>
                <div className="chip bg-up/15 text-up !text-sm !px-3 !py-1">{t('admin.bench.speedup')}: {x.speedupPct}%{x.speedupFactor ? ` (×${x.speedupFactor})` : ''}</div>
              </div>
              <pre className="bg-bg border border-line rounded-xl p-3 text-[11px] num overflow-x-auto text-tx2 whitespace-pre-wrap">{x.sql}</pre>
              <pre className="bg-bg border border-line rounded-xl p-3 text-[11px] num overflow-x-auto text-gold whitespace-pre-wrap">{x.indexSql}</pre>
              <div className="grid md:grid-cols-2 gap-3">
                <PlanBox title={t('admin.bench.before')} color="#F6465D" p={x.before} />
                <PlanBox title={t('admin.bench.after')} color="#0ECB81" p={x.after} />
              </div>
              <details className="text-xs text-tx2">
                <summary className="cursor-pointer hover:text-gold">{t('admin.bench.plan')}</summary>
                <div className="grid md:grid-cols-2 gap-3 mt-2">
                  <pre className="bg-bg border border-line rounded-xl p-3 num overflow-auto max-h-80">{JSON.stringify(x.plans.before, null, 2)}</pre>
                  <pre className="bg-bg border border-line rounded-xl p-3 num overflow-auto max-h-80">{JSON.stringify(x.plans.after, null, 2)}</pre>
                </div>
              </details>
            </div>
          ))}
          <details className="text-xs text-tx2">
            <summary className="cursor-pointer hover:text-gold">{t('admin.bench.statements')}</summary>
            <pre className="bg-bg border border-line rounded-xl p-3 num overflow-auto mt-2 whitespace-pre-wrap">{res.statements.join(';\n')}</pre>
          </details>
        </div>
      )}
    </Section>
  );
}

function LoadTest() {
  const { t, errMsg } = useApp();
  const [conns, setConns] = useState(50);
  const [dur, setDur] = useState(10);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/admin/last').then((x) => x.loadtest && setRes(x.loadtest)).catch(() => {}); }, []);
  const run = async () => {
    setBusy(true); setErr('');
    try { setRes(await api.post('/admin/loadtest', { connections: Number(conns), duration: Number(dur) })); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Section title={`🚀 ${t('admin.load.title')}`}>
      <p className="text-sm text-tx2 mb-3">{t('admin.load.desc')}</p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div><label className="label">{t('admin.load.conns')}</label><input type="number" min="1" max="200" className="input !w-28" value={conns} onChange={(e) => setConns(e.target.value)} /></div>
        <div><label className="label">{t('admin.load.dur')}</label><input type="number" min="2" max="30" className="input !w-28" value={dur} onChange={(e) => setDur(e.target.value)} /></div>
        <button className="btn-gold" disabled={busy} onClick={run}>{busy ? '…' : t('admin.load.run')}</button>
        {busy && <span className="text-xs text-tx2">{t('admin.load.running')}</span>}
      </div>
      <div className="text-xs text-tx2 mb-3">{t('admin.load.cli')} <code className="num text-gold bg-bg border border-line rounded px-1.5 py-0.5">npm run loadtest</code></div>
      {err && <div className="text-down text-sm mb-2">{err}</div>}
      {res && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[[t('admin.load.rps'), fmt(res.totals.rps, 1)], ['Requests', res.totals.requests.toLocaleString('en-US')], [t('admin.load.avg'), fmt(res.totals.avgLatency, 2)], [t('admin.load.ok'), fmt(res.totals.successRate, 2)]].map(([k, v]) => (
              <div key={k} className="bg-bg border border-line rounded-xl p-3"><div className="text-[10px] uppercase text-tx2">{t('admin.load.totals')} · {k}</div><div className="num text-xl font-bold text-gold">{v}</div></div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                {['endpoint', 'rps', 'avg', 'min', 'max'].map((k) => <th key={k} className="th">{t('admin.load.' + k)}</th>)}
                {['p50', 'p95', 'p99'].map((k) => <th key={k} className="th">{k} ms</th>)}
                <th className="th">{t('admin.load.mbs')}</th><th className="th">{t('admin.load.ok')}</th>
              </tr></thead>
              <tbody>
                {res.results.map((r) => (
                  <tr key={r.name} className="border-t border-line/60">
                    <td className="td"><span className="chip bg-gold/15 text-gold mr-2">{r.method}</span><span className="num text-xs">{r.path}</span></td>
                    <td className="td num font-semibold">{fmt(r.rps, 1)}</td>
                    {[r.latency.avg, r.latency.min, r.latency.max, r.latency.p50, r.latency.p95, r.latency.p99].map((v, i) => <td key={i} className="td num">{fmt(v, 1)}</td>)}
                    <td className="td num">{fmt(r.throughputMBs, 3)}</td>
                    <td className={`td num ${r.successRate >= 99 ? 'text-up' : 'text-down'}`}>{fmt(r.successRate, 2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <BarChart title={t('admin.load.chartRps')} colors={['#FCD535']} items={res.results.map((r) => ({ label: `${r.method} ${r.path}`, values: [{ k: 'rps', v: r.rps }] }))} />
            <BarChart title={t('admin.load.chartLat')} colors={['#0ECB81', '#FCD535', '#F6465D']}
              items={res.results.map((r) => ({ label: `${r.method} ${r.path}`, values: [{ k: 'p50', v: r.latency.p50 }, { k: 'p95', v: r.latency.p95 }, { k: 'p99', v: r.latency.p99 }] }))} />
          </div>
        </div>
      )}
    </Section>
  );
}

export default function Admin() {
  const { t } = useApp();
  const [meta, setMeta] = useState(null);
  useEffect(() => { api.get('/data/_meta').then((m) => setMeta(m.find((x) => x.table === 'audit_logs'))).catch(() => {}); }, []);
  return (
    <div className="space-y-4 anim-in">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
        <p className="text-sm text-tx2">{t('admin.subtitle')}</p>
      </div>
      <Benchmark />
      <LoadTest />
      <Section title={`📜 ${t('admin.audit')}`}>{meta && <CrudTable table="audit_logs" meta={meta} />}</Section>
    </div>
  );
}
