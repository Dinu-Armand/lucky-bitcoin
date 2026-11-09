import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { useApp } from '../AppContext';

/** /documentation — randeaza DOCUMENTATION.md (sectiunile RO si EN sunt separate prin markerul <!-- LANG:EN -->). */
export default function Documentation() {
  const { t, lang } = useApp();
  const [md, setMd] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/documentation')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
      .then(setMd)
      .catch((e) => setErr(e.message));
  }, []);

  const html = useMemo(() => {
    if (!md) return '';
    const [ro, en] = md.split('<!-- LANG:EN -->');
    const part = lang === 'en' && en ? en : ro.replace('<!-- LANG:RO -->', '');
    return marked.parse(part, { gfm: true, breaks: false });
  }, [md, lang]);

  const toc = useMemo(() => {
    const out = [];
    const re = /<h2[^>]*>(.*?)<\/h2>/g;
    let m;
    while ((m = re.exec(html))) out.push(m[1].replace(/<[^>]+>/g, ''));
    return out;
  }, [html]);

  const jump = (title) => {
    const el = [...document.querySelectorAll('.prose-lb h2')].find((h) => h.textContent === title);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (err) return <div className="text-down text-center mt-20">{err}</div>;
  if (!md) return <div className="text-center text-tx2 mt-20">…</div>;

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-6 max-w-6xl mx-auto anim-in">
      <aside className="hidden lg:block">
        <div className="card p-3 sticky top-20 max-h-[80vh] overflow-y-auto">
          <div className="text-[11px] uppercase text-tx2 mb-2">{t('docs.toc')}</div>
          <ul className="space-y-1">
            {toc.map((x) => (
              <li key={x}><button className="text-left text-xs text-tx2 hover:text-gold w-full leading-snug py-0.5" onClick={() => jump(x)}>{x}</button></li>
            ))}
          </ul>
        </div>
      </aside>
      <article className="card p-6 prose-lb min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
