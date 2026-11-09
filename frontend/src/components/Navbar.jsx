import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';

export function Logo({ big = false }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <div className={`${big ? 'w-12 h-12 text-3xl' : 'w-8 h-8 text-xl'} rounded-full bg-gold text-bg grid place-items-center font-bold shadow-[0_0_24px_rgba(252,213,53,0.35)]`}>₿</div>
      <span className={`${big ? 'text-3xl' : 'text-lg'} font-bold tracking-tight`}>
        Lucky <span className="text-gold">Bitcoin</span>
      </span>
    </div>
  );
}

export function LangToggle() {
  const { lang, setLang } = useApp();
  const b = (l, label) => (
    <button
      key={l}
      onClick={() => setLang(l)}
      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${lang === l ? 'bg-gold text-bg' : 'text-tx2 hover:text-tx'}`}
    >
      {label}
    </button>
  );
  return <div className="flex items-center gap-0.5 bg-card border border-line rounded-xl p-0.5">{b('ro', 'RO 🇷🇴')}{b('en', 'EN 🇬🇧')}</div>;
}

export default function Navbar() {
  const { user, t, logout } = useApp();
  const nav = useNavigate();
  const link = ({ isActive }) => `tab ${isActive ? 'tab-on' : ''}`;
  return (
    <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-md border-b border-line">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-4">
        <NavLink to="/"><Logo /></NavLink>
        {user && (
          <nav className="flex items-center gap-1 ml-4 overflow-x-auto">
            {['TRADER', 'ADMIN'].includes(user.role) && <NavLink to="/" end className={link}>{t('nav.simulator')}</NavLink>}
            <NavLink to="/history" className={link}>{t('nav.history')}</NavLink>
            {['ANALYST', 'ADMIN'].includes(user.role) && <NavLink to="/data" className={link}>{t('nav.data')}</NavLink>}
            {user.role === 'ADMIN' && <NavLink to="/admin" className={link}>{t('nav.admin')}</NavLink>}
            <NavLink to="/security" className={link}>{t('nav.security')}</NavLink>
            <NavLink to="/documentation" className={link}>{t('nav.docs')}</NavLink>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">
          <LangToggle />
          {user ? (
            <div className="flex items-center gap-2">
              <div className="text-right leading-tight hidden sm:block">
                <div className="text-sm font-medium">{user.username}</div>
                <div className="text-[10px] text-gold font-semibold">{user.role}</div>
              </div>
              <button className="btn-ghost btn-sm" onClick={async () => { await logout(); nav('/login'); }}>{t('nav.logout')}</button>
            </div>
          ) : (
            <NavLink to="/documentation" className="tab">{t('nav.docs')}</NavLink>
          )}
        </div>
      </div>
    </header>
  );
}
