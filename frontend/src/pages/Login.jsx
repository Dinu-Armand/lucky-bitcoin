import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Logo } from '../components/Navbar';

const DEMOS = [
  { role: 'ADMIN', email: 'admin@luckybtc.ro', password: 'Admin123!' },
  { role: 'ANALYST', email: 'analyst@luckybtc.ro', password: 'Analyst123!' },
  { role: 'TRADER', email: 'trader@luckybtc.ro', password: 'Trader123!' },
];

export default function Login() {
  const { t, login, register, errMsg } = useApp();
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ login: '', username: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const u = mode === 'login' ? await login(f.login, f.password) : await register(f.username, f.email, f.password);
      nav(u.role === 'ANALYST' ? '/history' : '/');
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-8 items-center max-w-5xl mx-auto mt-8 anim-in">
      <div>
        <Logo big />
        <p className="text-tx2 mt-4 text-lg leading-relaxed">{t('login.tagline')}</p>
        <ul className="mt-6 space-y-2 text-sm text-tx2">
          {['login.f1', 'login.f2', 'login.f3', 'login.f4'].map((k) => (
            <li key={k} className="flex gap-2"><span className="text-gold">▸</span>{t(k)}</li>
          ))}
        </ul>
        <div className="card p-4 mt-6">
          <div className="text-xs uppercase text-tx2 mb-2">{t('login.demo')}</div>
          <div className="space-y-1.5">
            {DEMOS.map((d) => (
              <button
                key={d.role}
                type="button"
                onClick={() => { setMode('login'); setF({ ...f, login: d.email, password: d.password }); }}
                className="w-full flex items-center justify-between text-left text-sm px-3 py-2 rounded-xl hover:bg-line/50 border border-transparent hover:border-line"
              >
                <span><span className="chip bg-gold/15 text-gold mr-2">{d.role}</span><span className="num">{d.email}</span></span>
                <span className="num text-tx2">{d.password}</span>
              </button>
            ))}
          </div>
          <div className="text-[11px] text-tx2 mt-2">{t('login.demoHint')}</div>
        </div>
      </div>

      <form onSubmit={submit} className="card p-6 space-y-4">
        <div className="flex gap-1 bg-bg rounded-xl p-1">
          {['login', 'register'].map((m) => (
            <button type="button" key={m} onClick={() => { setMode(m); setErr(''); }}
              className={`flex-1 py-2 text-sm rounded-lg font-semibold ${mode === m ? 'bg-line text-gold' : 'text-tx2'}`}>
              {t('login.' + m)}
            </button>
          ))}
        </div>
        {mode === 'login' ? (
          <div><label className="label">{t('login.emailOrUser')}</label><input className="input" value={f.login} onChange={set('login')} autoComplete="username" required /></div>
        ) : (
          <>
            <div><label className="label">{t('login.username')}</label><input className="input" value={f.username} onChange={set('username')} required minLength={3} /></div>
            <div><label className="label">Email</label><input type="email" className="input" value={f.email} onChange={set('email')} required /></div>
          </>
        )}
        <div><label className="label">{t('login.password')}</label><input type="password" className="input" value={f.password} onChange={set('password')} autoComplete="current-password" required minLength={mode === 'register' ? 6 : 1} /></div>
        {err && <div className="text-down text-sm bg-down/10 border border-down/30 rounded-xl px-3 py-2">{err}</div>}
        <button className="btn-gold w-full py-2.5" disabled={busy}>{busy ? '…' : t('login.' + (mode === 'login' ? 'submitLogin' : 'submitRegister'))}</button>
        <p className="text-[11px] text-tx2 leading-relaxed">{t('login.authNote')}</p>
      </form>
    </div>
  );
}
