import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../AppContext';
import { Section } from '../components/Common';

/** Tab "Securitate & Autentificare": explica in timp real stocarea parolei (bcrypt) si tokenul JWT curent. */
export default function Security() {
  const { t, errMsg } = useApp();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [left, setLeft] = useState(0);
  const [pw, setPw] = useState('');
  const [verify, setVerify] = useState(null);
  const [demoText, setDemoText] = useState('Lucky123!');
  const [demo, setDemo] = useState(null);

  const load = useCallback(async () => {
    try { const i = await api.get('/auth/security-info'); setInfo(i); setLeft(i.token.seconds_left); } catch (e) { setErr(errMsg(e)); }
  }, [errMsg]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!info) return undefined;
    const id = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(id);
  }, [info]);

  if (!info) return <div className="text-center text-tx2 mt-20">{err || '…'}</div>;
  const h = info.hash_info;
  const hms = `${String(Math.floor(left / 3600)).padStart(2, '0')}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const pct = Math.min(100, (left / (8 * 3600)) * 100);

  const doVerify = async () => { try { setVerify(await api.post('/auth/verify-password', { password: pw })); } catch (e) { setVerify({ error: errMsg(e) }); } };
  const doDemo = async () => { try { setDemo(await api.post('/auth/hash-demo', { text: demoText })); } catch (e) { setDemo({ error: errMsg(e) }); } };

  const flow = ['1', '2', '3', '4', '5', '6'];

  return (
    <div className="space-y-4 anim-in max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">🔐 {t('sec.title')}</h1>
        <p className="text-sm text-tx2">{t('sec.subtitle')}</p>
      </div>

      <Section title={t('sec.pwTitle')}>
        <p className="text-sm text-tx2 leading-relaxed mb-3">{t('sec.pwText')}</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-bg border border-line rounded-xl p-3">
            <div className="text-[10px] uppercase text-tx2 mb-1">{t('sec.plain')}</div>
            <div className="num text-sm text-tx2">••••••••••  <span className="text-down text-xs">({t('sec.neverStored')})</span></div>
          </div>
          <div className="bg-bg border border-line rounded-xl p-3">
            <div className="text-[10px] uppercase text-tx2 mb-1">{t('sec.hashDb')} — users.password_hash</div>
            {h ? (
              <div className="num text-xs break-all leading-relaxed">
                <span className="text-tx2">${h.version}$</span>
                <span className="text-gold">{String(h.rounds).padStart(2, '0')}</span><span className="text-tx2">$</span>
                <span className="text-up">{h.salt}</span><span className="text-down">{h.digest}</span>
              </div>
            ) : <div className="num text-xs break-all">{info.password_hash}</div>}
          </div>
        </div>
        {h && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs">
            <Chip c="text-tx" k={t('sec.algorithm')} v={`bcrypt (${h.version})`} />
            <Chip c="text-gold" k={t('sec.cost')} v={`${h.rounds} → 2^${h.rounds} = ${h.cost_iterations.toLocaleString('en-US')} ${t('sec.iterations')}`} />
            <Chip c="text-up" k={t('sec.salt')} v={`${h.salt} (22 ${t('sec.chars')}, ${t('sec.random')})`} />
            <Chip c="text-down" k={t('sec.digest')} v={`${h.digest} (31 ${t('sec.chars')})`} />
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div>
            <div className="text-xs uppercase text-tx2 mb-1">{t('sec.verifyTitle')}</div>
            <div className="flex gap-2">
              <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('login.password')} />
              <button className="btn-gold" onClick={doVerify}>{t('sec.verify')}</button>
            </div>
            {verify && (
              <div className={`mt-2 text-sm ${verify.error ? 'text-down' : verify.match ? 'text-up' : 'text-down'}`}>
                {verify.error || (verify.match ? `✔ ${t('sec.match')}` : `✘ ${t('sec.noMatch')}`)}
                {!verify.error && <span className="text-tx2 text-xs ml-2">bcrypt.compare · {verify.took_ms} ms</span>}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase text-tx2 mb-1">{t('sec.saltTitle')}</div>
            <div className="flex gap-2">
              <input className="input" value={demoText} onChange={(e) => setDemoText(e.target.value)} maxLength={72} />
              <button className="btn-ghost" onClick={doDemo}>{t('sec.hashTwice')}</button>
            </div>
            {demo && !demo.error && (
              <div className="mt-2 space-y-1 num text-[11px] break-all">
                <div className="text-tx2">#1 {demo.hash_1}</div>
                <div className="text-tx2">#2 {demo.hash_2}</div>
                <div className={demo.different ? 'text-up' : 'text-down'}>{demo.different ? `✔ ${t('sec.different')}` : '✘'} <span className="text-tx2">({demo.took_ms} ms, {demo.rounds} rounds)</span></div>
              </div>
            )}
            {demo?.error && <div className="text-down text-sm mt-2">{demo.error}</div>}
          </div>
        </div>
      </Section>

      <Section title={t('sec.jwtTitle')}>
        <p className="text-sm text-tx2 leading-relaxed mb-3">{t('sec.jwtText')}</p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase text-tx2 mb-1">{t('sec.payload')}</div>
            <pre className="bg-bg border border-line rounded-xl p-3 text-xs num overflow-x-auto">{JSON.stringify(info.token.payload, null, 2)}</pre>
            <div className="text-[10px] uppercase text-tx2 mt-3 mb-1">{t('sec.tokenPreview')}</div>
            <div className="num text-[11px] break-all text-tx2">{info.token.preview}</div>
          </div>
          <div className="space-y-3">
            <div className="bg-bg border border-line rounded-xl p-3">
              <div className="text-[10px] uppercase text-tx2">{t('sec.expiresIn')}</div>
              <div className="num text-3xl font-bold text-gold">{hms}</div>
              <div className="h-1.5 bg-line rounded mt-2 overflow-hidden"><div className="h-full bg-gold transition-all" style={{ width: `${pct}%` }} /></div>
              <div className="text-xs text-tx2 mt-2 num">{t('sec.issued')}: {info.token.issued_at}</div>
              <div className="text-xs text-tx2 num">{t('sec.expires')}: {info.token.expires_at}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Chip c="text-tx" k={t('sec.algorithm')} v={info.token.algorithm} />
              <Chip c="text-tx" k={t('sec.lifetime')} v={info.token.expires_in_config} />
              <Chip c="text-tx" k="sub (user id)" v={info.token.payload.sub} />
              <Chip c="text-gold" k="role" v={info.token.payload.role} />
            </div>
            <div className="text-xs text-tx2 leading-relaxed"><b className="text-tx">{t('sec.storage')}:</b> {info.token.storage}</div>
            <button className="btn-ghost btn-sm" onClick={load}>↻ {t('common.refresh')}</button>
          </div>
        </div>
      </Section>

      <Section title={t('sec.flowTitle')}>
        <ol className="space-y-2">
          {flow.map((n) => (
            <li key={n} className="flex gap-3 text-sm">
              <span className="w-6 h-6 shrink-0 rounded-full bg-gold text-bg grid place-items-center text-xs font-bold">{n}</span>
              <span className="text-tx2 leading-relaxed">{t('sec.flow' + n)}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t('sec.rbacTitle')}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">{t('sec.feature')}</th>{['TRADER', 'ANALYST', 'ADMIN'].map((r) => <th key={r} className={`th ${r === info.role ? '!text-gold' : ''}`}>{r}</th>)}</tr></thead>
            <tbody>
              {[
                ['rbac1', 1, 0, 1], ['rbac2', 0, 1, 1], ['rbac3', 0, 1, 1], ['rbac4', 0, 1, 1], ['rbac5', 0, 0, 1], ['rbac6', 0, 0, 1], ['rbac7', 0, 0, 1],
              ].map(([k, ...v]) => (
                <tr key={k} className="border-t border-line/60">
                  <td className="td text-tx2">{t('sec.' + k)}</td>
                  {v.map((x, i) => <td key={i} className={`td ${x ? 'text-up' : 'text-tx2/40'}`}>{x ? '✔' : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-tx2 mt-2">{t('sec.rbacNote')}</div>
      </Section>
    </div>
  );
}

function Chip({ k, v, c }) {
  return <div className="bg-bg border border-line rounded-xl px-3 py-2"><div className="text-[10px] uppercase text-tx2">{k}</div><div className={`num text-xs break-all ${c}`}>{v}</div></div>;
}
