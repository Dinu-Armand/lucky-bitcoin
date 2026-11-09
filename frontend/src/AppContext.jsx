import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { dict } from './i18n';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState(localStorage.getItem('lb_lang') || 'ro');

  useEffect(() => {
    api.get('/auth/me')
      .then((u) => {
        setUser(u);
        if (u.preferred_lang) {
          setLangState(u.preferred_lang);
          localStorage.setItem('lb_lang', u.preferred_lang);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = 'Lucky Bitcoin';
  }, [lang]);

  const setLang = useCallback(
    (l) => {
      setLangState(l);
      localStorage.setItem('lb_lang', l);
      if (user) api.put('/auth/lang', { lang: l }).catch(() => {});
    },
    [user]
  );

  const t = useCallback(
    (key, vars) => {
      let s = dict[lang]?.[key] ?? dict.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
      return s;
    },
    [lang]
  );

  const errMsg = useCallback(
    (e) => (e?.code && dict[lang]?.['err.' + e.code]) || e?.message || String(e),
    [lang]
  );

  const login = async (loginId, password) => {
    const u = await api.post('/auth/login', { login: loginId, password });
    setUser(u);
    if (u.preferred_lang) { setLangState(u.preferred_lang); localStorage.setItem('lb_lang', u.preferred_lang); }
    return u;
  };
  const register = async (username, email, password) => {
    const u = await api.post('/auth/register', { username, email, password, lang });
    setUser(u);
    return u;
  };
  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, ready, lang, setLang, t, errMsg, login, register, logout }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, ready, lang, setLang, t, errMsg]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
